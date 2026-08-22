import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidCgroupFixture as cgroup } from './test/fixtures';
import { PidCgroupApp } from './PidCgroupApp';

/** Stands in for the backend serving /proc/<pid>/cgroup. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/cgroup$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    if (options.body !== undefined) {
      return new Response(options.body, { headers: { 'Content-Type': 'text/plain' } });
    }

    try {
      return new Response(cgroup(options.fixture ?? 'unified-v2', match[1]!), {
        headers: { 'Content-Type': 'text/plain' },
      });
    } catch {
      return new Response('no such file', { status: 404, statusText: 'Not Found' });
    }
  });
}

const summary = () => screen.findByTestId('summary');
const table = () => screen.findByRole('table', { name: 'Cgroup hierarchies' });

const statFor = async (label: string): Promise<HTMLElement> => {
  const tiles = within(await summary()).getAllByText(label);
  return tiles[0]!.parentElement!;
};

/** The row for a hierarchy id, matched on the id cell's own text. */
const rowFor = async (id: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === id)!;
};

const openFor = (pid: string) => window.history.pushState({}, '', `/${pid}/cgroup`);

beforeEach(() => {
  openFor('self');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('PidCgroupApp', () => {
  it('reads the process its own URL names', async () => {
    openFor('12282');
    render(<PidCgroupApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/12282/cgroup',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('shows where the process is on a v2 machine', async () => {
    render(<PidCgroupApp />);

    expect(await statFor('hierarchies')).toHaveTextContent('1');
    expect(await statFor('layout')).toHaveTextContent('unified (cgroup v2)');
    expect(await statFor('cgroup')).toHaveTextContent('session-2.scope');
  });

  /** The empty controller field is the mark, so the row says v2 rather than 0. */
  it('marks the unified hierarchy as the one naming no controllers', async () => {
    render(<PidCgroupApp />);

    const row = await rowFor('0');
    expect(within(row).getByText('v2')).toBeInTheDocument();
    expect(row).toHaveClass('cg2__row--unified');
  });

  it('says what kind of unit the cgroup is', async () => {
    render(<PidCgroupApp />);

    const unit = await screen.findByTestId('unit');
    expect(unit).toHaveTextContent('session-2.scope');
    expect(unit).toHaveTextContent('systemd did not start but has taken charge of');
  });

  it('names a service rather than a scope where the path says so', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '0::/system.slice/nginx.service\n' }));
    render(<PidCgroupApp />);

    expect(await screen.findByTestId('unit')).toHaveTextContent(
      'a process systemd started and manages',
    );
  });

  it('names a slice as the group of units it is', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '0::/user.slice\n' }));
    render(<PidCgroupApp />);

    expect(await screen.findByTestId('unit')).toHaveTextContent('a group of other units');
  });

  it('reads a machine on cgroup v1 alone', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-v1' }));
    render(<PidCgroupApp />);

    expect(await statFor('layout')).toHaveTextContent('legacy (cgroup v1)');
    expect(await statFor('hierarchies')).toHaveTextContent('11');
    expect(await screen.findByTestId('no-unified')).toHaveTextContent(
      'There is no unified hierarchy here',
    );
  });

  it('shows co-mounted controllers as the several they are', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-v1' }));
    render(<PidCgroupApp />);

    const row = await rowFor('4');
    expect(within(row).getByText('cpu')).toBeInTheDocument();
    expect(within(row).getByText('cpuacct')).toBeInTheDocument();
    expect(within(row).getByTitle(/how much CPU time this group gets/)).toBeInTheDocument();
  });

  it('shows a named hierarchy as the one that limits nothing', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-v1' }));
    render(<PidCgroupApp />);

    expect(await rowFor('1')).toHaveTextContent('name=systemd');
  });

  it('reads a hybrid machine and points at the hierarchy that disagrees', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'hybrid' }));
    render(<PidCgroupApp />);

    expect(await statFor('layout')).toHaveTextContent('hybrid (v1 and v2)');
    const disagree = await screen.findByTestId('disagree');
    expect(disagree).toHaveTextContent('One hierarchy puts this process somewhere else');
    expect(disagree).toHaveTextContent('devices at /user.slice');
  });

  /**
   * The path is resolved against the reader's cgroup namespace, so a container
   * reads the root however deep it really sits.
   */
  it('explains a file that is all root', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container' }));
    render(<PidCgroupApp />);

    const root = await screen.findByTestId('at-root');
    expect(root).toHaveTextContent('usually means a namespace');
    expect(root).toHaveTextContent('cannot see past its own root');
  });

  /** One file, two answers, and neither is stale. */
  it('reads an exiting process’s v1 lines against its v2 one', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'zombie' }));
    render(<PidCgroupApp />);

    const disagree = await screen.findByTestId('disagree');
    expect(disagree).toHaveTextContent('2 hierarchies put this process somewhere else');
    expect(disagree).toHaveTextContent('prints the root for an exiting task');
    // The unified line still names where it was.
    expect(await statFor('cgroup')).toHaveTextContent('session-1.scope');
  });

  it('draws the path as the tree it names', async () => {
    render(<PidCgroupApp />);

    const row = await rowFor('0');
    const segments = row.querySelectorAll('.cg2__segment');

    expect(segments).toHaveLength(3);
    expect(segments[2]).toHaveTextContent('session-2.scope');
    // Only the cgroup itself is set solid; the slices above it are the way there.
    expect(segments[2]).toHaveClass('cg2__segment--here');
    expect(segments[0]).not.toHaveClass('cg2__segment--here');
  });

  it('keeps a path with a colon in it whole', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '0::/machine.slice/lxc:101:ct.scope\n' }));
    render(<PidCgroupApp />);

    expect(await statFor('cgroup')).toHaveTextContent('lxc:101:ct.scope');
  });

  it('says this is not the machine’s table of controllers', async () => {
    render(<PidCgroupApp />);

    await summary();
    expect(screen.getByText(/which is the machine’s table of controllers/)).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidCgroupApp />);
    await summary();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent(cgroup('unified-v2', 'self'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidCgroupApp />);

    await summary();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file holds no hierarchies', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '\n' }));
    render(<PidCgroupApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('No hierarchies found');
  });

  it('reports a process that is not there', async () => {
    openFor('4242');
    render(<PidCgroupApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/cgroup (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from one v2 line to eleven v1 ones.
describe.each([
  { fixture: 'unified-v2', pid: 'self', rows: 1, layout: 'unified (cgroup v2)' },
  { fixture: 'legacy-v1', pid: '1', rows: 11, layout: 'legacy (cgroup v1)' },
  { fixture: 'hybrid', pid: '1', rows: 3, layout: 'hybrid (v1 and v2)' },
  { fixture: 'container', pid: '12282', rows: 1, layout: 'unified (cgroup v2)' },
  { fixture: 'zombie', pid: 'self', rows: 3, layout: 'hybrid (v1 and v2)' },
])('PidCgroupApp with whatever the server serves: $fixture', ({ fixture, pid, rows, layout }) => {
  it(`renders ${rows} hierarchies, read as ${layout}`, async () => {
    openFor(pid);
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<PidCgroupApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(rows + 1);
    expect(await statFor('layout')).toHaveTextContent(layout);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
