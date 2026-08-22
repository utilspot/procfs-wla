import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readMountsFixture as mounts } from './test/fixtures';
import { MountsApp } from './MountsApp';

/** Stands in for the backend serving /proc/mounts. */
function mockServer(options: { fixture?: string; failWith?: number } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/mounts') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(mounts(options.fixture ?? 'laptop-btrfs'), {
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

describe('MountsApp', () => {
  it('requests /proc/mounts from its own path', async () => {
    render(<MountsApp />);

    await screen.findByRole('table');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/mounts',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per mount', async () => {
    render(<MountsApp />);

    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(27 + 1); // + header
    expect(screen.getByText('/boot/efi')).toBeInTheDocument();
    expect(screen.getAllByText('/dev/nvme0n1p2').length).toBeGreaterThan(0);
  });

  it('summarizes the mount table', async () => {
    render(<MountsApp />);

    expect(await screen.findByText('mounts')).toBeInTheDocument();
    expect(screen.getByText('filesystem types').previousSibling).toHaveTextContent('23');
    expect(screen.getByText('read-only').previousSibling).toHaveTextContent('2');
    expect(screen.getByText('root filesystem').previousSibling).toHaveTextContent('btrfs');
  });

  it('marks read-only mounts', async () => {
    render(<MountsApp />);

    const backup = (await screen.findByText('/mnt/backup')).closest('td')!;
    expect(within(backup).getByText('ro')).toBeInTheDocument();
  });

  it('shows every mount option', async () => {
    render(<MountsApp />);

    // Scoped to the body: `/` is also what separates the steps of the path at
    // the top, and the root mount point is one character long.
    await screen.findByRole('table');
    const row = within(screen.getByRole('main')).getByText('/').closest('tr')!;
    // The root mount's six btrfs options, down to the last one.
    expect(within(row).getAllByRole('listitem')).toHaveLength(6);
    expect(within(row).getByText('subvol=/@')).toBeInTheDocument();
  });

  it('hides kernel pseudo-filesystems on request', async () => {
    const user = userEvent.setup();
    render(<MountsApp />);

    await screen.findByRole('table');
    expect(screen.getByText('/sys')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /hide kernel pseudo-filesystems/i }));

    expect(screen.queryByText('/sys')).not.toBeInTheDocument();
    expect(screen.getByText('/boot/efi')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<MountsApp />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent(mounts('laptop-btrfs'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<MountsApp />);

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
    render(<MountsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/mounts (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including escaped paths and a four-line minimal system.
describe.each([
  { fixture: 'laptop-btrfs', rows: 27, expected: '/mnt/backup' },
  { fixture: 'container-overlay', rows: 18, expected: '/etc/resolv.conf' },
  { fixture: 'rpi-sdcard', rows: 13, expected: '/boot/firmware' },
  { fixture: 'minimal', rows: 4, expected: '/dev' },
  { fixture: 'escaped-paths', rows: 11, expected: '/mnt/My Passport' },
])('MountsApp with whatever the server serves: $fixture', ({ fixture, rows, expected }) => {
  it(`renders ${rows} mounts`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<MountsApp />);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(rows + 1);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
