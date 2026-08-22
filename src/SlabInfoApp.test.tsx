import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSlabInfoFixture as slabinfo } from './test/fixtures';
import { SlabInfoApp } from './SlabInfoApp';

/** Stands in for the backend serving /proc/slabinfo. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/slabinfo') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? slabinfo(options.fixture ?? 'desktop-slub'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Slab caches by memory held' });

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SlabInfoApp', () => {
  it('requests /proc/slabinfo from its own path', async () => {
    render(<SlabInfoApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/slabinfo',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per cache', async () => {
    render(<SlabInfoApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(20 + 1); // + header
  });

  it('summarizes the slab memory', async () => {
    render(<SlabInfoApp />);

    expect(await screen.findByText('slab memory')).toBeInTheDocument();
    expect(screen.getByText('slab memory').previousSibling).toHaveTextContent('108 MiB');
    expect(screen.getByText('caches').previousSibling).toHaveTextContent('20');
  });

  it('orders the caches by the memory they hold', async () => {
    render(<SlabInfoApp />);

    const rows = within(await table()).getAllByRole('row').slice(1);
    const names = rows.map((row) => row.querySelector('td')?.textContent);

    expect(names.slice(0, 2)).toEqual(['dentry', 'ext4_inode_cache']);
    expect(names.at(-1)).toBe('nf_conntrack'); // holds nothing
  });

  it('shows the memory and utilization of a cache', async () => {
    render(<SlabInfoApp />);

    const row = within(await table()).getByText('dentry').closest('tr')!;

    expect(row).toHaveTextContent('34 MiB');
    expect(row).toHaveTextContent('183,120'); // 8720 slabs x 21 objects
    expect(row).toHaveTextContent('192'); // object size in bytes
  });

  it('shows a dash rather than 0% for a cache holding nothing', async () => {
    render(<SlabInfoApp />);

    const row = within(await table()).getByText('nf_conntrack').closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('hides the empty caches on request', async () => {
    const user = userEvent.setup();
    render(<SlabInfoApp />);

    await table();
    await user.click(screen.getByRole('checkbox', { name: /hide caches holding nothing/i }));

    expect(within(await table()).getAllByRole('row')).toHaveLength(19 + 1);
    expect(within(await table()).queryByText('nf_conntrack')).not.toBeInTheDocument();
  });

  it('says nothing about underused caches when they are nearly full', async () => {
    render(<SlabInfoApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns about caches sitting on freed memory', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'fragmented-vm' }));
    render(<SlabInfoApp />);

    await table();
    const warning = screen.getByRole('status');

    expect(warning).toHaveTextContent('7 caches hold memory with most of their objects free');
    expect(warning).toHaveTextContent('dentry');
    expect(within(await table()).getAllByText('underused')).toHaveLength(7);
  });

  it('reads the real tunables a SLAB kernel writes', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'server-slab' }));
    render(<SlabInfoApp />);

    await table();
    expect(screen.getByText('slab memory').previousSibling).toHaveTextContent('609 MiB');
    expect(within(await table()).getByText('ext4_inode_cache')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<SlabInfoApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(slabinfo('desktop-slub'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<SlabInfoApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('explains an empty file, which is what an unprivileged read gets', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<SlabInfoApp />);

    expect(await screen.findByText(/readable by root/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<SlabInfoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/slabinfo (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from a 708 KiB board to a 609 MiB file server.
describe.each([
  { fixture: 'desktop-slub', rows: 20, memory: '108 MiB' },
  { fixture: 'server-slab', rows: 17, memory: '609 MiB' },
  { fixture: 'container', rows: 8, memory: '2.9 MiB' },
  { fixture: 'fragmented-vm', rows: 11, memory: '134 MiB' },
  { fixture: 'arm-embedded', rows: 6, memory: '708 KiB' },
])('SlabInfoApp with whatever the server serves: $fixture', ({ fixture, rows, memory }) => {
  it(`renders ${rows} caches holding ${memory}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<SlabInfoApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(rows + 1);
    expect(screen.getByText('slab memory').previousSibling).toHaveTextContent(memory);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
