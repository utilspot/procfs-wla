import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readUidIoStatsFixture as uidIo } from './test/fixtures';
import { UidIoStatsApp } from './UidIoStatsApp';

/** Stands in for the backend serving /proc/uid_io/stats. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/uid_io/stats') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? uidIo(options.fixture ?? 'raspberry-pi'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'I/O per uid' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a uid, matched on the first cell. */
const rowFor = async (uid: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent?.startsWith(uid))!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UidIoStatsApp', () => {
  /** The page is served at uid_io/stats and reads the path its URL names. */
  it('requests /proc/uid_io/stats from its own path', async () => {
    render(<UidIoStatsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/uid_io/stats',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per uid, busiest first', async () => {
    render(<UidIoStatsApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(4 + 1);
    expect(rows[1]).toHaveTextContent('0');
  });

  it('summarizes what the uids moved and how deep it went', async () => {
    render(<UidIoStatsApp />);

    await table();
    expect(stat('uids')).toHaveTextContent('4');
    // 866 + 4361 fsyncs across the file.
    expect(stat('fsyncs')).toHaveTextContent('5,227');
  });

  /** rchar is what the uid asked for; read_bytes is what the disk moved. */
  it('shows the calls above and the block layer underneath', async () => {
    render(<UidIoStatsApp />);

    const row = await rowFor('0');
    expect(row).toHaveTextContent('5.3 GiB');
    expect(within(row).getByTitle('Fetched by the block layer')).toHaveTextContent('794 MiB');
    expect(
      within(row).getByTitle(/Written back so far, leaving 1\.4 GiB still dirty/),
    ).toBeInTheDocument();
  });

  /**
   * Readahead fetches what a program has not asked for, so the disk can be read
   * harder than the uid ever read.
   */
  it('says where the block layer fetched more than the uid asked for', async () => {
    render(<UidIoStatsApp />);

    expect(
      await screen.findByText(/uid 992 read 24 KiB and the block layer fetched 92 KiB for it/),
    ).toBeInTheDocument();
    expect(
      within(await rowFor('992')).getByTitle(
        'Fetched by the block layer — more than this uid asked for',
      ),
    ).toBeInTheDocument();
  });

  /** Nothing in this capture has ever been accounted in the background. */
  it('marks a uid never accounted in the background', async () => {
    render(<UidIoStatsApp />);

    const row = await rowFor('65534');
    expect(
      within(row).getByTitle('Never accounted in the background state at all'),
    ).toHaveTextContent('foreground only');
  });

  it('splits a uid that works in both states', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'background-heavy' }));
    render(<UidIoStatsApp />);

    const app = await rowFor('10123');
    expect(within(app).getByText('u0_a123')).toBeInTheDocument();
    expect(within(app).getByTitle('5% foreground, 95% background')).toBeInTheDocument();
    expect(within(app).queryByText('foreground only')).not.toBeInTheDocument();
  });

  it('says nothing about readahead where no uid over-read', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'background-heavy' }));
    render(<UidIoStatsApp />);

    await table();
    expect(screen.queryByText(/the block layer fetched/)).not.toBeInTheDocument();
  });

  /** Everything out of the page cache, pipes and ttys: no disk in any of it. */
  it('renders traffic that never reached a disk', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'cache-only' }));
    render(<UidIoStatsApp />);

    await table();
    expect(stat('moved by the block layer')).toHaveTextContent('0 B');
    expect(within(await rowFor('2000')).getByText('shell')).toBeInTheDocument();
  });

  it('shows a uid with no fsync at all as having none', async () => {
    render(<UidIoStatsApp />);

    const row = await rowFor('992');
    const cells = within(row).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('—');
  });

  it('says an empty file is a driver that has accounted nothing', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'empty' }));
    render(<UidIoStatsApp />);

    expect(await screen.findByText(/No uid in this file/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<UidIoStatsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(uidIo('raspberry-pi'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<UidIoStatsApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /** A machine without that driver has no such file, which is most of them. */
  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<UidIoStatsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/uid_io/stats (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'raspberry-pi', uids: '4' },
  { fixture: 'background-heavy', uids: '4' },
  { fixture: 'cache-only', uids: '3' },
])('UidIoStatsApp with whatever the server serves: $fixture', ({ fixture, uids }) => {
  it(`renders ${uids} uids`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<UidIoStatsApp />);

    await table();
    expect(stat('uids')).toHaveTextContent(uids);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
