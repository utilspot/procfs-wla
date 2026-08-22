import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readIomemFixture as iomem } from './test/fixtures';
import { IomemApp } from './IomemApp';

/** Stands in for the backend serving /proc/iomem. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/iomem') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? iomem(options.fixture ?? 'desktop-x86'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Physical address map' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a region name, matched on its last cell. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td:last-child')?.textContent === name)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IomemApp', () => {
  it('requests /proc/iomem from its own path', async () => {
    render(<IomemApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/iomem',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per range, addresses as the kernel writes them', async () => {
    render(<IomemApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(32 + 1);
    expect(await rowFor('HPET 0')).toHaveTextContent('fed00000–fed003ff');
  });

  /**
   * Both bounds are inclusive, so the first range is a 4 KiB page rather than
   * 4095 bytes.
   */
  it('sizes an inclusive range', async () => {
    render(<IomemApp />);

    expect(await rowFor('Reserved')).toHaveTextContent('4.0 KiB');
  });

  it('summarizes the map', async () => {
    render(<IomemApp />);

    expect(await screen.findByText('regions')).toBeInTheDocument();
    expect(stat('regions')).toHaveTextContent('32');
    expect(stat('System RAM')).toHaveTextContent('16 GiB');
    expect(stat('top of map')).toHaveTextContent('41f7fffff');
    expect(stat('top level')).toHaveTextContent('19');
  });

  // A nested range is carved out of the one above it, and the indentation is
  // the only thing that says so.
  it('indents a nested range under its parent', async () => {
    render(<IomemApp />);

    const parent = (await rowFor('System RAM')).querySelector('td') as HTMLElement;
    const child = (await rowFor('Kernel code')).querySelector('td') as HTMLElement;
    const deeper = (await rowFor('i915')).querySelector('td') as HTMLElement;

    expect(parent.style.paddingLeft).toBe('0.5rem');
    expect(child.style.paddingLeft).toBe('1.5rem');
    expect(deeper.style.paddingLeft).toBe('2.5rem');
  });

  it('shows the System RAM ranges the total is made of', async () => {
    render(<IomemApp />);

    await table();
    const chips = screen.getByTestId('ram-ranges').querySelectorAll('.chip');
    expect([...chips].map((chip) => chip.textContent)).toEqual([
      '00001000 636 KiB',
      '00100000 154 MiB',
      '09b80000 3.1 GiB',
      '100000000 12 GiB',
    ]);
  });

  /**
   * Zeroed addresses are the kernel hiding them from an unprivileged reader,
   * not a map of nothing — so the page says so and offers no sizes worked out
   * from zeroes.
   */
  it('explains a file read without privilege', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'unprivileged' }));
    render(<IomemApp />);

    expect(await screen.findByText(/CAP_SYS_ADMIN/)).toBeInTheDocument();
    expect(stat('regions')).toHaveTextContent('20');
    expect(screen.queryByText('System RAM', { selector: '.stat__label' })).not.toBeInTheDocument();
    expect(screen.queryByText('top of map')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ram-ranges')).not.toBeInTheDocument();
  });

  it('leaves the sizes out when there are no addresses to work them out from', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'unprivileged' }));
    render(<IomemApp />);

    const row = await rowFor('Kernel code');
    expect(within(row).getByTitle('No address to work a size out from')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('KiB');
  });

  // Persistent memory is address space, but it is not memory the kernel hands
  // out, so it stays out of the total.
  it('counts only System RAM as memory', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'nvdimm-server' }));
    render(<IomemApp />);

    await table();
    expect(await rowFor('Persistent Memory')).toHaveTextContent('48 GiB');
    expect(stat('System RAM')).toHaveTextContent('256 GiB');
  });

  it('renders a map with no addresses above 4 GiB', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'arm-rpi4' }));
    render(<IomemApp />);

    await table();
    expect(stat('System RAM')).toHaveTextContent('3.9 GiB');
    expect(await rowFor('serial@7e201000')).toHaveTextContent('fe201000–fe201fff');
  });

  it('says an empty file has no regions rather than showing an empty table', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<IomemApp />);

    expect(await screen.findByText(/no regions found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<IomemApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(iomem('desktop-x86'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<IomemApp />);

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
    render(<IomemApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/iomem (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the one read without privilege.
describe.each([
  { fixture: 'desktop-x86', regions: '32' },
  { fixture: 'unprivileged', regions: '20' },
  { fixture: 'arm-rpi4', regions: '22' },
  { fixture: 'vm-virtio', regions: '22' },
  { fixture: 'nvdimm-server', regions: '20' },
])('IomemApp with whatever the server serves: $fixture', ({ fixture, regions }) => {
  it(`renders ${regions} regions`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<IomemApp />);

    await table();
    expect(stat('regions')).toHaveTextContent(regions);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
