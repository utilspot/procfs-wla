import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPartitionsFixture as partitions } from './test/fixtures';
import { PartitionsApp } from './PartitionsApp';

/** Stands in for the backend serving /proc/partitions. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/partitions') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? partitions(options.fixture ?? 'nvme-laptop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Block devices by size' });

/** The row for a device, matched on its first cell. */
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

describe('PartitionsApp', () => {
  it('requests /proc/partitions from its own path', async () => {
    render(<PartitionsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/partitions',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('summarizes the devices', async () => {
    render(<PartitionsApp />);

    expect(await screen.findByText('block devices')).toBeInTheDocument();
    // Scoped to the body: `partitions` is also a step of the path at the top.
    const body = within(screen.getByRole('main'));

    expect(body.getByText('block devices').previousSibling).toHaveTextContent('8');
    expect(body.getByText('whole disks').previousSibling).toHaveTextContent('5');
    expect(body.getByText('partitions').previousSibling).toHaveTextContent('3');
    expect(body.getByText('capacity listed').previousSibling).toHaveTextContent('1.0 TB');
  });

  it('shows the size in bytes from the 1 KiB blocks', async () => {
    render(<PartitionsApp />);

    const row = await rowFor('nvme0n1');
    expect(row).toHaveTextContent('512 GB');
    expect(row).toHaveTextContent('500,000,000'); // blocks, as the kernel reports
    expect(row).toHaveTextContent('259:0');
  });

  it('indents each partition under its disk, in on-disk order', async () => {
    render(<PartitionsApp />);

    const rows = within(await table()).getAllByRole('row').slice(1);
    const names = rows.map((row) => row.querySelector('td')?.textContent);

    expect(names.slice(0, 4)).toEqual(['nvme0n1', 'nvme0n1p1', 'nvme0n1p2', 'nvme0n1p3']);
    expect((await rowFor('nvme0n1p1')).querySelector('td')).toHaveClass('parts__name--part');
    expect((await rowFor('nvme0n1')).querySelector('td')).not.toHaveClass('parts__name--part');
  });

  it('shows what share of its disk each partition takes', async () => {
    render(<PartitionsApp />);

    const row = await rowFor('nvme0n1p3');
    expect(within(row).getByTitle(/99\.\d% of its disk/)).toBeInTheDocument();
  });

  it('shows the space a partitioned disk has left over', async () => {
    render(<PartitionsApp />);

    await table();
    const leftover = screen.getAllByText('unpartitioned');

    expect(leftover).toHaveLength(1);
    expect(leftover[0]!.closest('tr')).toHaveTextContent('464 MB');
  });

  it('shows no leftover row for a device with no partitions', async () => {
    render(<PartitionsApp />);

    const dm = await rowFor('dm-0');
    expect(dm.nextElementSibling?.querySelector('td')?.textContent).not.toBe('unpartitioned');
  });

  it('dims a device the kernel lists at zero size', async () => {
    render(<PartitionsApp />);

    const row = await rowFor('loop2');
    expect(row).toHaveClass('parts__row--empty');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('hides the zero-size devices on request', async () => {
    const user = userEvent.setup();
    render(<PartitionsApp />);

    await table();
    await user.click(
      screen.getByRole('checkbox', { name: /hide devices the kernel lists at zero size/i }),
    );

    expect(within(await table()).queryByText('loop2')).not.toBeInTheDocument();
    expect(within(await table()).getByText('loop0')).toBeInTheDocument();
  });

  /**
   * `loop1` ends in a digit, so `loop10` is its own device rather than
   * partition 0 of it — a looser rule hides ten devices under another one.
   */
  it('does not nest a higher-numbered loop under a lower one', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'many-loops' }));
    render(<PartitionsApp />);

    await table();
    expect(screen.getByText('whole disks').previousSibling).toHaveTextContent('13');
    expect((await rowFor('loop10')).querySelector('td')).not.toHaveClass('parts__name--part');
    expect((await rowFor('sda1')).querySelector('td')).toHaveClass('parts__name--part');
  });

  it('shows a disk that is only half carved up', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'many-loops' }));
    render(<PartitionsApp />);

    await table();
    expect(screen.getByText('unpartitioned').closest('tr')).toHaveTextContent('500 GB');
  });

  it('matches SCSI partitions with no separator', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'sata-server' }));
    render(<PartitionsApp />);

    expect((await rowFor('sda1')).querySelector('td')).toHaveClass('parts__name--part');
    expect((await rowFor('md0')).querySelector('td')).not.toHaveClass('parts__name--part');
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PartitionsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(partitions('nvme-laptop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PartitionsApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no devices', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<PartitionsApp />);

    expect(await screen.findByText(/no block devices found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<PartitionsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/partitions (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from one virtio disk to a dozen loop devices.
describe.each([
  { fixture: 'nvme-laptop', devices: 8, capacity: '1.0 TB' },
  { fixture: 'sata-server', devices: 12, capacity: '38 TB' },
  { fixture: 'rpi-sdcard', devices: 4, capacity: '32 GB' },
  { fixture: 'vm-minimal', devices: 2, capacity: '20 GB' },
  { fixture: 'many-loops', devices: 14, capacity: '1.0 TB' },
])('PartitionsApp with whatever the server serves: $fixture', ({ fixture, devices, capacity }) => {
  it(`renders ${devices} devices totalling ${capacity}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<PartitionsApp />);

    await table();
    expect(screen.getByText('block devices').previousSibling).toHaveTextContent(String(devices));
    expect(screen.getByText('capacity listed').previousSibling).toHaveTextContent(capacity);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
