import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSyscallFixture as syscall } from './test/fixtures';
import { SyscallApp } from './SyscallApp';

/**
 * Stands in for the backend serving /proc/<pid>/syscall. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/syscall$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? syscall(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/syscall`);
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const registers = () => screen.findByRole('table', { name: 'Argument registers' });
const names = () => screen.getByRole('table', { name: 'What the number is called' });

/** One row of the register table, by its index. */
const register = (index: number): HTMLElement =>
  within(screen.getByRole('table', { name: 'Argument registers' }))
    .getAllByRole('row')
    .find(
      (candidate) => within(candidate).queryAllByRole('cell')[0]?.textContent === String(index),
    )!;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('SyscallApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/syscall when no process is named', async () => {
    render(<SyscallApp />);

    await registers();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/syscall',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    // Which process was read is said once, in the page's heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/syscall');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<SyscallApp />);

    await registers();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/syscall', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/syscall');
  });

  /**
   * Which processes exist is the backend's answer to give, not this page's to
   * guess: a URL naming one that is not there is asked for and the 404 shown.
   */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<SyscallApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP 404`);
    expect(fetch).toHaveBeenCalledWith(`/0/api/file/${pid}/syscall`, expect.anything());
  });

  it('accepts the kernel’s own symbolic names', async () => {
    // No fixture has a thread-self directory, so serve one body for any pid:
    // what matters here is that the value is accepted and reaches the path.
    vi.stubGlobal('fetch', mockServer({ body: syscall('desktop', 'self') }));
    open('thread-self');
    render(<SyscallApp />);

    await registers();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/thread-self/syscall', expect.anything());
  });

  it('shows the call number and where the process would resume', async () => {
    render(<SyscallApp />);

    await registers();
    expect(stat('call number')).toHaveTextContent('0');
    expect(stat('instruction pointer')).toHaveTextContent('0x7f8e2a0f4b52');
    expect(screen.getByTestId('flags')).toHaveTextContent('sp 0x7ffd3c4f29c8');
  });

  /** The whole point of showing two rows: the number is not the call. */
  it('names the number under each architecture rather than picking one', async () => {
    render(<SyscallApp />);

    await registers();
    const table = names();
    expect(within(table).getByText('x86-64')).toBeInTheDocument();
    expect(within(table).getByText('read')).toBeInTheDocument();
    expect(within(table).getByText('arm64')).toBeInTheDocument();
  });

  it('says so up front where the architectures disagree', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'futex-parked' }));
    render(<SyscallApp />);

    await registers();
    expect(screen.getByTestId('ambiguous')).toHaveTextContent('futex on x86-64');
    expect(screen.getByTestId('ambiguous')).toHaveTextContent('accept on arm64');
    expect(stat('which is')).toHaveTextContent('architecture-dependent');
  });

  /** Every syscall since pidfd_send_signal has the same number everywhere. */
  it('says when a number means the same call on every architecture', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'io-uring' }));
    render(<SyscallApp />);

    await registers();
    expect(screen.queryByTestId('ambiguous')).not.toBeInTheDocument();
    expect(stat('which is')).toHaveTextContent('io_uring_enter');
    expect(screen.getByTestId('flags')).toHaveTextContent('same number everywhere');
    // One name per register, not the same word once per architecture.
    expect(within(register(0)).getAllByText('fd')).toHaveLength(1);
  });

  it('gives a row per argument register, in order', async () => {
    render(<SyscallApp />);

    await registers();
    expect(within(register(0)).getAllByRole('cell')[1]).toHaveTextContent('0x0');
    expect(within(register(1)).getAllByRole('cell')[1]).toHaveTextContent('0x7ffd3c4f2a10');
    expect(within(register(5)).getAllByRole('cell')[1]).toHaveTextContent('0x0');
  });

  it('names the registers the call actually takes', async () => {
    render(<SyscallApp />);

    await registers();
    expect(within(register(0)).getByText('fd')).toBeInTheDocument();
    expect(within(register(1)).getByText('buf')).toBeInTheDocument();
    expect(within(register(2)).getByText('count')).toBeInTheDocument();
  });

  /**
   * Six are always printed; the ones past the call's own arguments hold
   * whatever was left in the register.
   */
  it('marks the registers past the end of the call as leftovers', async () => {
    render(<SyscallApp />);

    await registers();
    expect(screen.getByTestId('flags')).toHaveTextContent('arguments 3 of 6');
    expect(within(register(3)).getByText('leftover')).toBeInTheDocument();
    expect(within(register(2)).queryByText('leftover')).not.toBeInTheDocument();
  });

  /**
   * Where the architectures read the number as two different calls, the
   * register genuinely means two things, so both are named and labelled.
   */
  it('names a register under each architecture where they disagree', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'futex-parked' }));
    render(<SyscallApp />);

    await registers();
    // futex(uaddr, ...) on x86-64, accept(sockfd, ...) on arm64.
    expect(within(register(0)).getByText(/uaddr/)).toHaveTextContent('x86-64');
    expect(within(register(0)).getByText(/sockfd/)).toHaveTextContent('arm64');
  });

  /** The longest candidate sets the arity, so nothing usable is greyed out. */
  it('calls a register a leftover only where no reading of the number uses it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'futex-parked' }));
    render(<SyscallApp />);

    await registers();
    // futex takes all six, so none of them is spare.
    expect(screen.getByTestId('flags')).toHaveTextContent('arguments 6 of 6');
    expect(screen.queryAllByText('leftover')).toHaveLength(0);
  });

  it('reads a small register as a number and a large one as an address', async () => {
    render(<SyscallApp />);

    await registers();
    expect(within(register(2)).getAllByRole('cell')[2]).toHaveTextContent('8192');
    expect(within(register(1)).getByText('address')).toBeInTheDocument();
  });

  /** A timeout of "forever" is -1, printed as sixteen f's. */
  it('reads an all-ones register as the -1 it stands for', async () => {
    open('12282');
    render(<SyscallApp />);

    await registers();
    expect(within(register(3)).getAllByRole('cell')[1]).toHaveTextContent('0xffffffffffffffff');
    expect(within(register(3)).getAllByRole('cell')[2]).toHaveTextContent('-1');
  });

  /** Not a failure: a task on a CPU cannot have its registers sampled. */
  it('explains `running` as the answer it is', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'running' }));
    render(<SyscallApp />);

    const notice = await screen.findByTestId('running');
    expect(notice).toHaveTextContent('on a CPU right now');
    expect(notice).toHaveTextContent('busy, not blocked');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('explains the -1 line as a process in userspace', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'userspace' }));
    render(<SyscallApp />);

    const notice = await screen.findByTestId('userspace');
    expect(notice).toHaveTextContent('no system call in progress');
    expect(notice).toHaveTextContent('three fields rather than nine');
    expect(stat('state')).toHaveTextContent('userspace');
    expect(stat('stack pointer')).toHaveTextContent('0x7ffc8e2a1b30');
    // There are no argument registers on that line to tabulate.
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('says what the file is worth in every state', async () => {
    for (const fixture of ['desktop', 'running', 'userspace']) {
      vi.stubGlobal('fetch', mockServer({ fixture }));
      const { unmount } = render(<SyscallApp />);

      expect(await screen.findByText(/a sample, not a trace/i), fixture).toBeInTheDocument();
      unmount();
    }
  });

  it('reports a line it cannot read rather than inventing one', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<SyscallApp />);

    expect(await screen.findByTestId('unreadable')).toHaveTextContent('It holds one line');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a process the backend does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open('4242');
    render(<SyscallApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/syscall (HTTP 404 Not Found)',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<SyscallApp />);
    await registers();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(syscall('desktop', 'self').trim());
  });

  it('links nowhere but back up its own path', async () => {
    render(<SyscallApp />);

    await registers();
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
    render(<SyscallApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/syscall (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, and every one of them has a
// `self` for the page opened without a pid.
describe.each([
  { fixture: 'desktop', shows: 'summary' },
  { fixture: 'futex-parked', shows: 'summary' },
  { fixture: 'io-uring', shows: 'summary' },
  { fixture: 'running', shows: 'running' },
  { fixture: 'userspace', shows: 'summary' },
])('SyscallApp with whatever the server serves: $fixture', ({ fixture, shows }) => {
  it(`reads self without an error`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<SyscallApp />);

    expect(await screen.findByTestId(shows)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unreadable')).not.toBeInTheDocument();
  });
});
