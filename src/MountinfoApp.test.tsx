import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readMountinfoFixture as mountinfo } from './test/fixtures';
import { MountinfoApp } from './MountinfoApp';

/**
 * Stands in for the backend serving /proc/<pid>/mountinfo. A fixture is a
 * machine with a few processes in it, so this answers per pid and 404s for one
 * it does not have — the same as the mock server.
 */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/mountinfo$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = options.fixture === 'container' ? '1' : match[1]!;
    return new Response(options.body ?? mountinfo(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** Opens the page at the URL that names a process, which is what it reads. */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/mountinfo`);
}

const summary = () => screen.findByTestId('summary');
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** A row of the table, found by the mount point in its first cell. */
const rowFor = (mountPoint: string): HTMLElement =>
  screen.getByText(mountPoint, { selector: '.minfo__point' }).closest('tr')!;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('MountinfoApp', () => {
  it('reads /proc/self/mountinfo when no process is named', async () => {
    render(<MountinfoApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/mountinfo',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/mountinfo');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<MountinfoApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/mountinfo', expect.anything());
  });

  it('counts the mounts, the types, the binds and the read-only ones', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'bind-mounts' }));
    render(<MountinfoApp />);

    await summary();
    expect(stat('mounts')).toHaveTextContent('12');
    expect(stat('bind mounts')).toHaveTextContent('6');
    expect(stat('read-only')).toHaveTextContent('2');
    expect(stat('root filesystem')).toHaveTextContent('ext4');
  });

  /** A row carries what the mount is, not only where it is. */
  it('shows each mount’s source, type and device', async () => {
    render(<MountinfoApp />);

    await summary();
    const root = rowFor('/');
    expect(within(root).getByText('/dev/sda2')).toBeInTheDocument();
    expect(within(root).getByText('ext4')).toBeInTheDocument();
    expect(within(root).getByText('8:2')).toBeInTheDocument();
  });

  /**
   * The two read-only options are different statements — this mount, against
   * the filesystem under it — so the row says which it is.
   */
  it('marks the two kinds of read-only apart', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'bind-mounts' }));
    render(<MountinfoApp />);

    await summary();
    // Scoped to the flags beside the mount point: `ro` is also an option, and
    // the option is the same three letters saying something else.
    const flags = (mountPoint: string): HTMLElement =>
      rowFor(mountPoint).querySelector('.minfo__flags')!;

    expect(flags('/var/www')).toHaveTextContent('ro');
    expect(flags('/var/www')).not.toHaveTextContent('ro fs');
    expect(flags('/var/www')).toHaveTextContent('bind');
  });

  it('marks a mount off a read-only filesystem as both', async () => {
    render(<MountinfoApp />);

    await summary();
    const flags = rowFor('/snap/bare/5').querySelector<HTMLElement>('.minfo__flags')!;
    expect(within(flags).getByText('ro')).toBeInTheDocument();
    expect(within(flags).getByText('ro fs')).toBeInTheDocument();
  });

  /** The propagation tags are what decide whether a mount is seen elsewhere. */
  it('names the peer group a mount shares with', async () => {
    render(<MountinfoApp />);

    await summary();
    expect(within(rowFor('/')).getByText(/shared/)).toHaveTextContent('shared 1');
    expect(within(rowFor('/boot/efi')).getByText('private')).toBeInTheDocument();
  });

  it('names a slave mount and the group it receives from', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'bind-mounts' }));
    render(<MountinfoApp />);

    await summary();
    expect(within(rowFor('/etc/credentials')).getByText(/slave of/)).toHaveTextContent('slave of 5');
    expect(within(rowFor('/build/cache')).getByText('unbindable')).toBeInTheDocument();
  });

  /** The tree is the point of this file, so a nested mount is indented. */
  it('indents a mount by how deep it sits', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'bind-mounts' }));
    render(<MountinfoApp />);

    await summary();
    const indent = (mountPoint: string): string =>
      (screen.getByText(mountPoint, { selector: '.minfo__point' }) as HTMLElement).style.paddingLeft;

    expect(indent('/')).toBe('0rem');
    expect(indent('/srv')).toBe('0.85rem');
    expect(indent('/var/www')).toBe('1.7rem');
    // Under /var/www rather than beside it, which only the ids say.
    expect(indent('/var/www/uploads')).toBe('2.55rem');
  });

  it('counts the propagation kinds beside the summary', async () => {
    render(<MountinfoApp />);

    expect(await screen.findByTestId('propagation')).toHaveTextContent('shared');
  });

  /** On a desktop the pseudo-filesystems are most of the file. */
  it('hides the kernel pseudo-filesystems when asked', async () => {
    render(<MountinfoApp />);

    await summary();
    expect(rowFor('/sys')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox'));

    expect(screen.queryByText('/sys', { selector: '.minfo__point' })).not.toBeInTheDocument();
    expect(rowFor('/')).toBeInTheDocument();
  });

  it('shows a container’s overlay root and its bound-in files', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container' }));
    open('1');
    render(<MountinfoApp />);

    await summary();
    // The type chip, not the source beside it — a container's overlay is both.
    expect(within(rowFor('/')).getByText('overlay', { selector: '.chip--type' })).toBeInTheDocument();
    expect(rowFor('/etc/resolv.conf').querySelector('.minfo__flags')).toHaveTextContent('bind');
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<MountinfoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/mountinfo (HTTP 404 Not Found)',
    );
  });

  /** A line with no `-` is not one of these, and the page says so. */
  it('says so when nothing in the file parses', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '31 2 8:2 / / rw ext4 /dev/sda2 rw\n' }));
    render(<MountinfoApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('No mounts were listed');
  });

  it('offers the raw view like every other page', async () => {
    render(<MountinfoApp />);

    await summary();
    await userEvent.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByTestId('raw-file')).toHaveTextContent('/dev/sda2');
  });
});
