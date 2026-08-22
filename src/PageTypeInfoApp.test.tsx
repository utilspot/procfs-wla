import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPageTypeInfoFixture as pagetypeinfo } from './test/fixtures';
import { PageTypeInfoApp } from './PageTypeInfoApp';

/** Stands in for the backend serving /proc/pagetypeinfo. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/pagetypeinfo') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? pagetypeinfo(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** One zone's table of free blocks. */
const zone = (node: number, name: string) =>
  screen.findByRole('table', { name: `Free blocks in node ${node} zone ${name}` });

/** The row for a migrate type within a zone's table. */
const rowFor = async (table: HTMLElement, type: string): Promise<HTMLElement> => {
  const rows = within(table).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === type)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PageTypeInfoApp', () => {
  it('requests /proc/pagetypeinfo from its own path', async () => {
    render(<PageTypeInfoApp />);

    await zone(0, 'Normal');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/pagetypeinfo',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a card per zone, with a row per migrate type', async () => {
    render(<PageTypeInfoApp />);

    await zone(0, 'Normal');
    expect(document.querySelectorAll('.ptype')).toHaveLength(3);
    expect(within(await zone(0, 'DMA')).getAllByRole('row')).toHaveLength(6 + 1);
  });

  it('summarizes the machine’s free memory and its geometry', async () => {
    render(<PageTypeInfoApp />);

    expect(await screen.findByText('zones')).toBeInTheDocument();
    expect(stat('zones')).toHaveTextContent('3 on 1 node');
    expect(stat('pageblock')).toHaveTextContent('2.0 MiB · order 9');
    expect(stat('orders')).toHaveTextContent('11');
  });

  /**
   * A block at order N is 2^N pages, so a row's free total has to weight each
   * order rather than adding the counts.
   */
  it('weights each order by what a block there is worth', async () => {
    render(<PageTypeInfoApp />);

    const row = await rowFor(await zone(0, 'DMA'), 'Movable');
    // One order-9 block and three order-10: 2 MiB plus 12 MiB.
    expect(row).toHaveTextContent('14 MiB');
  });

  it('names the largest run each type can still satisfy', async () => {
    render(<PageTypeInfoApp />);

    const table = await zone(0, 'DMA');
    expect(await rowFor(table, 'Movable')).toHaveTextContent('4.0 MiB');
    expect(
      within(await rowFor(table, 'CMA')).getByTitle('Nothing free of this type at any order'),
    ).toBeInTheDocument();
  });

  it('explains what each order column holds', async () => {
    render(<PageTypeInfoApp />);

    const table = await zone(0, 'DMA');
    expect(within(table).getByTitle('Blocks of 2.0 MiB')).toHaveTextContent('9');
    expect(within(table).getByTitle('1 free block of 16 KiB')).toBeInTheDocument();
  });

  // The pageblock counts are what say whether a machine is fragmenting.
  it('shows the pageblocks a zone owns, by type', async () => {
    render(<PageTypeInfoApp />);

    await zone(0, 'Normal');
    const blocks = document.querySelectorAll('.ptype')[2]!.querySelector('.ptype__blocks')!;
    expect(blocks).toHaveTextContent('7,337 pageblocks:');
    const movable = [...blocks.querySelectorAll('.chip')].find((chip) =>
      chip.textContent?.startsWith('Movable'),
    )!;
    expect(movable).toHaveTextContent('Movable 6,820');
    expect(movable).toHaveAttribute(
      'title',
      expect.stringContaining("93% of this zone's blocks"),
    );
  });

  it('describes what a migrate type is', async () => {
    render(<PageTypeInfoApp />);

    const row = await rowFor(await zone(0, 'DMA'), 'Unmovable');
    expect(row.querySelector('td')).toHaveAttribute(
      'title',
      'Kernel allocations, which cannot be relocated to make room for anything',
    );
  });

  /**
   * Plenty free and nothing in a run large enough to hand out is exactly what
   * this file exists to show.
   */
  it('calls out a zone with nothing as large as a pageblock', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'fragmented' }));
    render(<PageTypeInfoApp />);

    expect(
      await screen.findByText(/has nothing free as large as a pageblock/),
    ).toHaveTextContent('node 0 DMA, node 0 Normal');
  });

  it('says nothing of the sort when every zone has one', async () => {
    render(<PageTypeInfoApp />);

    await zone(0, 'Normal');
    expect(screen.queryByText(/as large as a pageblock/)).not.toBeInTheDocument();
  });

  it('keeps each NUMA node’s zones apart', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'numa-2node' }));
    render(<PageTypeInfoApp />);

    await zone(1, 'Normal');
    expect(stat('zones')).toHaveTextContent('3 on 2 nodes');
    expect(screen.getByRole('heading', { name: 'Node 1, zone Normal' })).toBeInTheDocument();
  });

  // A different architecture puts the pageblock somewhere else.
  it('reads the pageblock order from the file rather than assuming it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'arm-cma' }));
    render(<PageTypeInfoApp />);

    await zone(0, 'DMA');
    expect(stat('pageblock')).toHaveTextContent('4.0 MiB · order 10');
    expect(stat('orders')).toHaveTextContent('12');
  });

  it('totals the free memory by type', async () => {
    render(<PageTypeInfoApp />);

    await zone(0, 'Normal');
    const chips = screen.getByTestId('totals').querySelectorAll('.chip');
    expect(chips[0]?.textContent).toMatch(/^Movable /);
    expect(chips[0]).toHaveAttribute(
      'title',
      'User pages, which the kernel can move elsewhere when it needs the space',
    );
  });

  it('says an unreadable file has no zones', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<PageTypeInfoApp />);

    expect(await screen.findByText(/no zones found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PageTypeInfoApp />);
    await zone(0, 'Normal');

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(pagetypeinfo('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PageTypeInfoApp />);

    await zone(0, 'Normal');
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
    render(<PageTypeInfoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/pagetypeinfo (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', zones: 3 },
  { fixture: 'fragmented', zones: 2 },
  { fixture: 'numa-2node', zones: 3 },
  { fixture: 'arm-cma', zones: 1 },
  { fixture: 'vm-small', zones: 1 },
])('PageTypeInfoApp with whatever the server serves: $fixture', ({ fixture, zones: count }) => {
  it(`renders ${count} zones`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<PageTypeInfoApp />);

    await screen.findAllByRole('table');
    expect(document.querySelectorAll('.ptype')).toHaveLength(count);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
