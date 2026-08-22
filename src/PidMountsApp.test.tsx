import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidMountsFixture as mounts } from './test/fixtures';
import { PidMountsApp } from './PidMountsApp';

/**
 * Stands in for the backend serving /proc/<pid>/mounts. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(options: { fixture?: string; failWith?: number; only?: string[] } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/mounts$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(mounts(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** Opens the page at the URL that names a process, which is what it reads. */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/mounts`);
}

const table = () => screen.findByRole('table');
const rowFor = (mountPoint: string): HTMLElement =>
  screen.getByText(mountPoint, { selector: '.mounts__point' }).closest('tr')!;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidMountsApp', () => {
  /** No pid given reads `self`, which is what `/proc/mounts` is a link to. */
  it('reads /proc/self/mounts when no process is named', async () => {
    render(<PidMountsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/mounts',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/mounts');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<PidMountsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/mounts', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/mounts');
  });

  /** The same file in the same shape, so the same view as `/proc/mounts`. */
  it('renders a row per mount, with device, type and options', async () => {
    render(<PidMountsApp />);

    await table();
    const root = rowFor('/');
    expect(within(root).getByText('/dev/sda2')).toBeInTheDocument();
    expect(within(root).getByText('ext4')).toBeInTheDocument();
    expect(within(root).getByText('relatime')).toBeInTheDocument();
  });

  it('summarizes what the process can see', async () => {
    render(<PidMountsApp />);

    await table();
    const summary = screen.getByRole('table').closest('main')!;
    expect(within(summary).getByText('mounts')).toBeInTheDocument();
    expect(within(summary).getByText('root filesystem')).toBeInTheDocument();
  });

  /**
   * The point of reading one process's file rather than the machine's link:
   * a mount namespace of its own is a different table, and a much shorter one.
   */
  it('shows the mounts of the process’s own namespace', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'unshared' }));
    render(<PidMountsApp />);

    await table();
    expect(screen.getAllByRole('row')).toHaveLength(7); // six mounts and a header
    // The chip beside the mount point, not the `ro` in the options column.
    expect(within(rowFor('/')).getByText('ro', { selector: '.chip--ro' })).toBeInTheDocument();
    expect(screen.queryByText('/snap/bare/5', { selector: '.mounts__point' })).not.toBeInTheDocument();
  });

  it('shows a container’s overlay root', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container' }));
    open('1');
    render(<PidMountsApp />);

    await table();
    // The type chip, not the device beside it — a container's overlay is both.
    expect(
      within(rowFor('/')).getByText('overlay', { selector: '.chip--type' }),
    ).toBeInTheDocument();
    expect(rowFor('/etc/resolv.conf')).toBeInTheDocument();
  });

  /** Which processes exist is the backend's answer to give, not this page's. */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<PidMountsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Failed to read /proc/${pid}/mounts (HTTP 404 Not Found)`,
    );
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 500 }));
    render(<PidMountsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to read /proc/self/mounts');
  });

  it('offers the raw view like every other page', async () => {
    render(<PidMountsApp />);

    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByTestId('raw-file')).toHaveTextContent('/dev/sda2');
  });
});
