import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SysUserIndexApp } from './SysUserIndexApp';
import { DT_DIR, DT_REG, type Listing } from './lib/directory';
import { LIMITS } from './lib/sys-user-ucount';

/** The directory as a kernel with all twelve of them lists it. */
const LISTING: Listing = Object.fromEntries(LIMITS.map((limit) => [limit.name, DT_REG]));

/** Answers a listing for `/proc/sys/user`, and 404s every other request. */
function mockServer(options: { listing?: Listing; failWith?: number } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/dir/sys/user') {
      return new Response(`no listing for ${url.pathname}`, {
        status: 404,
        statusText: 'Not Found',
      });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    return new Response(JSON.stringify(options.listing ?? LISTING), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'The ucount limits' });

/** The row for one file in the limits table, by the name in its first cell. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent?.startsWith(name))!;
};

beforeEach(() => {
  window.history.pushState({}, '', '/sys/user/');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('SysUserIndexApp', () => {
  it('lists the directory it is the page for', async () => {
    render(<SysUserIndexApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/dir/sys/user',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/sys/user');
  });

  it('gives the limits a section of their own, one row each', async () => {
    render(<SysUserIndexApp />);

    const rows = within(await table()).getAllByRole('row');
    // A header row, then the twelve.
    expect(rows).toHaveLength(LIMITS.length + 1);
    expect(within(screen.getByRole('region', { name: 'Limits' })).getByText('12')).toBeVisible();
  });

  /** The kernel's own order, not the alphabetical one the listing sorts by. */
  it('keeps the order user_table declares them in', async () => {
    render(<SysUserIndexApp />);

    const rows = within(await table()).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.querySelector('td')!.textContent)).toEqual(
      LIMITS.map((limit) => limit.name),
    );
  });

  it('says what each bounds and what fails at the ceiling', async () => {
    render(<SysUserIndexApp />);

    const row = await rowFor('max_inotify_instances');
    expect(row).toHaveTextContent('EMFILE');
    expect(await rowFor('max_ipc_namespaces')).toHaveTextContent('ENOSPC');
  });

  /** Every entry links at its own name, this section included. */
  it('links each limit at its own page', async () => {
    render(<SysUserIndexApp />);

    const link = within(await rowFor('max_ipc_namespaces')).getByRole('link');
    expect(link).toHaveAttribute('href', 'max_ipc_namespaces');
    expect(link).toHaveAttribute('title', '/proc/sys/user/max_ipc_namespaces');
  });

  /** The twelve are shown once, in their own section and not among the files. */
  it('keeps the limits out of the Files section', async () => {
    render(<SysUserIndexApp />);

    await table();
    expect(screen.queryByRole('region', { name: 'Files' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Directories' })).toBeNull();
  });

  /**
   * A name this app has no facts for is a file in this directory like any
   * other — a thirteenth limit a later kernel adds, or anything else in there.
   */
  it('lists what it does not know about the usual way', async () => {
    vi.stubGlobal(
      'fetch',
      mockServer({
        listing: { ...LISTING, max_thirteenth_namespaces: DT_REG, somedir: DT_DIR },
      }),
    );
    render(<SysUserIndexApp />);

    const files = await screen.findByRole('region', { name: 'Files' });
    expect(within(files).getByText('max_thirteenth_namespaces')).toBeVisible();
    expect(within(files).queryByText('max_ipc_namespaces')).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Directories' })).getByText('somedir'),
    ).toBeVisible();
  });

  /** What is shown is what the backend listed, not what this app knows of. */
  it('shows only the limits the kernel has', async () => {
    vi.stubGlobal(
      'fetch',
      mockServer({ listing: { max_ipc_namespaces: DT_REG, max_uts_namespaces: DT_REG } }),
    );
    render(<SysUserIndexApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByText('max_fanotify_marks')).toBeNull();
  });

  it('says a directory that lists empty is empty', async () => {
    vi.stubGlobal('fetch', mockServer({ listing: {} }));
    render(<SysUserIndexApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('Nothing was listed');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('reports a failed listing', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 500 }));
    render(<SysUserIndexApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to list /proc/sys/user');
  });

  it('says it is listing before the answer arrives', () => {
    render(<SysUserIndexApp />);

    expect(screen.getByRole('status')).toHaveTextContent('Listing /proc/sys/user');
  });

  /**
   * The directory is declared rather than read from the URL: this page is about
   * `/proc/sys/user` in particular, and it is served at that one URL.
   */
  it('lists the same directory whatever URL it was opened at', async () => {
    window.history.pushState({}, '', '/sys/user/index.html');
    render(<SysUserIndexApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/dir/sys/user', expect.anything());
  });
});
