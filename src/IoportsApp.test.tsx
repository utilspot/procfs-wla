import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readIoportsFixture as ioports } from './test/fixtures';
import { IoportsApp } from './IoportsApp';

/** Stands in for the backend serving /proc/ioports. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/ioports') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? ioports(options.fixture ?? 'desktop-x86'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Claimed I/O port ranges' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a claimant, matched on its last cell. */
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

describe('IoportsApp', () => {
  it('requests /proc/ioports from its own path', async () => {
    render(<IoportsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/ioports',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per range, ports as the kernel writes them', async () => {
    render(<IoportsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(33 + 1);
    expect(await rowFor('e1000e')).toHaveTextContent('e000–e01f');
  });

  // Both bounds are inclusive, so start and end alike is a single port.
  it('counts ports rather than sizing bytes', async () => {
    render(<IoportsApp />);

    expect(await rowFor('dma1')).toHaveTextContent('32 ports');
    expect(await rowFor('PNP0C04:00')).toHaveTextContent('1 port');
  });

  /**
   * The space is 65536 ports and no wider, so what is claimed and what is left
   * are worth counting — from the top-level ranges only.
   */
  it('counts the claimed ports against the whole space', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-isa' }));
    render(<IoportsApp />);

    await table();
    expect(stat('ranges')).toHaveTextContent('19');
    expect(stat('ports claimed')).toHaveTextContent('313 of 65,536');
    expect(stat('free')).toHaveTextContent('65,223');
  });

  // A nested range is carved out of the one above it.
  it('indents a nested range under its parent', async () => {
    render(<IoportsApp />);

    const parent = (await rowFor('PCI conf1')).querySelector('td') as HTMLElement;
    const child = (await rowFor('keyboard')).querySelector('td') as HTMLElement;
    const deeper = (await rowFor('e1000e')).querySelector('td') as HTMLElement;

    expect(parent.style.paddingLeft).toBe('0.5rem');
    expect(child.style.paddingLeft).toBe('1.5rem');
    expect(deeper.style.paddingLeft).toBe('3.5rem');
  });

  it('marks the block the original PC laid out', async () => {
    render(<IoportsApp />);

    expect(await rowFor('pic1')).toHaveClass('ioports__row--legacy');
    expect(await rowFor('i801_smbus')).not.toHaveClass('ioports__row--legacy');
    expect(stat('below 0x400')).toHaveTextContent('21');
  });

  /**
   * Zeroed ports are the kernel hiding them from an unprivileged reader, so
   * the page says so and offers no counts taken from zeroes.
   */
  it('explains a file read without privilege', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'unprivileged' }));
    render(<IoportsApp />);

    expect(await screen.findByText(/CAP_SYS_ADMIN/)).toBeInTheDocument();
    expect(stat('ranges')).toHaveTextContent('14');
    expect(screen.queryByText('ports claimed')).not.toBeInTheDocument();
    expect(screen.queryByText('free')).not.toBeInTheDocument();
    expect(screen.queryByText('below 0x400')).not.toBeInTheDocument();

    const row = await rowFor('ata_piix');
    expect(within(row).getByTitle('No addresses to count ports between')).toBeInTheDocument();
    expect(row).not.toHaveClass('ioports__row--legacy');
  });

  /**
   * I/O ports are an x86 arrangement — elsewhere the file is empty for good,
   * which is not an error and not an empty table.
   */
  it('explains a machine with no port space at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'arm-no-ports' }));
    render(<IoportsApp />);

    expect(await screen.findByText(/nothing has claimed an I\/O port/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the ACPI blocks a guest nests under its PCI device', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'vm-virtio' }));
    render(<IoportsApp />);

    expect(await rowFor('ACPI PM_TMR')).toHaveTextContent('4 ports');
    expect(await rowFor('fw_cfg_io')).toHaveTextContent('0510–051f');
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<IoportsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(ioports('desktop-x86'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<IoportsApp />);

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
    render(<IoportsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/ioports (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine that has no port space.
describe.each([
  { fixture: 'desktop-x86', ranges: '33' },
  { fixture: 'legacy-isa', ranges: '19' },
  { fixture: 'vm-virtio', ranges: '28' },
  { fixture: 'unprivileged', ranges: '14' },
])('IoportsApp with whatever the server serves: $fixture', ({ fixture, ranges }) => {
  it(`renders ${ranges} ranges`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<IoportsApp />);

    await table();
    expect(stat('ranges')).toHaveTextContent(ranges);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
