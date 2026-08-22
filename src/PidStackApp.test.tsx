import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidStackFixture as stack } from './test/fixtures';
import { PidStackApp } from './PidStackApp';

/**
 * Stands in for the backend serving /proc/<pid>/stack. Mode 0400 and a
 * PTRACE_MODE_ATTACH check, so a 403 is the ordinary refusal and a task whose
 * kernel stack has been freed is a 404.
 */
function mockServer(
  options: { fixture?: string; pid?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/stack$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', {
        status: options.failWith,
        statusText: options.failWith === 403 ? 'Forbidden' : 'Not Found',
      });
    }

    return new Response(options.body ?? stack(options.fixture ?? 'tty-read', options.pid ?? match[1]!), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/stack`);
}

const table = () => screen.findByRole('table', { name: 'Kernel stack frames' });

const rows = async () => within(await table()).getAllByRole('row').slice(1);

/** The row for one frame, matched on the symbol in its header cell. */
const rowFor = async (name: string): Promise<HTMLElement> =>
  (await rows()).find((row) => within(row).queryByRole('rowheader')?.textContent?.startsWith(name))!;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidStackApp', () => {
  it('reads /proc/self/stack when no process is named', async () => {
    render(<PidStackApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/stack',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/stack');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    vi.stubGlobal('fetch', mockServer({ fixture: 'futex', pid: '12282' }));
    render(<PidStackApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/stack', expect.anything());
  });

  it('shows a row per frame, numbered innermost first', async () => {
    render(<PidStackApp />);

    expect(await rows()).toHaveLength(11);
    const first = (await rows())[0]!;
    expect(within(first).getAllByRole('cell')[0]).toHaveTextContent('0');
    expect(first).toHaveTextContent('__schedule');
    expect((await rows()).at(-1)).toHaveTextContent('entry_SYSCALL_64_after_hwframe');
  });

  it('shows the symbol with the offset the kernel printed beside it', async () => {
    render(<PidStackApp />);

    expect(await rowFor('n_tty_read')).toHaveTextContent('+0x4f1/0x870');
  });

  /** The centrepiece: the brackets are furniture, not this task's addresses. */
  it('says the brackets hold a literal zero rather than an address', async () => {
    render(<PidStackApp />);

    expect(await screen.findByTestId('placeholder')).toHaveTextContent(
      'not this task’s addresses being zero',
    );
    expect(screen.getByTestId('placeholder')).toHaveTextContent('statm');
    expect(screen.queryByTestId('leaked')).not.toBeInTheDocument();
  });

  it('reports a bracket that holds a real kernel address', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '[<ffffffff810a2b3c>] schedule+0x1/0x2\n' }));
    render(<PidStackApp />);

    expect(await screen.findByTestId('leaked')).toHaveTextContent('kernel text addresses on display');
    expect(screen.queryByTestId('placeholder')).not.toBeInTheDocument();
  });

  /** wchan names one frame of this chain, picked the same way. */
  it('marks the frame wchan would name and says which it is', async () => {
    render(<PidStackApp />);

    expect(await rowFor('n_tty_read')).toHaveClass('stack__row--wait');
    expect(within(await rowFor('n_tty_read')).getByText('wchan')).toBeInTheDocument();
    expect(await screen.findByTestId('wchan-frame')).toHaveTextContent('frame 4 of these 11');
    expect(await screen.findByTestId('summary')).toHaveTextContent('n_tty_read');
  });

  /** The one thing this file has that /proc/<pid>/syscall does not: a name. */
  it('names the system call the task came in through', async () => {
    render(<PidStackApp />);

    expect(await screen.findByTestId('syscall')).toHaveTextContent('came in through read');
    expect(screen.getByTestId('syscall')).toHaveTextContent('a number means different calls');
  });

  it('reads the wait out of the same table wchan uses', async () => {
    open('12282');
    vi.stubGlobal('fetch', mockServer({ fixture: 'futex', pid: '12282' }));
    render(<PidStackApp />);

    expect(await screen.findByTestId('wait')).toHaveTextContent('Waiting on a futex');
  });

  it('marks an uninterruptible wait as the kind that counts in the load average', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'disk-io', pid: '4242' }));
    render(<PidStackApp />);

    const notice = await screen.findByTestId('wait');
    expect(notice).toHaveTextContent('Waiting on disk I/O');
    expect(notice).toHaveTextContent('load of 40');
    expect(notice).toHaveClass('notice--warn');
  });

  it('reads a chain with no system call as a kernel thread', async () => {
    open('901');
    vi.stubGlobal('fetch', mockServer({ fixture: 'kworker', pid: '901' }));
    render(<PidStackApp />);

    expect(await screen.findByTestId('kernel-thread')).toHaveTextContent('no system call anywhere');
    expect(screen.queryByTestId('syscall')).not.toBeInTheDocument();
  });

  /** The unwinder runs in the reader, so this is the read that is asking. */
  it('says when a task has unwound itself', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'reading-itself' }));
    render(<PidStackApp />);

    expect(await screen.findByTestId('reading-itself')).toHaveTextContent(
      'This is the read that is asking',
    );
    // Not asleep, but not the racy-unwind warning either — this one is expected.
    expect(screen.queryByTestId('running')).not.toBeInTheDocument();
  });

  it('warns that unwinding a running task is unsound', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '[<0>] kmem_cache_alloc+0x1/0x2\n' }));
    render(<PidStackApp />);

    expect(await screen.findByTestId('running')).toHaveTextContent('was not asleep');
  });

  it('reads an empty file as a task caught running on another CPU', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<PidStackApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('running on another CPU');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('says when a trace has hit the depth the kernel stops at', async () => {
    const deep = Array.from({ length: 64 }, (_, i) => `[<0>] frame_${i}+0x1/0x2`).join('\n');
    vi.stubGlobal('fetch', mockServer({ body: `${deep}\n` }));
    render(<PidStackApp />);

    expect(await screen.findByTestId('truncated')).toHaveTextContent('64 frames, which is the most');
  });

  it('reports a line that is not a frame', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '[<0>] schedule+0x1/0x2\nnot a frame\n' }));
    render(<PidStackApp />);

    expect(await screen.findByTestId('malformed')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidStackApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(stack('tty-read'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidStackApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /** PTRACE_MODE_ATTACH, which is stricter than io and environ ask for. */
  it('reports a refused read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 403 }));
    render(<PidStackApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/stack (HTTP 403 Forbidden)',
    );
  });

  it('reports a task whose kernel stack has already gone', async () => {
    open('9999');
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<PidStackApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/9999/stack (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'tty-read', pid: 'self', frames: 11 },
  { fixture: 'futex', pid: '12282', frames: 8 },
  { fixture: 'disk-io', pid: '4242', frames: 11 },
  { fixture: 'kworker', pid: '901', frames: 5 },
  { fixture: 'reading-itself', pid: 'self', frames: 9 },
])('PidStackApp with whatever the server serves: $fixture', ({ fixture, pid, frames }) => {
  it(`renders ${frames} frames`, async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture, pid }));
    render(<PidStackApp />);

    expect(await rows()).toHaveLength(frames);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
