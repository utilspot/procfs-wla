import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readGpuLoadFixture as gpuLoad } from './test/fixtures';
import { GpuLoadApp } from './GpuLoadApp';

/** Stands in for the backend serving /proc/gpu_load. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/gpu_load') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? gpuLoad(options.fixture ?? 'raspberry-pi'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'GPU contexts and their load' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a context id, matched on the first cell. */
const rowFor = async (id: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === id)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GpuLoadApp', () => {
  it('requests /proc/gpu_load from its own path', async () => {
    render(<GpuLoadApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/gpu_load',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per context, longest active first', async () => {
    render(<GpuLoadApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(5 + 1);
    expect(rows[1]).toHaveTextContent('11620');
  });

  it('shows the device above the contexts rather than as one of them', async () => {
    render(<GpuLoadApp />);

    await table();
    expect(screen.getByRole('heading', { name: 'mali0', level: 2 })).toBeInTheDocument();
    expect(stat('device')).toHaveTextContent('mali0');
    // 395061345792 of 931053211904 ns.
    expect(stat('device active')).toHaveTextContent('42%');
  });

  it('summarizes the contexts and the processes holding them', async () => {
    render(<GpuLoadApp />);

    await table();
    expect(stat('contexts')).toHaveTextContent('5');
    expect(stat('processes')).toHaveTextContent('4');
    expect(stat('most active')).toHaveTextContent('pid 11620');
  });

  it('reads the durations as the nanoseconds they are counted in', async () => {
    render(<GpuLoadApp />);
    const row = await rowFor('2');

    // 5845115345720 ns active, 6467620158574 inactive.
    expect(row).toHaveTextContent('1h 37m');
    expect(row).toHaveTextContent('1h 47m');
    expect(row).toHaveTextContent('47%');
  });

  /** tgid is the process, pid the thread in it that opened the device. */
  it('marks a context opened by a thread rather than by the process', async () => {
    render(<GpuLoadApp />);
    const thread = await rowFor('3');
    expect(within(thread).getByTitle('Opened by thread 11688, not the process’s main one')).toHaveTextContent(
      'tid 11688',
    );

    const main = await rowFor('12');
    expect(within(main).queryByText(/^tid /)).not.toBeInTheDocument();
  });

  it('names the driver’s own context rather than showing it as process 0', async () => {
    render(<GpuLoadApp />);
    const row = await rowFor('0');

    expect(within(row).getByTitle('Id, tgid and pid all zero: the driver’s own context')).toHaveTextContent(
      'driver',
    );
  });

  /**
   * Nothing has been counted against it, so filling the bar would say it pegged
   * the GPU when it says nothing at all.
   */
  it('marks a row with no inactive time as unmeasured rather than as full', async () => {
    render(<GpuLoadApp />);
    const row = await rowFor('0');

    expect(
      within(row).getByTitle(
        'No inactive time counted against it, so this is not a share of anything',
      ),
    ).toBeInTheDocument();
    expect(within(await rowFor('2')).queryByText('no idle')).not.toBeInTheDocument();
  });

  /** Hours of contexts against fifteen minutes of device, and neither is wrong. */
  it('says the device line is not the total of the rows where it is not', async () => {
    render(<GpuLoadApp />);

    expect(
      await screen.findByText(/the device line is not the total of the rows/),
    ).toBeInTheDocument();
  });

  it('says nothing of the sort where the rows sit under the device', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'many-contexts' }));
    render(<GpuLoadApp />);

    await table();
    expect(screen.queryByText(/not the total of the rows/)).not.toBeInTheDocument();
  });

  it('counts a process once however many contexts it holds', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'many-contexts' }));
    render(<GpuLoadApp />);

    await table();
    expect(stat('contexts')).toHaveTextContent('6');
    expect(stat('processes')).toHaveTextContent('3');
  });

  it('reads a header with nothing under it as nothing holding the device', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-contexts' }));
    render(<GpuLoadApp />);

    expect(await screen.findByText(/Nothing holds a context on mali0/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    // Both counters at zero: a share of nothing rather than a zero.
    expect(stat('device active')).toHaveTextContent('—');
  });

  it('says a file with no device line names no GPU', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '1 2 2 30 40\n' }));
    render(<GpuLoadApp />);

    expect(await screen.findByText(/no device line in this file/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<GpuLoadApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(gpuLoad('raspberry-pi'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<GpuLoadApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /** A machine without the Mali driver has no such file, which is most of them. */
  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<GpuLoadApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/gpu_load (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'raspberry-pi', contexts: '5' },
  { fixture: 'many-contexts', contexts: '6' },
  { fixture: 'idle', contexts: '1' },
])('GpuLoadApp with whatever the server serves: $fixture', ({ fixture, contexts }) => {
  it(`renders ${contexts} contexts`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<GpuLoadApp />);

    await table();
    expect(stat('contexts')).toHaveTextContent(contexts);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
