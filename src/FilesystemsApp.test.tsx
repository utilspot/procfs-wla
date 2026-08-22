import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFilesystemsFixture as filesystems } from './test/fixtures';
import { FilesystemsApp } from './FilesystemsApp';

/** Stands in for the backend serving /proc/filesystems. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/filesystems') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? filesystems(options.fixture ?? 'desktop-ubuntu'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Registered filesystems' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a filesystem, matched on the name in its first cell. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent?.startsWith(name))!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FilesystemsApp', () => {
  it('requests /proc/filesystems from its own path', async () => {
    render(<FilesystemsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/filesystems',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per registered filesystem', async () => {
    render(<FilesystemsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(35 + 1);
    expect(await rowFor('ext4')).toHaveTextContent('block device');
  });

  it('summarizes what needs a device and what does not', async () => {
    render(<FilesystemsApp />);

    expect(await screen.findByText('filesystems')).toBeInTheDocument();
    expect(stat('filesystems')).toHaveTextContent('35');
    expect(stat('need a device')).toHaveTextContent('8');
    expect(stat('network')).toHaveTextContent('0');
  });

  /**
   * The first field is either `nodev` or nothing at all, and the page shows
   * the literal field beside what it is taken to mean.
   */
  it('shows the first field as the kernel writes it', async () => {
    render(<FilesystemsApp />);

    expect(await rowFor('proc')).toHaveTextContent('nodev');
    expect(within(await rowFor('ext4')).getByTitle('The kernel prints nothing in this field'))
      .toBeInTheDocument();
  });

  // Registered like any other, but a mount of one from userspace fails.
  it('marks the filesystems the kernel keeps for itself', async () => {
    render(<FilesystemsApp />);

    expect(
      within(await rowFor('bdev')).getByTitle(
        "Registered for the kernel's own use; mounting it from userspace fails",
      ),
    ).toBeInTheDocument();
    expect(within(await rowFor('proc')).queryByText('kernel only')).not.toBeInTheDocument();
  });

  /**
   * `mount` with no `-t` works through the block-backed entries in the order
   * the file lists them, so the order is worth showing on its own.
   */
  it('shows the order mount would try, without the nodev entries', async () => {
    render(<FilesystemsApp />);

    await table();
    const order = within(screen.getByTestId('mount-order')).getAllByText(/\w/);
    expect(order.map((chip) => chip.textContent)).toEqual([
      'ext3',
      'ext2',
      'ext4',
      'squashfs',
      'vfat',
      'fuseblk',
      'btrfs',
      'iso9660',
    ]);
  });

  // A network filesystem is nodev too, but its data comes from a server.
  it('tells a network filesystem from a virtual one', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'nfs-client' }));
    render(<FilesystemsApp />);

    await table();
    expect(stat('network')).toHaveTextContent('6');
    expect(await rowFor('nfs')).toHaveTextContent('network');
    expect(await rowFor('tmpfs')).toHaveTextContent('virtual');
  });

  // An out-of-tree module registers when it loads, so it lands at the end.
  it('keeps the file in registration order', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'zfs-module' }));
    render(<FilesystemsApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(rows.at(-1)).toHaveTextContent('zfs');
    expect(rows[1]).toHaveTextContent('sysfs');
  });

  it('says an empty file has no filesystems rather than showing an empty table', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<FilesystemsApp />);

    expect(await screen.findByText(/no filesystems found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<FilesystemsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(filesystems('desktop-ubuntu'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<FilesystemsApp />);

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
    render(<FilesystemsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/filesystems (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop-ubuntu', total: '35' },
  { fixture: 'embedded-squashfs', total: '14' },
  { fixture: 'nfs-client', total: '20' },
  { fixture: 'zfs-module', total: '14' },
  { fixture: 'legacy-2.6', total: '19' },
])('FilesystemsApp with whatever the server serves: $fixture', ({ fixture, total }) => {
  it(`renders ${total} filesystems`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<FilesystemsApp />);

    await table();
    expect(stat('filesystems')).toHaveTextContent(total);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
