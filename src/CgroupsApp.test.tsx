import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readCgroupsFixture as cgroups } from './test/fixtures';
import { CgroupsApp } from './CgroupsApp';

/** Stands in for the backend serving /proc/cgroups. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/cgroups') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? cgroups(options.fixture ?? 'unified-v2'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Cgroup controllers' });

/**
 * A summary tile's value, scoped to the summary. Several of the labels appear
 * again elsewhere on the page — `enabled` in the explanatory note, and
 * `v1 hierarchies` as the heading of the section below the table.
 */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a controller, matched on the name's own text node. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.childNodes[0]?.textContent === name)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CgroupsApp', () => {
  it('requests /proc/cgroups from its own path', async () => {
    render(<CgroupsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/cgroups',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per controller', async () => {
    render(<CgroupsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(14 + 1);
    expect(await rowFor('memory')).toBeInTheDocument();
  });

  it('summarizes the machine', async () => {
    render(<CgroupsApp />);

    expect(await screen.findByText('controllers')).toBeInTheDocument();
    expect(stat('controllers')).toHaveTextContent('14');
    expect(stat('enabled')).toHaveTextContent('14');
    expect(stat('cgroups')).toHaveTextContent('155');
  });

  /**
   * Hierarchy 0 across the board means the unified v2 hierarchy, not "unused" —
   * so the page says so rather than showing a bare zero.
   */
  it('names hierarchy 0 as the unified hierarchy', async () => {
    render(<CgroupsApp />);

    const row = await rowFor('cpu');
    expect(within(row).getByTitle('On the unified v2 hierarchy, or not mounted')).toHaveTextContent(
      'unified',
    );
    expect(screen.getByText('unified (cgroup v2)')).toBeInTheDocument();
    // No v1 hierarchies, so neither the tile nor the section appears.
    expect(screen.queryAllByText('v1 hierarchies')).toHaveLength(0);
  });

  it('says nothing about disabled controllers when they are all on', async () => {
    render(<CgroupsApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reads a v1 host as legacy and numbers its hierarchies', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-v1' }));
    render(<CgroupsApp />);

    await table();
    expect(screen.getByText('legacy (cgroup v1)')).toBeInTheDocument();
    expect(stat('v1 hierarchies')).toHaveTextContent('10');
    expect(await rowFor('cpuset')).toHaveTextContent('2');
  });

  // Controllers sharing a hierarchy number are mounted together.
  it('names what each controller is mounted with', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-v1' }));
    render(<CgroupsApp />);

    const cpu = await rowFor('cpu');
    expect(within(cpu).getByText('cpuacct')).toBeInTheDocument();

    const netcls = await rowFor('net_cls');
    expect(within(netcls).getByText('net_prio')).toBeInTheDocument();

    // A controller on its own mount has nothing beside it.
    expect(within(await rowFor('blkio')).getByText('—')).toBeInTheDocument();
  });

  it('lists the v1 hierarchies with the controllers on each', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-v1' }));
    render(<CgroupsApp />);

    await table();
    const grouped = screen.getByRole('table', { name: 'Controllers per v1 hierarchy' });
    const row = within(grouped).getByRole('rowheader', { name: '3' }).closest('tr')!;

    expect(within(row).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'cpu',
      'cpuacct',
    ]);
    expect(row).toHaveTextContent('84 cgroups');
  });

  it('reads a mixed machine as hybrid', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'hybrid' }));
    render(<CgroupsApp />);

    await table();
    expect(screen.getByText('hybrid (v1 and v2)')).toBeInTheDocument();
    expect(stat('v1 hierarchies')).toHaveTextContent('2');
    expect(await rowFor('memory')).toHaveTextContent('2');
    expect(within(await rowFor('cpu')).getByText('unified')).toBeInTheDocument();
  });

  it('warns about controllers that are switched off', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'disabled-controllers' }));
    render(<CgroupsApp />);

    await table();
    const warning = screen.getByRole('status');

    expect(warning).toHaveTextContent('2 controllers are compiled in but switched off');
    expect(warning).toHaveTextContent('memory, hugetlb');
    expect(within(await rowFor('memory')).getByText('disabled')).toBeInTheDocument();
    expect(stat('enabled')).toHaveTextContent('12');
  });

  it('renders counts in the thousands', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container-host' }));
    render(<CgroupsApp />);

    await table();
    expect(stat('cgroups')).toHaveTextContent('3,184');
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<CgroupsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(cgroups('unified-v2'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<CgroupsApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no controllers', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<CgroupsApp />);

    expect(await screen.findByText(/no cgroup controllers found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<CgroupsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/cgroups (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — v1, v2 and the awkward middle.
describe.each([
  { fixture: 'unified-v2', rows: 14, layout: 'unified (cgroup v2)' },
  { fixture: 'legacy-v1', rows: 12, layout: 'legacy (cgroup v1)' },
  { fixture: 'hybrid', rows: 14, layout: 'hybrid (v1 and v2)' },
  { fixture: 'disabled-controllers', rows: 14, layout: 'unified (cgroup v2)' },
  { fixture: 'container-host', rows: 14, layout: 'unified (cgroup v2)' },
])('CgroupsApp with whatever the server serves: $fixture', ({ fixture, rows, layout }) => {
  it(`renders ${rows} controllers as ${layout}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<CgroupsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(rows + 1);
    expect(screen.getByText(layout)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
