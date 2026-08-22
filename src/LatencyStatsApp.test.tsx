import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readLatencyStatsFixture as latencyStats } from './test/fixtures';
import { LatencyStatsApp } from './LatencyStatsApp';

/** Stands in for the backend serving /proc/latency_stats. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/latency_stats') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? latencyStats(options.fixture ?? 'idle-desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Recorded latencies' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The rows of the table, in the order the page put them. */
const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row whose first cell starts with this symbol. */
const rowFor = async (site: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelector('td')?.textContent?.startsWith(site))!;

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LatencyStatsApp', () => {
  it('requests /proc/latency_stats from its own path', async () => {
    render(<LatencyStatsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/latency_stats',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per record', async () => {
    render(<LatencyStatsApp />);

    expect(await rows()).toHaveLength(5);
    expect(await rowFor('poll_schedule_timeout')).toHaveTextContent('2,314');
  });

  it('summarizes the waits and the time they cost', async () => {
    render(<LatencyStatsApp />);

    expect(await screen.findByText('records')).toBeInTheDocument();
    expect(stat('records')).toHaveTextContent('5');
    expect(stat('waits')).toHaveTextContent('4,245');
    expect(stat('time waited')).toHaveTextContent('1.6 s');
    expect(stat('longest single wait')).toHaveTextContent('3.1 ms');
  });

  /**
   * The file gives a total and a maximum; the average is the division that
   * tells a steady wait from an occasional stall.
   */
  it('shows the average the file leaves out', async () => {
    render(<LatencyStatsApp />);

    const row = await rowFor('poll_schedule_timeout');
    // 985230 µs over 2314 waits, against a worst case of 1520.
    expect(row).toHaveTextContent('426 µs');
    expect(row).toHaveTextContent('1.5 ms');
  });

  // The file's order is its internal table's, so the page imposes a useful one.
  it('orders the rows by total time waited', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'io-bound' }));
    render(<LatencyStatsApp />);

    const sites = (await rows()).map((row) => row.querySelector('td')?.textContent);
    expect(sites[0]).toBe('io_schedule');
    expect(sites.at(-1)).toBe('rq_qos_wait');
  });

  /**
   * The costliest record and the one holding the longest single wait need not
   * be the same, so both are named.
   */
  it('names the worst by total and the worst single wait', async () => {
    render(<LatencyStatsApp />);

    await table();
    const chips = screen.getByTestId('worst').querySelectorAll('.chip');
    expect([...chips].map((chip) => chip.textContent)).toEqual([
      'poll_schedule_timeout 985 ms in total',
      'io_schedule 3.1 ms at worst',
    ]);
  });

  it('shows the path above the sleep, innermost first', async () => {
    render(<LatencyStatsApp />);

    const row = await rowFor('poll_schedule_timeout');
    const frames = within(row).getAllByRole('listitem');
    expect(frames.map((frame) => frame.textContent)).toEqual([
      'do_sys_poll',
      '__x64_sys_poll',
      'do_syscall_64',
      'entry_SYSCALL_64_after_hwframe',
    ]);
  });

  // Twelve frames is the limit the kernel keeps, so such a path may go further.
  it('marks a path that may have been cut off', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'deep-backtrace' }));
    render(<LatencyStatsApp />);

    const row = await rowFor('io_schedule');
    expect(
      within(row).getByTitle(
        'The kernel keeps 12 frames per record, so this path may go further',
      ),
    ).toBeInTheDocument();
    expect(within(await rowFor('mutex_lock')).queryByText('cut?')).not.toBeInTheDocument();
  });

  it('says so when a record has no frame above the sleep', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'deep-backtrace' }));
    render(<LatencyStatsApp />);

    expect(
      within(await rowFor('schedule')).getByTitle('The record holds no frame above this one'),
    ).toBeInTheDocument();
  });

  /**
   * The header is printed whether or not anything was recorded, so a file with
   * only a header is not an error and not an empty table.
   */
  it('explains a file with the header and nothing under it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'disabled' }));
    render(<LatencyStatsApp />);

    expect(await screen.findByText(/no latencies have been recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/kernel.latencytop/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a server whose worst wait is on a socket', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'network-server' }));
    render(<LatencyStatsApp />);

    expect(await rowFor('sk_wait_data')).toHaveTextContent('18,422');
    expect(stat('records')).toHaveTextContent('6');
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<LatencyStatsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(latencyStats('idle-desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<LatencyStatsApp />);

    await table();
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
    render(<LatencyStatsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/latency_stats (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine that recorded nothing.
describe.each([
  { fixture: 'idle-desktop', records: '5' },
  { fixture: 'io-bound', records: '5' },
  { fixture: 'deep-backtrace', records: '3' },
  { fixture: 'network-server', records: '6' },
])('LatencyStatsApp with whatever the server serves: $fixture', ({ fixture, records }) => {
  it(`renders ${records} records`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<LatencyStatsApp />);

    await table();
    expect(stat('records')).toHaveTextContent(records);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
