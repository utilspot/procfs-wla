import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readStatusFixture as status } from './test/fixtures';
import { StatusApp } from './StatusApp';

/**
 * Stands in for the backend serving /proc/<pid>/status. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/status$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? status(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/status`);
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const summary = () => screen.findByTestId('summary');

/** One field's row in the table, found by its label. */
const row = (name: string): HTMLElement =>
  within(screen.getByRole('table')).getByText(name, { selector: '.pstatus__field' })
    .parentElement as HTMLElement;

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('StatusApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/status when no process is named', async () => {
    render(<StatusApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/status',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    // Which process was read is said once, in the page's heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/status');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<StatusApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/status', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/status');
  });

  /**
   * Which processes exist is the backend's answer to give, not this page's to
   * guess: a URL naming one that is not there is asked for and the 404 shown.
   */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<StatusApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP 404`);
    expect(fetch).toHaveBeenCalledWith(`/0/api/file/${pid}/status`, expect.anything());
  });

  it('accepts the kernel’s own symbolic names', async () => {
    // No fixture has a thread-self directory, so serve one body for any pid:
    // what matters here is that the value is accepted and reaches the path.
    vi.stubGlobal('fetch', mockServer({ body: status('desktop', 'self') }));
    open('thread-self');
    render(<StatusApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/thread-self/status', expect.anything());
  });

  it('reads the process off the top of the file', async () => {
    render(<StatusApp />);

    await summary();
    expect(stat('name')).toHaveTextContent('bash');
    expect(stat('state')).toHaveTextContent('sleeping');
    expect(stat('threads')).toHaveTextContent('1');
    expect(stat('resident')).toHaveTextContent('5.4 MiB');
  });

  it('shows a row per line the kernel printed', async () => {
    render(<StatusApp />);

    await summary();
    expect(rows().length).toBeGreaterThan(40);
    expect(row('VmRSS')).toHaveTextContent('5568 kB');
    expect(row('VmRSS')).toHaveTextContent('5.4 MiB');
    expect(row('VmRSS')).toHaveTextContent('overcounts');
  });

  /** Four ids on one line, and the effective one is what checks use. */
  it('labels the four ids on the Uid line', async () => {
    render(<StatusApp />);

    await summary();
    expect(row('Uid')).toHaveTextContent('real 1000, effective 1000, saved set 1000, filesystem 1000');
  });

  it('turns a signal mask into the signals it holds', async () => {
    render(<StatusApp />);

    await summary();
    expect(row('SigCgt')).toHaveTextContent('INT TERM CHLD TSTP WINCH');
    expect(row('SigIgn')).toHaveTextContent('HUP QUIT TSTP TTIN TTOU');
  });

  /** The line that is the whole point of reading this file for a setuid binary. */
  it('says when a setuid binary is running, and who started it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'setuid' }));
    render(<StatusApp />);

    await summary();
    expect(screen.getByTestId('setuid')).toHaveTextContent(
      'running as uid 0, and was started by uid 1000',
    );
    expect(screen.getByTestId('setuid')).toHaveTextContent('saved set');
    expect(screen.getByTestId('flags')).toHaveTextContent('uid 0 from 1000');
  });

  it('says nothing of the sort about a process that is who it says', async () => {
    render(<StatusApp />);

    await summary();
    expect(screen.queryByTestId('setuid')).not.toBeInTheDocument();
  });

  /** Uid 0 with an empty effective set is a daemon that gave its privilege away. */
  it('tells a capability set apart from being root', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container' }));
    render(<StatusApp />);

    await summary();
    expect(row('CapEff')).toHaveTextContent('CAP_CHOWN CAP_DAC_OVERRIDE');
    expect(row('CapEff')).not.toHaveTextContent('CAP_SYS_ADMIN');
    expect(row('CapEff')).toHaveTextContent('still has uid 0 and can do nothing with it');
  });

  it('marks a process holding the capability that is most of root', async () => {
    open('1');
    render(<StatusApp />);

    await summary();
    expect(screen.getByTestId('flags')).toHaveTextContent('all capabilities');
  });

  /**
   * A namespace's pid 1 has an unhandled signal discarded rather than acted on,
   * which is why `docker stop` on a bare shell waits ten seconds and gives up.
   */
  it('explains what being pid 1 of a namespace does to signals', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container' }));
    render(<StatusApp />);

    await summary();
    expect(screen.getByTestId('namespace-init')).toHaveTextContent('pid 1 inside its own namespace');
    expect(screen.getByTestId('namespace-init')).toHaveTextContent('no handler for SIGTERM');
    expect(screen.getByTestId('namespace-init')).toHaveTextContent('SIGKILL');
    expect(screen.getByTestId('flags')).toHaveTextContent('pid 1 inside its namespace');
  });

  /**
   * `Groups` grows with what the user belongs to and the affinity masks grow
   * with the machine, so the raw column has to cope with a value that has no
   * natural end. It is shown whole and wrapped, rather than cut short — the
   * point of that column is what the kernel actually printed.
   */
  it('shows a value too long for its column in full', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container' }));
    render(<StatusApp />);

    await summary();
    const mask = within(row('Cpus_allowed')).getByText(/^ffffffff/);

    expect(mask.textContent).toBe('ffffffff,ffffffff,ffffffff,ffffffff');
    // The width cap sits on this box, not on the cell — see styles.css.
    expect(mask).toHaveClass('pstatus__printed');
    expect(row('Cpus_allowed_list')).toHaveTextContent('0-127');
  });

  it('says which way round the namespace list reads', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container' }));
    render(<StatusApp />);

    await summary();
    expect(row('NSpid')).toHaveTextContent('1 in the innermost namespace, 3390 outside it');
  });

  it('does not warn about a container process that is not its pid 1', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container' }));
    open('5150');
    render(<StatusApp />);

    await summary();
    expect(screen.queryByTestId('namespace-init')).not.toBeInTheDocument();
    expect(screen.getByTestId('flags')).toHaveTextContent('pid 14 inside its namespace');
    expect(screen.getByTestId('flags')).toHaveTextContent('seccomp mode 2');
  });

  it('names the process holding this one under ptrace', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'traced' }));
    render(<StatusApp />);

    await summary();
    expect(screen.getByTestId('tracer')).toHaveTextContent('Process 7780 is tracing this one');
    expect(stat('state')).toHaveTextContent('tracing stop');
  });

  /** Sent to the process, not to a thread — which is where kill(2) puts one. */
  it('shows a signal pending for the process as a whole', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'traced' }));
    render(<StatusApp />);

    await summary();
    expect(screen.getByTestId('flags')).toHaveTextContent('pending TERM');
    expect(row('ShdPnd')).toHaveTextContent('TERM');
  });

  it('reads the context switch counts as what the process is short of', async () => {
    open('12282');
    render(<StatusApp />);

    await summary();
    expect(screen.getByTestId('switches')).toHaveTextContent('4,128,843');
    expect(screen.getByTestId('switches')).toHaveTextContent('918,224');
    expect(screen.getByTestId('flags')).toHaveTextContent('swapped 210 MiB');
  });

  /** Lines come and go with the kernel, so nothing may assume one is there. */
  it('reads a kernel that printed half of these lines', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-3.x' }));
    render(<StatusApp />);

    await summary();
    expect(stat('name')).toHaveTextContent('sshd');
    expect(within(screen.getByRole('table')).queryByText('Umask')).toBeNull();
    expect(within(screen.getByRole('table')).queryByText('NSpid')).toBeNull();
    expect(screen.queryByTestId('namespace-init')).not.toBeInTheDocument();
  });

  it('marks a line it has no note for rather than dropping it', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'Name:\tbash\nSomethingNew:\t42\n' }));
    render(<StatusApp />);

    await summary();
    expect(row('SomethingNew')).toHaveTextContent('no note for');
  });

  it('folds the lines it has no note for away', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', mockServer({ body: 'Name:\tbash\nSomethingNew:\t42\n' }));
    render(<StatusApp />);
    await summary();

    await user.click(screen.getByRole('checkbox'));

    expect(within(screen.getByRole('table')).queryByText('SomethingNew')).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('explains a file that is not this one rather than showing an empty table', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'not a status file at all\n' }));
    render(<StatusApp />);

    expect(await screen.findByTestId('unreadable')).toHaveTextContent('a label, a colon and a value');
    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
  });

  it('reports a process the backend does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open('4242');
    render(<StatusApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/status (HTTP 404 Not Found)',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<StatusApp />);
    await summary();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent('SigCgt');
  });

  it('links nowhere but back up its own path', async () => {
    render(<StatusApp />);

    await summary();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<StatusApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/status (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, and every one of them has a
// `self` for the page opened without a pid.
describe.each([
  { fixture: 'desktop', name: 'bash' },
  { fixture: 'setuid', name: 'sudo' },
  { fixture: 'container', name: 'sh' },
  { fixture: 'traced', name: 'a.out' },
  { fixture: 'legacy-3.x', name: 'sshd' },
])('StatusApp with whatever the server serves: $fixture', ({ fixture, name }) => {
  it(`reads ${name} from self`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<StatusApp />);

    await screen.findByTestId('summary');
    expect(stat('name').textContent).toBe(name);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
