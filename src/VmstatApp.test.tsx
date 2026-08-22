import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readVmstatFixture as vmstat } from './test/fixtures';
import { VmstatApp } from './VmstatApp';

/** Stands in for the backend serving /proc/vmstat. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/vmstat') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? vmstat(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const levels = () => screen.findByRole('table', { name: 'Levels' });

/** The row for one field, in whichever table it landed in. */
const rowFor = (name: string): HTMLElement => {
  const rows = screen.getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === name)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VmstatApp', () => {
  it('requests /proc/vmstat from its own path', async () => {
    render(<VmstatApp />);

    await levels();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/vmstat',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  /** Levels and counters are different kinds of number, so different tables. */
  it('keeps the levels apart from the counters since boot', async () => {
    render(<VmstatApp />);

    const levelTable = await levels();
    expect(within(levelTable).getAllByRole('row').length).toBeGreaterThan(30);
    expect(within(levelTable).getByText('nr_free_pages')).toBeInTheDocument();
    expect(within(levelTable).queryByText('pgfault')).not.toBeInTheDocument();

    const paging = screen.getByRole('table', { name: 'Paging and faults' });
    expect(within(paging).getByText('pgfault')).toBeInTheDocument();
  });

  it('summarizes what the levels say about memory right now', async () => {
    render(<VmstatApp />);

    expect(await screen.findByText('free')).toBeInTheDocument();
    expect(stat('free')).toHaveTextContent('2.4 GiB');
    expect(stat('page cache')).toHaveTextContent('5.3 GiB');
    expect(stat('fields')).toHaveTextContent('195');
  });

  it('turns a page count into the memory it stands for', async () => {
    render(<VmstatApp />);

    await levels();
    const row = rowFor('nr_free_pages');
    expect(row).toHaveTextContent('2.4 GiB');
    expect(within(row).getByTitle('621,879 pages')).toBeInTheDocument();
  });

  /** pgpgin is kilobytes, and multiplying it by the page size overstates it. */
  it('converts the kilobyte fields as kilobytes', async () => {
    render(<VmstatApp />);

    await levels();
    const row = rowFor('pgpgin');
    expect(
      within(row).getByTitle('Counted in kilobytes by the kernel, not in pages'),
    ).toHaveTextContent('3.7 GiB');
    expect(row).toHaveTextContent(/kilobytes/);
  });

  it('leaves a counter of events without a memory figure', async () => {
    render(<VmstatApp />);

    await levels();
    expect(
      within(rowFor('pgfault')).getByTitle('A count of events, not of memory'),
    ).toBeInTheDocument();
  });

  it('groups the counters into families', async () => {
    render(<VmstatApp />);

    await levels();
    expect(screen.getByRole('table', { name: 'Reclaim' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'NUMA allocation and balancing' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Hugepages' })).toBeInTheDocument();
  });

  it('says a machine that never reclaimed has no efficiency to report', async () => {
    render(<VmstatApp />);

    await levels();
    expect(screen.getByTestId('derived')).toHaveTextContent('reclaim efficiency never reclaimed');
    expect(screen.queryByTestId('direct-reclaim')).not.toBeInTheDocument();
    expect(screen.queryByTestId('oom')).not.toBeInTheDocument();
  });

  it('hides the fields sitting at zero when asked', async () => {
    const user = userEvent.setup();
    render(<VmstatApp />);
    const before = within(await levels()).getAllByRole('row').length;

    await user.click(screen.getByRole('checkbox'));

    expect(within(await levels()).getAllByRole('row').length).toBeLessThan(before);
    expect(screen.queryByText('nr_zspages')).not.toBeInTheDocument();
  });

  /** Direct reclaim is an allocation stalling to free memory itself. */
  it('calls out direct reclaim and what it cost', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'under-pressure' }));
    render(<VmstatApp />);

    await levels();
    const notice = screen.getByTestId('direct-reclaim');
    expect(notice).toHaveTextContent('15% of reclaim scanning was direct reclaim');
    // 88,442 + 1,204, summed across the per-zone allocstall fields.
    expect(notice).toHaveTextContent('89.6k allocations stalled');
    expect(screen.getByTestId('derived')).toHaveTextContent('reclaim efficiency 76%');
  });

  it('reports the kills as the counter they are', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'under-pressure' }));
    render(<VmstatApp />);

    await levels();
    expect(screen.getByTestId('oom')).toHaveTextContent(
      'out-of-memory killer has killed 3 processes since boot',
    );
    expect(screen.getByTestId('oom')).toHaveTextContent('not that anything is wrong now');
  });

  it('shows the refaults being short of memory cost', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'under-pressure' }));
    render(<VmstatApp />);

    await levels();
    expect(screen.getByTestId('derived')).toHaveTextContent('refaults 16.0M');
    expect(screen.getByTestId('derived')).toHaveTextContent('swap 1.9M in · 4.1M out');
  });

  it('shows the share of allocations that came off another node', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'numa-2node' }));
    render(<VmstatApp />);

    await levels();
    expect(screen.getByTestId('derived')).toHaveTextContent('NUMA miss 1%');
  });

  /**
   * A 3.x kernel counts reclaim per zone, so the figure has to be summed over
   * the prefix rather than read from one field.
   */
  it('sums the per-zone reclaim counters an older kernel prints', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-3.x' }));
    render(<VmstatApp />);

    await levels();
    expect(screen.getByTestId('derived')).toHaveTextContent('reclaim efficiency 68%');
    expect(stat('fields')).toHaveTextContent('110');
    expect(screen.getByRole('table', { name: 'Reclaim' })).toHaveTextContent(
      'pgscan_kswapd_normal',
    );
  });

  it('renders a machine leaning on hugepages', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'thp-heavy' }));
    render(<VmstatApp />);

    await levels();
    expect(screen.getByRole('table', { name: 'Hugepages' })).toHaveTextContent('thp_fault_alloc');
    expect(rowFor('thp_fault_alloc')).toHaveTextContent('8.8M');
  });

  it('keeps a field it has never heard of', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nr_free_pages 100\nsome_new_counter 42\n' }));
    render(<VmstatApp />);

    await levels();
    expect(rowFor('some_new_counter')).toHaveTextContent('A field this page has no note for');
  });

  it('says an unreadable file has no fields', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<VmstatApp />);

    expect(await screen.findByText(/no fields found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<VmstatApp />);
    await levels();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(vmstat('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<VmstatApp />);

    await levels();
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
    render(<VmstatApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/vmstat (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', fields: 195 },
  { fixture: 'under-pressure', fields: 195 },
  { fixture: 'numa-2node', fields: 195 },
  { fixture: 'thp-heavy', fields: 195 },
  { fixture: 'legacy-3.x', fields: 110 },
])('VmstatApp with whatever the server serves: $fixture', (each) => {
  it(`reads ${each.fields} fields`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: each.fixture }));
    render(<VmstatApp />);

    await screen.findByRole('table', { name: 'Levels' });
    expect(stat('fields')).toHaveTextContent(String(each.fields));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
