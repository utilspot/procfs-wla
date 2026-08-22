import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SysVmIndexApp } from './SysVmIndexApp';
import { DT_DIR, DT_REG, type Listing } from './lib/directory';
import { TUNABLES, tunablesIn } from './lib/sys-vm';

/** The directory as a kernel carrying every knob this app knows lists it. */
const LISTING: Listing = Object.fromEntries(
  TUNABLES.map((tunable) => [tunable.name, DT_REG]),
);

/** Answers a listing for `/proc/sys/vm`, and 404s every other request. */
function mockServer(options: { listing?: Listing; failWith?: number } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/dir/sys/vm') {
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

const writeback = () => screen.findByRole('region', { name: 'Writeback' });

/** A row of one group's table, by the name in its first cell. */
const rowFor = (group: string, name: string): HTMLElement => {
  const table = within(screen.getByRole('region', { name: group })).getByRole('table');
  return within(table)
    .getAllByRole('row')
    .find((row) => row.querySelector('td')?.textContent?.startsWith(name))!;
};

beforeEach(() => {
  window.history.pushState({}, '', '/sys/vm/');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('SysVmIndexApp', () => {
  it('lists the directory it is the page for', async () => {
    render(<SysVmIndexApp />);

    await writeback();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/dir/sys/vm',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/sys/vm');
  });

  /**
   * The reason this directory has a page: alphabetical order interleaves a
   * dozen unrelated mechanisms, and grouped they read as the handful they are.
   */
  it('groups the knobs by what they are part of', async () => {
    render(<SysVmIndexApp />);

    await writeback();
    for (const group of [
      'Overcommit',
      'Reclaim and watermarks',
      'Huge pages',
      'Out of memory',
      'Address space and faults',
    ]) {
      expect(screen.getByRole('region', { name: group })).toBeVisible();
    }

    const rows = within(within(await writeback()).getByRole('table')).getAllByRole('row');
    // A header row, then the group's own files.
    expect(rows).toHaveLength(tunablesIn('Writeback').length + 1);
  });

  it('says what each one sets and what it is set in', async () => {
    render(<SysVmIndexApp />);

    await writeback();
    expect(rowFor('Writeback', 'dirty_ratio')).toHaveTextContent('made to write back itself');
    expect(rowFor('Writeback', 'dirty_ratio')).toHaveTextContent('%');
    expect(rowFor('Writeback', 'dirty_bytes')).toHaveTextContent('bytes');
    expect(rowFor('Counters and triggers', 'drop_caches')).toHaveTextContent('write-only');
    // The one file in this directory that holds a word rather than a number.
    expect(rowFor('Reclaim and watermarks', 'numa_zonelist_order')).toHaveTextContent('word');
    expect(rowFor('Address space and faults', 'memfd_noexec')).toHaveTextContent(
      'MFD_NOEXEC_SEAL',
    );
  });

  /** Every entry links at its own name, this table included. */
  it('links each file at its own page', async () => {
    render(<SysVmIndexApp />);

    await writeback();
    const link = within(rowFor('Reclaim and watermarks', 'swappiness')).getByRole('link');
    expect(link).toHaveAttribute('href', 'swappiness');
    expect(link).toHaveAttribute('title', '/proc/sys/vm/swappiness');
  });

  /** The pair a reader most easily reads as "off" rather than "not in force". */
  it('keeps the ratio spelling above the bytes one', async () => {
    render(<SysVmIndexApp />);

    const rows = within(within(await writeback()).getByRole('table')).getAllByRole('row');
    const names = rows.slice(1).map((row) => row.querySelector('td')!.textContent);

    expect(names.indexOf('dirty_ratio')).toBeLessThan(names.indexOf('dirty_bytes'));
  });

  it('shows a group only where the machine has something in it', async () => {
    vi.stubGlobal('fetch', mockServer({ listing: { swappiness: DT_REG } }));
    render(<SysVmIndexApp />);

    expect(await screen.findByRole('region', { name: 'Reclaim and watermarks' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Writeback' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Files' })).toBeNull();
  });

  /**
   * The set under `/proc/sys/vm` differs by kernel version and architecture, so
   * a name this app has no facts for is a file here like any other.
   */
  it('lists what it has no facts for the usual way', async () => {
    vi.stubGlobal(
      'fetch',
      mockServer({ listing: { ...LISTING, nr_pdflush_threads: DT_REG, hugepages: DT_DIR } }),
    );
    render(<SysVmIndexApp />);

    const files = await screen.findByRole('region', { name: 'Files' });
    expect(within(files).getByText('nr_pdflush_threads')).toBeVisible();
    expect(within(files).queryByText('swappiness')).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Directories' })).getByText('hugepages'),
    ).toBeVisible();
  });

  it('says these are settings rather than reports', async () => {
    render(<SysVmIndexApp />);

    expect(await screen.findByTestId('about')).toHaveTextContent('CAP_SYS_ADMIN');
  });

  /** Nothing here reads a value: that is what each file's own page is for. */
  it('asks for the listing and nothing else', async () => {
    render(<SysVmIndexApp />);

    await writeback();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  it('says a directory that lists empty is empty', async () => {
    vi.stubGlobal('fetch', mockServer({ listing: {} }));
    render(<SysVmIndexApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('Nothing was listed');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('reports a failed listing', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 500 }));
    render(<SysVmIndexApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to list /proc/sys/vm');
  });

  it('says it is listing before the answer arrives', () => {
    render(<SysVmIndexApp />);

    expect(screen.getByRole('status')).toHaveTextContent('Listing /proc/sys/vm');
  });
});
