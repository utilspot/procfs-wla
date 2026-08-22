import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidIoFixture as io } from './test/fixtures';
import { PidIoApp } from './PidIoApp';

/**
 * Stands in for the backend serving /proc/<pid>/io. A fixture is a machine with
 * a process in it, so this answers per pid and 404s for one it does not have —
 * the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; pid?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/io$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', {
        status: options.failWith,
        statusText: options.failWith === 403 ? 'Forbidden' : 'Not Found',
      });
    }

    return new Response(options.body ?? io(options.fixture ?? 'cache-warm', options.pid ?? match[1]!), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/io`);
}

const syscallTable = () => screen.findByRole('table', { name: 'Counters at the syscall layer' });
const blockTable = () => screen.findByRole('table', { name: 'Counters at the storage layer' });

/** The row for one counter, matched on its name cell. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = [
    ...within(await syscallTable()).getAllByRole('row'),
    ...within(await blockTable()).getAllByRole('row'),
  ];
  return rows.find((row) => within(row).queryByRole('rowheader')?.textContent?.startsWith(name))!;
};

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidIoApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/io when no process is named', async () => {
    render(<PidIoApp />);

    await syscallTable();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/io',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/io');
  });

  it('reads the process its own URL names', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'readahead', pid: '4242' }));
    render(<PidIoApp />);

    await syscallTable();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/4242/io', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/4242/io');
  });

  /** The two measurements are two tables, because reading them as one is the bug. */
  it('shows the syscall counters and the storage counters apart', async () => {
    render(<PidIoApp />);

    expect(within(await syscallTable()).getAllByRole('row')).toHaveLength(5);
    expect(within(await blockTable()).getAllByRole('row')).toHaveLength(4);
    expect(await rowFor('rchar')).toHaveTextContent('bytes through read()');
    expect(await rowFor('read_bytes')).toHaveTextContent('bytes fetched from storage');
  });

  it('shows a counter as a size, and the two call counts as counts', async () => {
    render(<PidIoApp />);

    expect(await rowFor('rchar')).toHaveTextContent('259 MiB');
    // The exact figure stays beside the rounded one; the last digits can matter.
    expect(await rowFor('rchar')).toHaveTextContent('271,534,592 B');
    expect(await rowFor('syscr')).toHaveTextContent('8,317');
    expect(await rowFor('syscr')).not.toHaveTextContent('B');
  });

  /** A gigabyte of rchar against zero read_bytes is the ordinary case. */
  it('says how much was read without a disk being touched', async () => {
    render(<PidIoApp />);

    expect(await screen.findByTestId('cached')).toHaveTextContent(
      '259 MiB of what this process read never came off a disk',
    );
    expect(screen.getByTestId('cached')).toHaveTextContent('not one byte of this was fetched');
  });

  it('reads more fetched than asked for as readahead rather than an error', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'readahead', pid: '4242' }));
    render(<PidIoApp />);

    expect(await screen.findByTestId('over-read')).toHaveTextContent('readahead doing its job');
    expect(screen.queryByTestId('cached')).not.toBeInTheDocument();
  });

  /**
   * write_bytes is a promise, charged at page-dirtying time — so the file needs
   * a subtraction it deliberately does not do.
   */
  it('does the subtraction that turns promised writes into real ones', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'scratch-files' }));
    render(<PidIoApp />);

    const notice = await screen.findByTestId('cancelled');

    expect(notice).toHaveTextContent('800 MiB of the 1.0 GiB this process promised');
    expect(notice).toHaveTextContent('78% of it');
    expect(notice).toHaveTextContent('224 MiB, not 1.0 GiB');
  });

  it('says nothing of the sort where no promise was withdrawn', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'write-heavy' }));
    render(<PidIoApp />);

    await blockTable();
    expect(screen.queryByTestId('cancelled')).not.toBeInTheDocument();
  });

  it('gives the average size of a call, which is what the call counts are for', async () => {
    render(<PidIoApp />);

    expect(await screen.findByTestId('averages')).toHaveTextContent('Each read() moved 32 KiB on average');
  });

  it('reads seven zeroes as a process that has done nothing', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'idle' }));
    render(<PidIoApp />);

    expect(await screen.findByTestId('idle')).toHaveTextContent('an answer rather than a gap');
    // mmap is the reason a busy process can honestly look like this.
    expect(screen.getByTestId('idle')).toHaveTextContent('mmap');
    expect(screen.queryByTestId('averages')).not.toBeInTheDocument();
  });

  it('reads an empty file as one the backend could not read', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<PidIoApp />);

    expect(await screen.findByTestId('empty')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('names a counter a newer kernel added that this page does not know', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'rchar: 100\nsome_new_counter: 7\n' }));
    render(<PidIoApp />);

    expect(await screen.findByTestId('unknown')).toHaveTextContent('some_new_counter');
    expect(screen.getByTestId('missing')).toHaveTextContent('missing 6 of the seven');
  });

  it('reports a line that is not a name and a number', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'rchar: 100\nthis is not a counter\n' }));
    render(<PidIoApp />);

    expect(await screen.findByTestId('malformed')).toBeInTheDocument();
  });

  it('reports counters that are not in the order the kernel prints them', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'wchar: 200\nrchar: 100\n' }));
    render(<PidIoApp />);

    expect(await screen.findByTestId('unordered')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidIoApp />);
    await syscallTable();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(io('cache-warm'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidIoApp />);

    await syscallTable();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /** Mode 0400 with a ptrace check: another user's process is the ordinary refusal. */
  it('reports a refused read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 403 }));
    render(<PidIoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/io (HTTP 403 Forbidden)',
    );
  });

  it('reports a process that is not there', async () => {
    open('9999');
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<PidIoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/9999/io (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'cache-warm', pid: 'self' },
  { fixture: 'write-heavy', pid: 'self' },
  { fixture: 'scratch-files', pid: 'self' },
  { fixture: 'readahead', pid: '4242' },
  { fixture: 'idle', pid: 'self' },
])('PidIoApp with whatever the server serves: $fixture', ({ fixture, pid }) => {
  it('renders all seven counters', async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture, pid }));
    render(<PidIoApp />);

    expect(within(await syscallTable()).getAllByRole('row')).toHaveLength(5);
    expect(within(await blockTable()).getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
