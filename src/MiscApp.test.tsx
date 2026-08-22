import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readMiscFixture as misc } from './test/fixtures';
import { MiscApp } from './MiscApp';

/** Stands in for the backend serving /proc/misc. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/misc') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? misc(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Misc character devices' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a device, matched on the name in its third cell. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelectorAll('td')[2]?.textContent === name)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MiscApp', () => {
  it('requests /proc/misc from its own path', async () => {
    render(<MiscApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/misc',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per device', async () => {
    render(<MiscApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(20 + 1);
  });

  /**
   * The file gives a minor only; everything here shares major 10, which is
   * what makes the pair meaningful.
   */
  it('shows the device number the minor is half of', async () => {
    render(<MiscApp />);

    const row = await rowFor('fuse');
    expect(within(row).getByTitle('Character device 10:229')).toHaveTextContent('10:229');
  });

  /**
   * Below 64 the minor came from the pool at registration and differs between
   * machines; above it, the kernel's headers fix it.
   */
  it('tells a pooled minor from one fixed in a header', async () => {
    render(<MiscApp />);

    expect(
      within(await rowFor('vboxdrv')).getByTitle(
        'Handed out of the pool of 64 when the driver registered, so it differs between machines',
      ),
    ).toHaveTextContent('dynamic');
    expect(
      within(await rowFor('fuse')).getByTitle(
        "Written into the kernel's headers, the same everywhere",
      ),
    ).toHaveTextContent('fixed');
  });

  it('summarizes the two kinds and what is left of the pool', async () => {
    render(<MiscApp />);

    expect(await screen.findByText('devices')).toBeInTheDocument();
    expect(stat('devices')).toHaveTextContent('20');
    expect(stat('fixed minors')).toHaveTextContent('12');
    expect(stat('dynamic minors')).toHaveTextContent('8');
    expect(stat('pool left')).toHaveTextContent('56 of 64');
  });

  it('lists the pooled devices in the order they were handed out', async () => {
    render(<MiscApp />);

    await table();
    const chips = screen.getByTestId('dynamic').querySelectorAll('.chip');
    expect([...chips].map((chip) => chip.textContent)).toEqual([
      'vboxnetctl 63',
      'vboxdrvu 62',
      'vboxdrv 61',
      'ecryptfs 60',
      'cpu_dma_latency 59',
      'network_throughput 58',
      'network_latency 57',
      'vga_arbiter 56',
    ]);
  });

  it('says what the devices it knows are for', async () => {
    render(<MiscApp />);

    expect(await rowFor('loop-control')).toHaveTextContent(/Adds and removes loop devices/);
    expect(await rowFor('autofs')).toHaveTextContent(/automounter/);
  });

  it('says nothing about a device it has no note for', async () => {
    render(<MiscApp />);

    const row = await rowFor('vboxdrv');
    expect(within(row).getByTitle('This page has no note for this device')).toBeInTheDocument();
  });

  it('keeps the file’s own order rather than sorting by minor', async () => {
    render(<MiscApp />);

    const minors = within(await table())
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('td')?.textContent);
    expect(minors.slice(0, 3)).toEqual(['63', '62', '61']);
    expect(minors.at(-1)).toBe('200');
  });

  it('renders a virtualisation host', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'server-kvm' }));
    render(<MiscApp />);

    // kvm has a minor of its own; the vhost devices take what the pool gives.
    expect(await rowFor('kvm')).toHaveTextContent('10:232');
    expect(await rowFor('kvm')).toHaveTextContent('fixed');
    expect(await rowFor('vhost-net')).toHaveTextContent('dynamic');
  });

  it('renders an embedded board with most of the pool free', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'embedded' }));
    render(<MiscApp />);

    await table();
    expect(stat('pool left')).toHaveTextContent('63 of 64');
    expect(await rowFor('watchdog')).toHaveTextContent('10:130');
  });

  it('says an unreadable file has no devices', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<MiscApp />);

    expect(await screen.findByText(/no devices found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<MiscApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(misc('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<MiscApp />);

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
    render(<MiscApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/misc (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', devices: '20' },
  { fixture: 'server-kvm', devices: '17' },
  { fixture: 'container', devices: '5' },
  { fixture: 'embedded', devices: '5' },
  { fixture: 'legacy-2.6', devices: '11' },
])('MiscApp with whatever the server serves: $fixture', ({ fixture, devices }) => {
  it(`renders ${devices} devices`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<MiscApp />);

    await table();
    expect(stat('devices')).toHaveTextContent(devices);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
