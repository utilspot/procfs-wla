import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readBuddyInfoFixture as buddyinfo } from './test/fixtures';
import { BuddyInfoApp } from './BuddyInfoApp';

/** Stands in for the backend serving /proc/buddyinfo. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/buddyinfo') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? buddyinfo(options.fixture ?? 'desktop-healthy'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Free blocks by order' });

/** The row for a zone, matched on the name in its first cell. */
const rowFor = async (zone: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.childNodes[0]?.textContent === zone)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BuddyInfoApp', () => {
  it('requests /proc/buddyinfo from its own path', async () => {
    render(<BuddyInfoApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/buddyinfo',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per zone and a column per order', async () => {
    render(<BuddyInfoApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(3 + 1);
    // Zone, Free, Largest block, bar, then 11 order columns.
    expect(within(rows[0]!).getAllByRole('columnheader')).toHaveLength(4 + 11);
  });

  it('summarizes the machine', async () => {
    render(<BuddyInfoApp />);

    expect(await screen.findByText('free memory')).toBeInTheDocument();
    expect(screen.getByText('free memory').previousSibling).toHaveTextContent('5.6 GiB');
    expect(screen.getByText('largest contiguous block').previousSibling).toHaveTextContent(
      '4.0 MiB',
    );
    // Single node, so the NUMA tile is left off.
    expect(screen.queryByText('NUMA nodes')).not.toBeInTheDocument();
  });

  it('shows the free memory and largest block per zone', async () => {
    render(<BuddyInfoApp />);

    const row = await rowFor('Normal');
    expect(row).toHaveTextContent('4.4 GiB');
    expect(row).toHaveTextContent('order 10');
  });

  /**
   * A block of order N is 2^N pages, so a handful of high-order blocks can hold
   * most of a zone. The bar weights by memory, and the tooltip says both.
   */
  it('weights the bar by memory rather than block count', async () => {
    render(<BuddyInfoApp />);

    const row = await rowFor('DMA');
    // One order-0 page against three order-10 blocks.
    expect(within(row).getByTitle(/^order 0: 1 blocks of 4\.0 KiB/)).toBeInTheDocument();

    const top = within(row).getByTitle(/^order 10: 3 blocks of 4\.0 MiB/);
    expect(top).toHaveAttribute('title', expect.stringContaining('12 MiB, 77.3%'));
    expect(Number.parseFloat((top as HTMLElement).style.width)).toBeGreaterThan(70);
  });

  it('shows the raw block counts too', async () => {
    render(<BuddyInfoApp />);

    const cells = within(await rowFor('DMA')).getAllByRole('cell');
    // The four fixed columns, then order 0..10.
    expect(cells.slice(4).map((cell) => cell.textContent)).toEqual([
      '1', '1', '1', '·', '2', '1', '1', '·', '1', '1', '3',
    ]);
  });

  it('says nothing about fragmentation on a healthy machine', async () => {
    render(<BuddyInfoApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // The point of the file: gigabytes free, and a 64 KiB request still fails.
  it('warns when a zone has memory but no large blocks', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'fragmented' }));
    render(<BuddyInfoApp />);

    await table();
    const warning = screen.getByRole('status');

    expect(warning).toHaveTextContent('2 zones hold memory but cannot satisfy a 64 KiB');
    expect(warning).toHaveTextContent('nothing above order 3');
    expect(within(await rowFor('Normal')).getByText('fragmented')).toBeInTheDocument();
    expect(screen.getByText('largest contiguous block').previousSibling).toHaveTextContent(
      '32 KiB',
    );
  });

  it('leaves a tiny zone unflagged however short of high orders it is', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'fragmented' }));
    render(<BuddyInfoApp />);

    expect(within(await rowFor('DMA')).queryByText('fragmented')).not.toBeInTheDocument();
  });

  it('shows both nodes on a NUMA machine', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'numa-2node' }));
    render(<BuddyInfoApp />);

    await table();
    expect(screen.getByText('NUMA nodes').previousSibling).toHaveTextContent('2');
    expect(within(await table()).getAllByRole('row')).toHaveLength(4 + 1);
    // Two zones share the name Normal, told apart by their node.
    expect(screen.getAllByText('node 1')).toHaveLength(1);
  });

  // The column count comes from the file, not from an assumption about 11.
  it('renders a kernel with thirteen orders', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'arm-max-order-13' }));
    render(<BuddyInfoApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(within(rows[0]!).getAllByRole('columnheader')).toHaveLength(4 + 13);
    expect(screen.getByText('largest contiguous block').previousSibling).toHaveTextContent(
      '16 MiB',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<BuddyInfoApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(buddyinfo('desktop-healthy'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<BuddyInfoApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no zones', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<BuddyInfoApp />);

    expect(await screen.findByText(/no memory zones found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<BuddyInfoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/buddyinfo (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from a freshly booted machine to a badly fragmented one.
describe.each([
  { fixture: 'desktop-healthy', zones: 3, free: '5.6 GiB' },
  { fixture: 'fragmented', zones: 3, free: '1.5 GiB' },
  { fixture: 'numa-2node', zones: 4, free: '6.7 GiB' },
  { fixture: 'after-boot', zones: 3, free: '41 GiB' },
  { fixture: 'arm-max-order-13', zones: 2, free: '3.8 GiB' },
])('BuddyInfoApp with whatever the server serves: $fixture', ({ fixture, zones, free }) => {
  it(`renders ${zones} zones holding ${free}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<BuddyInfoApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(zones + 1);
    expect(screen.getByText('free memory').previousSibling).toHaveTextContent(free);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
