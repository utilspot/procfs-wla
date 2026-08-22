import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readDiskstatsFixture as diskstats } from './test/fixtures';
import { DiskstatsApp } from './DiskstatsApp';

/** Stands in for the backend serving /proc/diskstats. */
function mockServer(options: { fixture?: string; failWith?: number } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/diskstats') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(diskstats(options.fixture ?? 'nvme-laptop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiskstatsApp', () => {
  it('requests /proc/diskstats from its own path', async () => {
    render(<DiskstatsApp />);

    await screen.findByRole('table');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/diskstats',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per device with its numbers', async () => {
    render(<DiskstatsApp />);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(10 + 1); // + header

    // Scoped to the table: the summary names the busiest device too.
    const nvme = within(table).getByText('nvme0n1').closest('tr')!;
    expect(within(nvme).getByText('259:0')).toBeInTheDocument();
    expect(within(nvme).getByText((1284736).toLocaleString())).toBeInTheDocument();
    expect(within(nvme).getByText('50 GB')).toBeInTheDocument(); // 98234567 sectors read
    expect(within(nvme).getByText('96 GB')).toBeInTheDocument(); // 187234891 sectors written
  });

  it('summarizes the devices', async () => {
    render(<DiskstatsApp />);

    expect(await screen.findByText('devices')).toBeInTheDocument();
    expect(screen.getByText('devices').previousSibling).toHaveTextContent('10');
    expect(screen.getByText('busiest device').previousSibling).toHaveTextContent('nvme0n1');
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getByText('written')).toBeInTheDocument();
  });

  it('hides devices with no I/O on request', async () => {
    const user = userEvent.setup();
    render(<DiskstatsApp />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('sr0')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /hide devices with no i\/o/i }));

    expect(within(table).queryByText('sr0')).not.toBeInTheDocument();
    expect(within(table).getByText('nvme0n1')).toBeInTheDocument();
  });

  it('marks a kernel that reports no discard counters', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-kernel' }));
    render(<DiskstatsApp />);

    const table = await screen.findByRole('table');
    const hda = within(table).getByText('hda').closest('tr')!;
    expect(within(hda).getByTitle('Not reported by this kernel')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<DiskstatsApp />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent(diskstats('nvme-laptop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<DiskstatsApp />);

    await screen.findByRole('table');
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
    render(<DiskstatsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/diskstats (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including a 14-field kernel and a disk that has never been used.
describe.each([
  { fixture: 'nvme-laptop', devices: 10, expected: 'nvme0n1p2' },
  { fixture: 'sata-raid', devices: 9, expected: 'md0' },
  { fixture: 'legacy-kernel', devices: 5, expected: 'hda2' },
  { fixture: 'idle-vm', devices: 3, expected: 'vdb' },
  { fixture: 'many-loops', devices: 27, expected: 'zram0' },
])('DiskstatsApp with whatever the server serves: $fixture', ({ fixture, devices, expected }) => {
  it(`renders ${devices} devices`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<DiskstatsApp />);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(devices + 1);
    expect(within(table).getByText(expected)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
