import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSchedStatFixture as schedstat } from './test/fixtures';
import { SchedStatApp } from './SchedStatApp';

/** Stands in for the backend serving /proc/schedstat. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/schedstat') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? schedstat(options.fixture ?? 'desktop-4core'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Scheduler statistics per CPU' });

/** The row for a CPU, matched on its first cell. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === name)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SchedStatApp', () => {
  it('requests /proc/schedstat from its own path', async () => {
    render(<SchedStatApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/schedstat',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per CPU', async () => {
    render(<SchedStatApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(4 + 1); // + header
    expect(await rowFor('cpu3')).toBeInTheDocument();
  });

  it('summarizes the scheduler', async () => {
    render(<SchedStatApp />);

    expect(await screen.findByText('CPUs')).toBeInTheDocument();
    expect(screen.getByText('CPUs').previousSibling).toHaveTextContent('4');
    expect(screen.getByText('average wait to run').previousSibling).toHaveTextContent('46 µs');
    expect(screen.getByText('domain levels').previousSibling).toHaveTextContent('2');
  });

  it('shows the average wait per CPU, which is what the file is for', async () => {
    render(<SchedStatApp />);

    const row = await rowFor('cpu0');
    expect(row).toHaveTextContent('42 µs');
    // Wait/run below 1: this machine runs more than it queues.
    expect(row).toHaveTextContent('0.42');
  });

  it('names the CPU tasks waited longest on', async () => {
    render(<SchedStatApp />);

    await table();
    expect(screen.getByText('longest wait').parentElement).toHaveTextContent('cpu3');
  });

  it('shows each domain by its CPU mask', async () => {
    render(<SchedStatApp />);

    const row = await rowFor('cpu0');
    const domains = within(row).getAllByRole('listitem');

    expect(domains).toHaveLength(2);
    expect(domains[0]).toHaveTextContent('03');
    expect(within(row).getByTitle('domain0: mask 03, 2 CPUs')).toBeInTheDocument();
    expect(within(row).getByTitle('domain1: mask 0f, 4 CPUs')).toBeInTheDocument();
  });

  it('reads three domain levels on a NUMA machine', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'server-numa' }));
    render(<SchedStatApp />);

    expect(within(await rowFor('cpu0')).getAllByRole('listitem')).toHaveLength(3);
    expect(within(await rowFor('cpu0')).getByTitle('domain2: mask ff, 8 CPUs')).toBeInTheDocument();
    // The far half of the machine sits in its own package domain.
    expect(within(await rowFor('cpu6')).getByTitle('domain1: mask f0, 4 CPUs')).toBeInTheDocument();
  });

  it('renders a uniprocessor with no domains at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'up-single' }));
    render(<SchedStatApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(1 + 1);
    expect(within(await rowFor('cpu0')).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('domain levels')).not.toBeInTheDocument();
  });

  it('shows an oversubscribed host queueing far longer than it runs', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'oversubscribed' }));
    render(<SchedStatApp />);

    await table();
    expect(screen.getByText('average wait to run').previousSibling).toHaveTextContent('829 µs');
    expect(await rowFor('cpu0')).toHaveTextContent('25.83');
  });

  /**
   * An older version orders the fields differently, so the page says so rather
   * than labelling the wrong numbers.
   */
  it('refuses to label the fields of an older version', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'version 14\ntimestamp 1\ncpu0 1 2 3 4 5 6 7 8 9 10 11 12\n' }));
    render(<SchedStatApp />);

    await table();
    expect(screen.getByRole('status')).toHaveTextContent(
      'This file is version 14, whose field layout differs from version 15',
    );
    // Nothing is claimed about the numbers.
    expect(await rowFor('cpu0')).toHaveTextContent('—');
  });

  it('says nothing about the version when it is one it knows', async () => {
    render(<SchedStatApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<SchedStatApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(schedstat('desktop-4core'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<SchedStatApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('explains an empty file, which a kernel without CONFIG_SCHEDSTATS gives', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<SchedStatApp />);

    expect(await screen.findByText(/CONFIG_SCHEDSTATS/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<SchedStatApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/schedstat (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from a uniprocessor board to an eight-CPU NUMA server.
describe.each([
  { fixture: 'desktop-4core', cpus: 4, wait: '46 µs' },
  { fixture: 'server-numa', cpus: 8, wait: '352 µs' },
  { fixture: 'vm-2core', cpus: 2, wait: '99 µs' },
  { fixture: 'up-single', cpus: 1, wait: '18 µs' },
  { fixture: 'oversubscribed', cpus: 4, wait: '829 µs' },
])('SchedStatApp with whatever the server serves: $fixture', ({ fixture, cpus, wait }) => {
  it(`renders ${cpus} CPUs averaging ${wait}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<SchedStatApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(cpus + 1);
    expect(screen.getByText('average wait to run').previousSibling).toHaveTextContent(wait);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
