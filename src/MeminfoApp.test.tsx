import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readMeminfoFixture as meminfo } from './test/fixtures';
import { MeminfoApp } from './MeminfoApp';

/** Stands in for the backend serving /proc/meminfo. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/meminfo') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? meminfo(options.fixture ?? 'desktop-16g'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Memory fields' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a field, matched on its first cell. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === name)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MeminfoApp', () => {
  it('requests /proc/meminfo from its own path', async () => {
    render(<MeminfoApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/meminfo',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per field', async () => {
    render(<MeminfoApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(39 + 1);
  });

  /**
   * The kernel writes kB and means KiB, so the page shows the size converted
   * with the line as printed beside it.
   */
  it('reads kB as KiB and shows both', async () => {
    render(<MeminfoApp />);

    const row = await rowFor('MemTotal');
    expect(row).toHaveTextContent('16 GiB');
    expect(within(row).getByTitle('Printed as kB, which is KiB — 1024 bytes')).toHaveTextContent(
      '16,316,776 kB',
    );
  });

  /**
   * A HugePages_* field is a count of pages. Formatting one as memory would be
   * wrong by whatever a huge page happens to be.
   */
  it('leaves a count as a count', async () => {
    render(<MeminfoApp />);

    const row = await rowFor('HugePages_Total');
    expect(
      within(row).getByTitle('A count of pages, not an amount of memory'),
    ).toHaveTextContent('count');
    expect(row).not.toHaveTextContent('KiB');
    // The size beside it is a size.
    expect(await rowFor('Hugepagesize')).toHaveTextContent('2.0 MiB');
  });

  it('summarizes the totals', async () => {
    render(<MeminfoApp />);

    expect(await screen.findByText('total')).toBeInTheDocument();
    expect(stat('total')).toHaveTextContent('16 GiB');
    expect(stat('available')).toHaveTextContent('9.1 GiB');
    expect(stat('in use')).toHaveTextContent('38%');
    expect(stat('swap used')).toHaveTextContent('184 MiB · 9%');
  });

  // Used, cache and free across the width, the way free lays them out.
  it('draws memory as used, cache and free', async () => {
    render(<MeminfoApp />);

    await table();
    const segments = document.querySelectorAll('.mem__segment');
    expect(segments).toHaveLength(3);
    expect(segments[1]).toHaveAttribute(
      'title',
      expect.stringContaining('buffers & cache: 9.4 GiB'),
    );
  });

  /**
   * MemAvailable is the kernel's estimate rather than free plus cache, which
   * is the thing most worth saying on this page.
   */
  it('explains what available means', async () => {
    render(<MeminfoApp />);

    await table();
    expect(screen.getByText(/without swapping/)).toBeInTheDocument();
    expect(screen.getByText(/some of the cache cannot be given back/)).toBeInTheDocument();
  });

  it('says so when the kernel gives no estimate at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    render(<MeminfoApp />);

    expect(await screen.findByText(/prints no/)).toHaveTextContent(/MemAvailable/);
    expect(stat('available')).toHaveTextContent('—');
  });

  it('shows the huge page pool as a count and a size', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'server-256g' }));
    render(<MeminfoApp />);

    await table();
    const chips = screen.getByTestId('hugepages').querySelectorAll('.chip');
    expect([...chips].map((chip) => chip.textContent)).toEqual([
      '32,768 huge pages',
      '2.0 MiB each 64 GiB reserved',
      '4,096 free',
    ]);
  });

  it('leaves the swap tile out when there is no swap', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-swap' }));
    render(<MeminfoApp />);

    await table();
    expect(screen.queryByText('swap used')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hugepages')).not.toBeInTheDocument();
  });

  it('shows a machine with most of its swap in use', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'vm-swapping' }));
    render(<MeminfoApp />);

    await table();
    expect(stat('swap used')).toHaveTextContent('1.4 GiB · 70%');
    expect(stat('in use')).toHaveTextContent('65%');
  });

  it('lists a field it has no note for rather than dropping it', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'MemTotal:  1024 kB\nSomethingNew:  512 kB\n' }));
    render(<MeminfoApp />);

    const row = await rowFor('SomethingNew');
    expect(within(row).getByTitle('This page has no note for this field')).toBeInTheDocument();
    expect(row).toHaveTextContent('512 KiB');
  });

  it('says an unreadable file has no fields rather than showing zeroes', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<MeminfoApp />);

    expect(await screen.findByText(/no fields found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<MeminfoApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(meminfo('desktop-16g'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<MeminfoApp />);

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
    render(<MeminfoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/meminfo (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the kernel with no MemAvailable.
describe.each([
  { fixture: 'desktop-16g', total: '16 GiB' },
  { fixture: 'server-256g', total: '252 GiB' },
  { fixture: 'vm-swapping', total: '1.9 GiB' },
  { fixture: 'no-swap', total: '3.9 GiB' },
  { fixture: 'legacy-2.6', total: '1011 MiB' },
])('MeminfoApp with whatever the server serves: $fixture', ({ fixture, total }) => {
  it(`renders a total of ${total}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<MeminfoApp />);

    await table();
    expect(stat('total')).toHaveTextContent(total);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
