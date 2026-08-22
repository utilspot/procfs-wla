import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DirApp } from './DirApp';
import { DT_DIR, DT_REG, type Listing } from './lib/directory';
import { PATH_MAX } from './pages';

/**
 * Stands in for the backend listing a directory below `/proc`: this one is a
 * process, so it has its own files, its own directories and no processes in it.
 */
const LISTING: Listing = {
  net: DT_DIR,
  fd: DT_DIR,
  status: DT_REG,
  cmdline: DT_REG,
  wchan: DT_REG,
};

/** Answers a listing for one request path, and 404s every other. */
function mockServer(options: { path?: string; listing?: Listing; failWith?: number } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== (options.path ?? '/0/api/dir/12282')) {
      return new Response(`no listing for ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    return new Response(JSON.stringify(options.listing ?? LISTING), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

/**
 * Opens the page at the URL that names the directory. The page lists the path
 * its URL spells, so this is the whole of what decides which directory is read.
 */
function open(url = '/12282/') {
  window.history.replaceState({}, '', url);
}

const files = () => screen.findByRole('region', { name: 'Files' });
const directories = () => screen.getByRole('region', { name: 'Directories' });

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open('/');
});

describe('DirApp', () => {
  /**
   * The URL is the path: the page reads the listing endpoint at the path its
   * own URL is served from, `<base-url>/0/api/dir/<path>`.
   */
  it('lists the directory its own URL names', async () => {
    render(<DirApp />);

    await files();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/dir/12282',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282');
  });

  it('lists one nested any number of directories down', async () => {
    vi.stubGlobal('fetch', mockServer({ path: '/0/api/dir/12282/net/dev_snmp6' }));
    open('/12282/net/dev_snmp6/');
    render(<DirApp />);

    await files();
    expect(fetch).toHaveBeenCalledWith('/0/api/dir/12282/net/dev_snmp6', expect.anything());
  });

  /** The slash is for the links resolving inside; the path is the same. */
  it('lists the same directory without the trailing slash', async () => {
    open('/12282');
    render(<DirApp />);

    await files();
    expect(fetch).toHaveBeenCalledWith('/0/api/dir/12282', expect.anything());
  });

  /**
   * A listing is published at a URL ending in a slash, so nothing links to
   * `dir.html` and a URL naming it is naming an entry — which the backend then
   * answers for.
   */
  it('reads a URL spelling the document as the path it spells', async () => {
    vi.stubGlobal('fetch', mockServer({ path: '/0/api/dir/12/dir.html' }));
    open('/12/dir.html');
    render(<DirApp />);

    await files();
    expect(fetch).toHaveBeenCalledWith('/0/api/dir/12/dir.html', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12/dir.html');
  });

  it('says it is listing before the answer arrives', () => {
    render(<DirApp />);

    expect(screen.getByRole('status')).toHaveTextContent('Listing /proc/12282');
  });

  /** Whether the directory is there at all is the backend's answer to give. */
  it('reports a directory the backend does not list', async () => {
    open('/nosuchthing/');
    render(<DirApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to list /proc/nosuchthing (HTTP 404 Not Found)',
    );
  });

  it('reports a failed listing', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 500 }));
    render(<DirApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to list /proc/12282');
  });

  /**
   * This page never lists `/proc` itself — that is the page the base lands on —
   * so it never has processes in it. `/proc/irq` is numbered directories from
   * end to end and every one of them is an interrupt line.
   */
  it('has only the two sections, whatever the numbers in it are', async () => {
    vi.stubGlobal(
      'fetch',
      mockServer({
        path: '/0/api/dir/irq',
        listing: { 0: DT_DIR, 7: DT_DIR, 16: DT_DIR, default_smp_affinity: DT_REG },
      }),
    );
    open('/irq/');
    render(<DirApp />);

    await files();
    expect(
      screen.getAllByRole('region').map((region) => within(region).getByRole('heading').textContent),
    ).toEqual(['Directories3', 'Files1']);
    expect(screen.queryByRole('region', { name: 'Processes' })).not.toBeInTheDocument();
    // And they are ordinary directories, linked like any other.
    expect(within(directories()).getByRole('link', { name: '7' })).toHaveAttribute('href', '7/');
  });

  /** The threads of a process are numbers too, and are not processes either. */
  it('reads the threads under a process as directories', async () => {
    vi.stubGlobal(
      'fetch',
      mockServer({ path: '/0/api/dir/12282/task', listing: { 12282: DT_DIR, 12283: DT_DIR } }),
    );
    open('/12282/task/');
    render(<DirApp />);

    expect(await screen.findByRole('region', { name: 'Directories' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Processes' })).not.toBeInTheDocument();
  });

  it('says so when the directory reads empty', async () => {
    vi.stubGlobal('fetch', mockServer({ listing: {} }));
    render(<DirApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('/proc/12282');
  });

  /** The same tiles as any other listing, linking at each entry's own name. */
  it('links every entry at its own name, relative to this directory', async () => {
    render(<DirApp />);

    await files();
    expect(within(await files()).getByText('status').closest('a')).toHaveAttribute('href', 'status');
    expect(within(directories()).getByText('net').closest('a')).toHaveAttribute('href', 'net/');
    // Named by the path it stands for, which is below this directory.
    expect(screen.getByText('status')).toHaveAttribute('title', '/proc/12282/status');
  });

  /**
   * The URL is the path, so one spelling a path this app will not ask for is
   * refused rather than sent.
   */
  it('refuses a URL naming a path it will not list', () => {
    // A browser resolves `..` out of a URL before the page ever sees it; what
    // reaches here is a path that is simply longer than the app will ask for.
    open(`/${'x'.repeat(PATH_MAX)}/`);
    render(<DirApp />);

    expect(screen.getByRole('alert')).toHaveTextContent('is not a path this app will list');
    expect(fetch).not.toHaveBeenCalled();
  });
});
