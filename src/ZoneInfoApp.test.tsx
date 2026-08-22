import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readZoneInfoFixture as zoneinfo } from './test/fixtures';
import { ZoneInfoApp } from './ZoneInfoApp';

/** Stands in for the backend serving /proc/zoneinfo. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/zoneinfo') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? zoneinfo(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const zone = (node: number, name: string) =>
  screen.findByRole('region', { name: `Node ${node}, zone ${name}` });

/** The row for one key within a zone's page table. */
const rowFor = (card: HTMLElement, key: string): HTMLElement => {
  const rows = within(card).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === key)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ZoneInfoApp', () => {
  it('requests /proc/zoneinfo from its own path', async () => {
    render(<ZoneInfoApp />);

    await zone(0, 'DMA');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/zoneinfo',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a card per zone', async () => {
    render(<ZoneInfoApp />);

    await zone(0, 'DMA');
    for (const name of ['DMA32', 'Normal', 'Movable', 'Device']) {
      expect(await zone(0, name)).toBeInTheDocument();
    }
  });

  it('summarizes what the allocator has across the zones', async () => {
    render(<ZoneInfoApp />);

    await zone(0, 'DMA');
    // 3,046,975 pages across DMA, DMA32 and Normal.
    expect(stat('managed')).toHaveTextContent('12 GiB');
    expect(stat('zones')).toHaveTextContent('5 on 1 node');
    expect(stat('reserved')).toHaveTextContent('MiB');
  });

  /**
   * The per-node block is printed under whichever zone comes first, and saying
   * so is the whole point of separating it.
   */
  it('gives the per-node stats their own card, and says where they were printed', async () => {
    render(<ZoneInfoApp />);

    const node = await screen.findByRole('region', { name: 'Node 0 statistics' });
    expect(node).toHaveTextContent('Printed under zone DMA');
    expect(node).toHaveTextContent('belonging to the node rather than to that zone');
  });

  it('unfolds the node’s counters on request', async () => {
    const user = userEvent.setup();
    render(<ZoneInfoApp />);
    const node = await screen.findByRole('region', { name: 'Node 0 statistics' });

    expect(screen.queryByRole('table', { name: 'Node 0 counters' })).not.toBeInTheDocument();
    await user.click(within(node).getByRole('button', { name: /Show the node’s \d+ counters/ }));

    const table = screen.getByRole('table', { name: 'Node 0 counters' });
    expect(within(table).getByText('nr_active_anon')).toBeInTheDocument();
  });

  /** Free caught between low and high, where kswapd finishes its pass. */
  it('says where each zone sits against its watermarks', async () => {
    render(<ZoneInfoApp />);

    const normal = await zone(0, 'Normal');
    expect(within(normal).getByTitle(/where kswapd keeps going/)).toHaveTextContent(
      'kswapd finishing',
    );
    const dma = await zone(0, 'DMA');
    expect(within(dma).getByTitle(/nothing is reclaiming/)).toHaveTextContent('above high');
  });

  it('draws the watermarks to scale', async () => {
    render(<ZoneInfoApp />);

    const normal = await zone(0, 'Normal');
    expect(
      within(normal).getByLabelText('16387 free, min 11721, low 14651, high 17581'),
    ).toBeInTheDocument();
  });

  /** Three page counts, and the gaps between them are worth naming. */
  it('works out the holes and the reservations from the three page counts', async () => {
    render(<ZoneInfoApp />);

    const dma32 = await zone(0, 'DMA32');
    expect(rowFor(dma32, 'spanned')).toHaveTextContent('1,044,480');
    expect(rowFor(dma32, 'holes')).toHaveTextContent('131,088');
    expect(rowFor(dma32, 'reserved')).toHaveTextContent('16,384');
    expect(rowFor(dma32, 'reserved')).toHaveTextContent('the allocator never got');
  });

  it('shows the lowmem_reserve array as the list it is', async () => {
    render(<ZoneInfoApp />);

    const dma = await zone(0, 'DMA');
    expect(within(dma).getByText('protection:')).toBeInTheDocument();
    expect(
      within(dma).getByTitle('Withheld from an allocation that could have used zone 2'),
    ).toHaveTextContent('11,887');
  });

  it('sums the pages held on the per-CPU lists', async () => {
    render(<ZoneInfoApp />);

    const normal = await zone(0, 'Normal');
    expect(normal).toHaveTextContent(/6 per-CPU lists holding [\d,]+ pages/);
    expect(screen.getByTestId('flags')).toHaveTextContent('per-CPU cached');
  });

  it('marks a zone with no memory in it, and hides it on request', async () => {
    const user = userEvent.setup();
    render(<ZoneInfoApp />);

    const movable = await zone(0, 'Movable');
    expect(within(movable).getByTitle(/No memory in this zone at all/)).toHaveTextContent('empty');
    expect(screen.getByTestId('flags')).toHaveTextContent('empty zones 2');

    await user.click(screen.getByRole('checkbox'));
    expect(screen.queryByRole('region', { name: 'Node 0, zone Movable' })).not.toBeInTheDocument();
  });

  it('says nothing about stalling on a machine with room', async () => {
    render(<ZoneInfoApp />);

    await zone(0, 'DMA');
    expect(screen.queryByTestId('stalling')).not.toBeInTheDocument();
  });

  /** Below min an allocation has to reclaim before it can proceed. */
  it('calls out a zone driven below its min watermark', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'under-pressure' }));
    render(<ZoneInfoApp />);

    await zone(0, 'DMA');
    const notice = screen.getByTestId('stalling');
    expect(notice).toHaveTextContent('node 0 Normal is below the min watermark');
    expect(notice).toHaveTextContent('has to stop and reclaim one first');
    expect(notice).toHaveTextContent('Node 0 has been marked unreclaimable');
  });

  it('renders a second node with its own stats block', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'numa-2node' }));
    render(<ZoneInfoApp />);

    expect(await zone(1, 'Normal')).toBeInTheDocument();
    expect(stat('zones')).toHaveTextContent('7 on 2 nodes');
    expect(await screen.findByRole('region', { name: 'Node 1 statistics' })).toHaveTextContent(
      'Printed under zone Normal',
    );
  });

  /** A kernel from before the reclaim lists moved off the zones. */
  it('renders a file with no per-node block at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-4.4' }));
    render(<ZoneInfoApp />);

    await zone(0, 'DMA');
    expect(screen.queryByRole('region', { name: 'Node 0 statistics' })).not.toBeInTheDocument();
    expect(screen.getByTestId('flags')).toHaveTextContent('per-zone LRU');
    expect(await zone(0, 'Normal')).toHaveTextContent('all_unreclaimable');
  });

  it('renders a small guest', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'vm-small' }));
    render(<ZoneInfoApp />);

    expect(await zone(0, 'Normal')).toHaveTextContent(/2 per-CPU lists/);
  });

  it('says an unreadable file has no zones', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<ZoneInfoApp />);

    expect(await screen.findByText(/no zones found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<ZoneInfoApp />);
    await zone(0, 'DMA');

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(zoneinfo('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<ZoneInfoApp />);

    await zone(0, 'DMA');
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
    render(<ZoneInfoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/zoneinfo (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', zones: 5 },
  { fixture: 'under-pressure', zones: 5 },
  { fixture: 'numa-2node', zones: 7 },
  { fixture: 'vm-small', zones: 4 },
  { fixture: 'legacy-4.4', zones: 3 },
])('ZoneInfoApp with whatever the server serves: $fixture', ({ fixture, zones }) => {
  it(`renders ${zones} zones`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<ZoneInfoApp />);

    await screen.findAllByRole('table');
    const cards = document.querySelectorAll(
      '.zi[aria-label^="Node 0, zone"], .zi[aria-label^="Node 1, zone"]',
    );
    expect(cards).toHaveLength(zones);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
