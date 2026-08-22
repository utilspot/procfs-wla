import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidCoredumpFilterFixture as coredumpFilter } from './test/fixtures';
import { PidCoredumpFilterApp } from './PidCoredumpFilterApp';

/**
 * Stands in for the backend serving /proc/<pid>/coredump_filter. A fixture is a
 * machine with a process in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; pid?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/coredump_filter$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', {
        status: options.failWith,
        statusText: options.failWith === 403 ? 'Forbidden' : 'Not Found',
      });
    }

    return new Response(
      options.body ?? coredumpFilter(options.fixture ?? 'default', options.pid ?? match[1]!),
      { headers: { 'Content-Type': 'text/plain' } },
    );
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/coredump_filter`);
}

const table = () => screen.findByRole('table', { name: 'Core dump filter bits' });

/** The row for one bit, matched on the bit number in its header cell. */
const rowFor = async (bit: number): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => within(row).queryByRole('rowheader')?.textContent?.startsWith(String(bit)))!;
};

/** What the state cell of a bit says: `dumped` or `left out`. */
const stateOf = async (bit: number): Promise<string> =>
  within(await rowFor(bit)).getAllByRole('cell')[0]!.textContent!;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidCoredumpFilterApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/coredump_filter when no process is named', async () => {
    render(<PidCoredumpFilterApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/coredump_filter',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '/proc/self/coredump_filter',
    );
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    vi.stubGlobal('fetch', mockServer({ fixture: 'nothing', pid: '12282' }));
    render(<PidCoredumpFilterApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/coredump_filter', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '/proc/12282/coredump_filter',
    );
  });

  /** The whole of reading this file is knowing which bits `33` is. */
  it('shows a row per bit, saying which of them a core would hold', async () => {
    render(<PidCoredumpFilterApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(10);
    expect(await stateOf(0)).toContain('dumped');
    expect(await stateOf(2)).toContain('left out');
    expect(await stateOf(4)).toContain('dumped');
    expect(await stateOf(8)).toContain('left out');
  });

  it('summarizes the number as the bits it is', async () => {
    render(<PidCoredumpFilterApp />);

    const summary = await screen.findByTestId('summary');

    expect(summary).toHaveTextContent('00000033');
    expect(summary).toHaveTextContent('4 of 9');
    expect(summary).toHaveTextContent('the kernel default');
  });

  it('says when nothing has written the filter', async () => {
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByTestId('untouched')).toHaveTextContent(
      'the filter every process is born with',
    );
    expect(screen.queryByTestId('narrowed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('widened')).not.toBeInTheDocument();
  });

  /**
   * The read prints hex with no `0x` and the write is parsed base 0, where a
   * leading zero means octal — so the file will not take its own output back.
   */
  it('warns that echoing the file back into itself sets a different filter', async () => {
    render(<PidCoredumpFilterApp />);

    const warning = await screen.findByTestId('round-trip');

    expect(warning).toHaveTextContent('echo 00000033 >');
    expect(warning).toHaveTextContent('would set 0000001b');
    expect(warning).toHaveTextContent('Write 0x33 to mean what this file says');
  });

  it('says when that write would be refused rather than taken', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'everything' }));
    render(<PidCoredumpFilterApp />);

    const warning = await screen.findByTestId('round-trip');

    expect(warning).toHaveTextContent('echo 000001ff > is refused');
    expect(warning).toHaveTextContent('EINVAL');
  });

  it('reads every bit set as the widest core the kernel will write', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'everything' }));
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByTestId('everything')).toBeInTheDocument();
    expect(await screen.findByTestId('widened')).toHaveTextContent(
      'file-backed private, file-backed shared, shared huge pages, private DAX pages, shared DAX pages',
    );
    expect(await stateOf(8)).toContain('dumped');
  });

  /** Bit 2 dumps the mapping whole, so bit 4 above it decides nothing. */
  it('says when the ELF header bit has nothing left to decide', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'mapped-too' }));
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByTestId('redundant')).toHaveTextContent(
      'Bit 4 has nothing left to decide',
    );
  });

  it('reads a filter of all zeroes as a core with no memory in it', async () => {
    open('12282');
    vi.stubGlobal('fetch', mockServer({ fixture: 'nothing', pid: '12282' }));
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByTestId('nothing')).toHaveTextContent('There would still be a core');
    expect(await screen.findByTestId('narrowed')).toBeInTheDocument();
    // The headers are out too, but saying so under "no memory at all" would be
    // the smaller half of what the notice above it already said.
    expect(screen.queryByTestId('no-headers')).not.toBeInTheDocument();
    // Zero is the one value octal and hex agree on, so that write is harmless.
    expect(screen.queryByTestId('round-trip')).not.toBeInTheDocument();
  });

  it('reads an empty file as a process with no memory to print from', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('This file is empty');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reads a file that does not hold a number as one that came from elsewhere', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'all\n' }));
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByTestId('unreadable')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  /** A write walks nine bits, so anything wider did not come through it. */
  it('names bits above the nine, which no write can set', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'ffffffff\n' }));
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByTestId('unknown-bits')).toHaveTextContent('this file has none of them');
    expect(await stateOf(8)).toContain('dumped');
  });

  it('says when the number is not written the way the kernel writes it', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '33' }));
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByTestId('reformatted')).toBeInTheDocument();
    expect(screen.getByTestId('unterminated')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidCoredumpFilterApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(coredumpFilter('default'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidCoredumpFilterApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /** Mode 0644, so a refusal here is the backend's rather than the file's. */
  it('reports a refused read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 403 }));
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/coredump_filter (HTTP 403 Forbidden)',
    );
  });

  it('reports a process that is not there', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<PidCoredumpFilterApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/coredump_filter (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'default', pid: 'self', value: '00000033', dumped: '4 of 9' },
  { fixture: 'everything', pid: 'self', value: '000001ff', dumped: '9 of 9' },
  { fixture: 'mapped-too', pid: 'self', value: '00000037', dumped: '5 of 9' },
  { fixture: 'nothing', pid: '12282', value: '00000000', dumped: '0 of 9' },
])('PidCoredumpFilterApp with whatever the server serves: $fixture', ({ fixture, pid, value, dumped }) => {
  it(`renders ${value}`, async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture, pid }));
    render(<PidCoredumpFilterApp />);

    const summary = await screen.findByTestId('summary');

    expect(summary).toHaveTextContent(value);
    expect(summary).toHaveTextContent(dumped);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
