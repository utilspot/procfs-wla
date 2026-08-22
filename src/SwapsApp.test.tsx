import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSwapsFixture as swaps } from './test/fixtures';
import { SwapsApp } from './SwapsApp';

/** Stands in for the backend serving /proc/swaps. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/swaps') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? swaps(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const table = () => screen.findByRole('table', { name: 'Swap areas' });

/** The row for one area, by the filename in its first cell. */
const rowFor = async (filename: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent?.startsWith(filename))!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SwapsApp', () => {
  it('requests /proc/swaps from its own path', async () => {
    render(<SwapsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/swaps',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per swap area', async () => {
    render(<SwapsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(1 + 1);
    expect(await rowFor('/dev/nvme0n1p3')).toHaveTextContent('partition');
  });

  /** The file prints no unit, and the figures are KiB. */
  it('summarizes swap in the units the file counts in', async () => {
    render(<SwapsApp />);

    expect(await screen.findByText('swap')).toBeInTheDocument();
    expect(stat('swap')).toHaveTextContent('8.0 GiB');
    expect(stat('used')).toHaveTextContent('1.7 GiB · 21%');
    expect(stat('free')).toHaveTextContent('6.3 GiB');
    expect(stat('areas')).toHaveTextContent('1');
  });

  it('says a negative priority was the kernel’s own choice', async () => {
    render(<SwapsApp />);

    const row = await rowFor('/dev/nvme0n1p3');
    expect(row).toHaveTextContent('-2 auto');
    expect(
      within(row).getByTitle('The kernel’s own number, counting down as each area was swapped on'),
    ).toBeInTheDocument();
  });

  it('shows how much of an area is spoken for', async () => {
    render(<SwapsApp />);

    const row = await rowFor('/dev/nvme0n1p3');
    expect(within(row).getByLabelText('21% of /dev/nvme0n1p3 in use')).toBeInTheDocument();
    expect(within(row).getByTitle('8,388,604 KiB')).toBeInTheDocument();
  });

  it('unescapes a swap file at a path with a space in it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'swapfiles' }));
    render(<SwapsApp />);

    expect(await rowFor('/mnt/data/swap file')).toBeInTheDocument();
    expect(await rowFor('/var/lib/machines/container-01/swapfile.img')).toBeInTheDocument();
  });

  /** Highest priority first, which is the order the kernel fills them in. */
  it('reads the fill order off the priorities', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'swapfiles' }));
    render(<SwapsApp />);

    await table();
    const chips = screen.getByTestId('fill-order').querySelectorAll('.chip');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent('first /swapfile');
    expect(chips[0]).toHaveAttribute('title', 'Priority -2');
    expect(chips[2]).toHaveTextContent('then /var/lib/machines/container-01/swapfile.img');
  });

  /** Equal priorities are the only way to stripe swap across two devices. */
  it('says when two areas share a priority', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'striped-pair' }));
    render(<SwapsApp />);

    await table();
    const chips = screen.getByTestId('fill-order').querySelectorAll('.chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('/dev/nvme0n1p2 + /dev/nvme1n1p2');
    expect(chips[0]).toHaveTextContent('striped');
  });

  it('marks a zram area as the compressed memory it is', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'zram-first' }));
    render(<SwapsApp />);

    const row = await rowFor('/dev/zram0');
    expect(within(row).getByText('compressed RAM')).toBeInTheDocument();
    expect(await rowFor('/dev/sda3')).toHaveClass('swap__row--untouched');
  });

  /** The header with nothing under it is ordinary, not a failure. */
  it('says a machine with no swap has none, rather than failing', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-swap' }));
    render(<SwapsApp />);

    expect(await screen.findByText(/nothing is swapped on/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns when there is almost nowhere left to swap', async () => {
    vi.stubGlobal('fetch', mockServer({ body: swaps('desktop').replace('1743872', '8000000') }));
    render(<SwapsApp />);

    await table();
    expect(screen.getByRole('status')).toHaveTextContent('95% of swap is spoken for');
  });

  it('says an unreadable file is not this file', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<SwapsApp />);

    expect(await screen.findByText(/no swap areas and no header/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<SwapsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(swaps('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<SwapsApp />);

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
    render(<SwapsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/swaps (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', areas: 1 },
  { fixture: 'swapfiles', areas: 3 },
  { fixture: 'striped-pair', areas: 2 },
  { fixture: 'zram-first', areas: 2 },
  { fixture: 'no-swap', areas: 0 },
])('SwapsApp with whatever the server serves: $fixture', ({ fixture, areas }) => {
  it(`renders ${areas} areas`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<SwapsApp />);

    if (areas === 0) {
      expect(await screen.findByText(/nothing is swapped on/i)).toBeInTheDocument();
    } else {
      const rendered = await screen.findByRole('table', { name: 'Swap areas' });
      expect(within(rendered).getAllByRole('row')).toHaveLength(areas + 1);
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
