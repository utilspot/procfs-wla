import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readCommFixture as comm } from './test/fixtures';
import { CommApp } from './CommApp';

/**
 * Stands in for the backend serving /proc/<pid>/comm. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/comm$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? comm(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/comm`);
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const summary = () => screen.findByTestId('summary');

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('CommApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/comm when no process is named', async () => {
    render(<CommApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/comm',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    // Which process was read is said once, in the page's heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/comm');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<CommApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/comm', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/comm');
  });

  /**
   * Which processes exist is the backend's answer to give, not this page's to
   * guess: a URL naming one that is not there is asked for and the 404 shown.
   */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<CommApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP 404`);
    expect(fetch).toHaveBeenCalledWith(`/0/api/file/${pid}/comm`, expect.anything());
  });

  it('accepts the kernel’s own symbolic names', async () => {
    // No fixture has a thread-self directory, so serve one body for any pid:
    // what matters here is that the value is accepted and reaches the path.
    vi.stubGlobal('fetch', mockServer({ body: comm('desktop', 'self') }));
    open('thread-self');
    render(<CommApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/thread-self/comm', expect.anything());
  });

  /** The newline is the kernel's and not part of the name. */
  it('shows the name without the newline after it', async () => {
    render(<CommApp />);

    await summary();
    expect(stat('name')).toHaveTextContent('bash');
    expect(stat('name').textContent).toBe('bash');
    expect(stat('characters')).toHaveTextContent('4 of 15');
  });

  it('says what it is, for a name that is just a name', async () => {
    render(<CommApp />);

    await summary();
    expect(stat('is')).toHaveTextContent('a thread name');
    expect(screen.queryByTestId('kernel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('truncated')).not.toBeInTheDocument();
  });

  /**
   * Fifteen characters is the cap on a name a task stores, and nothing says one
   * was cut, so the length is the only tell there is.
   */
  it('warns where the name is at the cap, since it may be the front of a longer one', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'truncated' }));
    render(<CommApp />);

    await summary();
    expect(stat('name')).toHaveTextContent('pool-2-thread-1');
    expect(stat('characters')).toHaveTextContent('15 of 15');
    expect(screen.getByTestId('truncated')).toHaveTextContent('no telling from here');
    expect(screen.getByTestId('flags')).toHaveTextContent('at the 15-character cap');
  });

  it('marks a name that holds spaces', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'truncated' }));
    open('901');
    render(<CommApp />);

    await summary();
    expect(stat('name')).toHaveTextContent('Isolated Web Co');
    expect(screen.getByTestId('flags')).toHaveTextContent('holds spaces');
  });

  /** The reason reading this name out of /proc/<pid>/stat takes more care. */
  it('marks a name that holds parentheses', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'renamed' }));
    render(<CommApp />);

    await summary();
    expect(stat('name')).toHaveTextContent('(sd-pam)');
    expect(screen.getByTestId('flags')).toHaveTextContent('holds parentheses');
  });

  /** A kernel thread has a name here and no cmdline at all. */
  it('says when the name belongs to a kernel thread, and what kind', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-threads' }));
    open('2');
    render(<CommApp />);

    await summary();
    expect(stat('is')).toHaveTextContent('kernel thread parent');
    expect(screen.getByTestId('kernel')).toHaveTextContent('no /proc/<pid>/cmdline at all');
    expect(screen.getByTestId('kernel')).toHaveTextContent('never execve');
  });

  it('takes a workqueue worker’s name apart', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-threads' }));
    open('142');
    render(<CommApp />);

    await summary();
    expect(stat('is')).toHaveTextContent('workqueue worker');
    // 16 is the pool id here, not a CPU — `u` says the pool is unbound.
    expect(screen.getByTestId('flags')).toHaveTextContent('unbound pool 16');
    expect(screen.getByTestId('flags')).toHaveTextContent('worker 2');
  });

  it('reads the interrupt out of a threaded handler’s name', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-threads' }));
    open('311');
    render(<CommApp />);

    await summary();
    expect(stat('is')).toHaveTextContent('threaded interrupt handler');
    expect(screen.getByTestId('flags')).toHaveTextContent('irq 128, nvme0q1');
  });

  /**
   * A workqueue worker's name is assembled when the file is read, so it can be
   * far longer than the 15 characters a task can store — which is not a
   * truncated name but one that was never stored at all.
   */
  it('does not call a name past the cap a truncated one', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-threads' }));
    open('451');
    render(<CommApp />);

    await summary();
    expect(stat('name').textContent).toBe('kworker/u29:2-events_freezable_pwr_efficient');
    expect(stat('characters').textContent).toBe('44');
    expect(screen.queryByTestId('truncated')).not.toBeInTheDocument();
    expect(screen.getByTestId('flags')).toHaveTextContent('built at read time');
    expect(screen.getByTestId('flags')).toHaveTextContent('running events_freezable_pwr_efficient');
  });

  it('takes a workqueue rescuer apart', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-threads' }));
    open('93');
    render(<CommApp />);

    await summary();
    expect(stat('is')).toHaveTextContent('workqueue rescuer');
    expect(screen.getByTestId('flags')).toHaveTextContent('workqueue ipv6_addrconf');
  });

  it('reads the CPU out of a per-CPU thread’s name', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-threads' }));
    open('88');
    render(<CommApp />);

    await summary();
    expect(stat('is')).toHaveTextContent('per-CPU kernel thread');
    expect(screen.getByTestId('flags')).toHaveTextContent('cpu 0');
  });

  it('says nothing of the sort about an ordinary process', async () => {
    render(<CommApp />);

    await summary();
    expect(screen.queryByTestId('kernel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('control')).not.toBeInTheDocument();
  });

  /** prctl takes anything but a NUL and a newline, escape sequences included. */
  it('warns about a name a terminal would not print', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'evil\u001b[2Jname\n' }));
    render(<CommApp />);

    expect(await screen.findByTestId('control')).toHaveTextContent('will not print');
    expect(screen.getByTestId('control')).toHaveTextContent('escape sequences');
  });

  it('explains an empty file rather than showing an empty name', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '\n' }));
    render(<CommApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('no name in this file');
    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
  });

  it('reports a process the backend does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open('4242');
    render(<CommApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/comm (HTTP 404 Not Found)',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<CommApp />);
    await summary();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent('bash');
  });

  it('links nowhere but back up its own path', async () => {
    render(<CommApp />);

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
    render(<CommApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/comm (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, and every one of them has a
// `self` for the page opened without a pid.
describe.each([
  { fixture: 'desktop', name: 'bash' },
  { fixture: 'kernel-threads', name: 'ps' },
  { fixture: 'truncated', name: 'pool-2-thread-1' },
  { fixture: 'renamed', name: '(sd-pam)' },
  { fixture: 'container', name: 'sh' },
])('CommApp with whatever the server serves: $fixture', ({ fixture, name }) => {
  it(`reads ${name} from self`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<CommApp />);

    await screen.findByTestId('summary');
    expect(stat('name').textContent).toBe(name);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
