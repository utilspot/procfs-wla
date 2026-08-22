import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readInterruptsFixture as interrupts } from './test/fixtures';
import { InterruptsApp } from './InterruptsApp';

/** Stands in for the backend serving /proc/interrupts. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/interrupts') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? interrupts(options.fixture ?? 'desktop-x86'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Interrupts by line' });

/**
 * The row for a line, matched on its first cell. A plain cell query would be
 * ambiguous — `0` is both the label of IRQ 0 and the total of every idle line.
 */
const rowFor = async (label: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === label)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InterruptsApp', () => {
  it('requests /proc/interrupts from its own path', async () => {
    render(<InterruptsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/interrupts',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per line and a column per CPU', async () => {
    render(<InterruptsApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(21 + 1); // + header
    // IRQ, Device, Controller, Total, then one per CPU.
    expect(within(rows[0]!).getAllByRole('columnheader')).toHaveLength(4 + 4);
    expect(within(rows[0]!).getByRole('columnheader', { name: 'CPU3' })).toBeInTheDocument();
  });

  it('summarizes the machine', async () => {
    render(<InterruptsApp />);

    expect(await screen.findByText('interrupts')).toBeInTheDocument();
    expect(screen.getByText('CPUs').previousSibling).toHaveTextContent('4');
    expect(screen.getByText('hardware IRQs').previousSibling).toHaveTextContent('10');
    expect(screen.getByText('busiest device').previousSibling).toHaveTextContent('i915');
  });

  it('shows the controller, hardware number and trigger', async () => {
    render(<InterruptsApp />);

    const row = await rowFor('0');
    expect(row).toHaveTextContent('IO-APIC');
    expect(row).toHaveTextContent('2 edge');
    expect(within(row).getByText('timer')).toBeInTheDocument();
  });

  it('shows a symbolic counter’s description instead of a device', async () => {
    render(<InterruptsApp />);

    const row = await rowFor('LOC');
    expect(within(row).getByText('Local timer interrupts')).toBeInTheDocument();
    // No controller for a kernel counter.
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('does not show the single ERR count under CPU0', async () => {
    render(<InterruptsApp />);

    const row = await rowFor('ERR');
    expect(within(row).getByTitle('One count for the machine, not per CPU')).toBeInTheDocument();
  });

  it('marks a line pinned to one CPU', async () => {
    render(<InterruptsApp />);

    // The i915 IRQ takes essentially everything on CPU0.
    expect(within(await rowFor('122')).getByText('pinned to CPU0')).toBeInTheDocument();
    // The audio IRQ is spread across all four, so it is not marked.
    expect(within(await rowFor('123')).queryByText(/^pinned/)).not.toBeInTheDocument();
  });

  it('totals each CPU', async () => {
    render(<InterruptsApp />);

    await table();
    // `CPU0` is both a chip here and a column header, so scope to the chips.
    const totals = within(screen.getByTestId('per-cpu-totals'));
    expect(totals.getByText('CPU0').parentElement).toHaveTextContent('2.0M');
    expect(totals.getByText('CPU3').parentElement).toHaveTextContent('1.7M');
  });

  it('hides the lines that never fired', async () => {
    const user = userEvent.setup();
    render(<InterruptsApp />);

    await table();
    await user.click(screen.getByRole('checkbox', { name: /hide lines that have never fired/i }));

    expect(within(await table()).getAllByRole('row')).toHaveLength(11 + 1);
    expect(within(await table()).queryByText('Thermal event interrupts')).not.toBeInTheDocument();
  });

  it('reads the GIC’s space-separated hardware number and trigger', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'arm-gic' }));
    render(<InterruptsApp />);

    const row = await rowFor('11');
    expect(row).toHaveTextContent('GICv3');
    expect(row).toHaveTextContent('30 Level');
    expect(within(row).getByText('arch_timer')).toBeInTheDocument();
  });

  it('lists every driver sharing a legacy IRQ', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'shared-irq' }));
    render(<InterruptsApp />);

    const row = await rowFor('5');
    expect(within(row).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'uhci_hcd:usb2',
      'eth0',
      'snd_ens1371',
    ]);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<InterruptsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(interrupts('desktop-x86'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<InterruptsApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no interrupt lines', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<InterruptsApp />);

    expect(await screen.findByText(/no interrupt lines found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<InterruptsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/interrupts (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from a two-CPU VM to an eight-CPU server.
describe.each([
  { fixture: 'desktop-x86', rows: 21, cpus: 4, expected: 'snd_hda_intel' },
  { fixture: 'arm-gic', rows: 12, cpus: 4, expected: 'uart-pl011' },
  { fixture: 'server-nvme', rows: 11, cpus: 8, expected: 'nvme0q1' },
  { fixture: 'vm-virtio', rows: 10, cpus: 2, expected: 'virtio0-config' },
  { fixture: 'shared-irq', rows: 10, cpus: 2, expected: 'ata_piix' },
])('InterruptsApp with whatever the server serves: $fixture', ({ fixture, rows, cpus, expected }) => {
  it(`renders ${rows} lines across ${cpus} CPUs`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<InterruptsApp />);

    const all = within(await table()).getAllByRole('row');
    expect(all).toHaveLength(rows + 1);
    expect(within(all[0]!).getAllByRole('columnheader')).toHaveLength(4 + cpus);
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
