import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readWchanFixture as wchan } from './test/fixtures';
import { WchanApp } from './WchanApp';

/**
 * Stands in for the backend serving /proc/<pid>/wchan. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/wchan$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? wchan(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/wchan`);
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

describe('WchanApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/wchan when no process is named', async () => {
    render(<WchanApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/wchan',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    // Which process was read is said once, in the page's heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/wchan');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<WchanApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/wchan', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/wchan');
  });

  /**
   * Which processes exist is the backend's answer to give, not this page's to
   * guess: a URL naming one that is not there is asked for and the 404 shown.
   */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<WchanApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP 404`);
    expect(fetch).toHaveBeenCalledWith(`/0/api/file/${pid}/wchan`, expect.anything());
  });

  it('accepts the kernel’s own symbolic names', async () => {
    // No fixture has a thread-self directory, so serve one body for any pid:
    // what matters here is that the value is accepted and reaches the path.
    vi.stubGlobal('fetch', mockServer({ body: wchan('desktop', 'self') }));
    open('thread-self');
    render(<WchanApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/thread-self/wchan', expect.anything());
  });

  it('shows the symbol and the family of wait it belongs to', async () => {
    render(<WchanApp />);

    await summary();
    expect(stat('waiting in')).toHaveTextContent('n_tty_read');
    expect(stat('which is')).toHaveTextContent('a terminal');
    expect(screen.getByTestId('waiting-on')).toHaveTextContent('not stuck');
  });

  it('reads a futex as a lock the kernel is only holding the queue for', async () => {
    open('12282');
    render(<WchanApp />);

    await summary();
    expect(stat('waiting in')).toHaveTextContent('futex_wait_queue_me');
    expect(stat('which is')).toHaveTextContent('a futex');
    expect(screen.getByTestId('waiting-on')).toHaveTextContent('in the program, not in here');
  });

  /**
   * The whole point of the file: a task in D state is deaf to signals and is
   * counted in the load average, which is how idle CPUs and a load of 40 meet.
   */
  it('warns where the sleep is the uninterruptible kind', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'blocked-io' }));
    render(<WchanApp />);

    await summary();
    expect(stat('the sleep is')).toHaveTextContent('uninterruptible');
    expect(screen.getByTestId('uninterruptible')).toHaveTextContent('SIGKILL');
    expect(screen.getByTestId('uninterruptible')).toHaveTextContent('counted in the load average');
    expect(screen.getByTestId('flags')).toHaveTextContent('D state');
  });

  it('names the filesystem journal a write is really waiting on', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'blocked-io' }));
    open('4242');
    render(<WchanApp />);

    await summary();
    expect(stat('which is')).toHaveTextContent('a filesystem journal');
    expect(screen.getByTestId('waiting-on')).toHaveTextContent('ext4');
  });

  /** The three-answers-in-one case, and the reason /proc/self/wchan is always 0. */
  it('explains that 0 does not say which of three things happened', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'running' }));
    render(<WchanApp />);

    await summary();
    expect(stat('waiting in')).toHaveTextContent('0');
    expect(stat('which is')).toHaveTextContent('nothing named');
    expect(screen.getByTestId('zero')).toHaveTextContent('on a CPU right now');
    expect(screen.getByTestId('zero')).toHaveTextContent('the read was refused');
    expect(screen.queryByTestId('waiting-on')).not.toBeInTheDocument();
  });

  /** Nothing to infer from a zero, so the state tile is not shown at all. */
  it('does not claim a state for a process the kernel would not name', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'running' }));
    render(<WchanApp />);

    await summary();
    expect(within(screen.getByTestId('summary')).queryByText('the sleep is')).toBeNull();
    expect(screen.queryByTestId('inferred')).not.toBeInTheDocument();
  });

  it('splits a module symbol from the module %ps printed beside it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'module-symbol' }));
    render(<WchanApp />);

    await summary();
    expect(stat('waiting in')).toHaveTextContent('rpc_wait_bit_killable');
    expect(stat('which is')).toHaveTextContent('a network filesystem');
    expect(screen.getByTestId('flags')).toHaveTextContent('in module sunrpc');
  });

  it('says when an address was printed because nothing resolved it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'module-symbol' }));
    open('5150');
    render(<WchanApp />);

    await summary();
    expect(stat('which is')).toHaveTextContent('an unresolved address');
    expect(screen.getByTestId('unresolved')).toHaveTextContent('CONFIG_KALLSYMS');
    expect(screen.queryByTestId('waiting-on')).not.toBeInTheDocument();
  });

  it('reads a kernel thread’s own loop as rest rather than a stall', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-threads' }));
    render(<WchanApp />);

    await summary();
    expect(stat('which is')).toHaveTextContent('a kernel thread’s own loop');
    expect(screen.getByTestId('flags')).toHaveTextContent('idle kernel thread');
    expect(screen.queryByTestId('uninterruptible')).not.toBeInTheDocument();
  });

  it('says it has no note for a symbol it does not know', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'some_function_nobody_charted' }));
    render(<WchanApp />);

    await summary();
    expect(stat('which is')).toHaveTextContent('a wait this page has no note for');
    expect(screen.getByTestId('flags')).toHaveTextContent('no note for this symbol');
    expect(screen.queryByTestId('waiting-on')).not.toBeInTheDocument();
  });

  /** The state is inferred from the family, and the file does not record it. */
  it('says the interruptible reading is an inference, and where the state really is', async () => {
    render(<WchanApp />);

    await summary();
    expect(stat('the sleep is')).toHaveTextContent('interruptible');
    expect(screen.getByTestId('inferred')).toHaveTextContent('/proc/<pid>/stat');
  });

  /** The kernel writes none, so one is a sign something reformatted the file. */
  it('marks a trailing newline the kernel would not have written', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'do_epoll_wait\n' }));
    render(<WchanApp />);

    await summary();
    expect(stat('waiting in')).toHaveTextContent('do_epoll_wait');
    expect(screen.getByTestId('flags')).toHaveTextContent('has a trailing newline');
  });

  it('explains an empty file rather than showing an empty symbol', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<WchanApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('nothing in this file');
    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
  });

  it('reports a process the backend does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open('4242');
    render(<WchanApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/wchan (HTTP 404 Not Found)',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<WchanApp />);
    await summary();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent('n_tty_read');
  });

  it('links nowhere but back up its own path', async () => {
    render(<WchanApp />);

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
    render(<WchanApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/wchan (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, and every one of them has a
// `self` for the page opened without a pid.
describe.each([
  { fixture: 'desktop', symbol: 'n_tty_read' },
  { fixture: 'running', symbol: '0' },
  { fixture: 'blocked-io', symbol: 'folio_wait_bit' },
  { fixture: 'kernel-threads', symbol: 'worker_thread' },
  { fixture: 'module-symbol', symbol: 'rpc_wait_bit_killable' },
])('WchanApp with whatever the server serves: $fixture', ({ fixture, symbol }) => {
  it(`reads ${symbol} from self`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<WchanApp />);

    await screen.findByTestId('summary');
    expect(stat('waiting in').textContent).toBe(symbol);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
