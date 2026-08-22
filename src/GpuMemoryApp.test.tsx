import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readGpuMemoryFixture as gpuMemory } from './test/fixtures';
import { GpuMemoryApp } from './GpuMemoryApp';

/** Stands in for the backend serving /proc/gpu_memory. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/gpu_memory') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? gpuMemory(options.fixture ?? 'raspberry-pi'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'GPU memory per process' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a process, matched on the first cell. */
const rowFor = async (tgid: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent?.startsWith(tgid))!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GpuMemoryApp', () => {
  it('requests /proc/gpu_memory from its own path', async () => {
    render(<GpuMemoryApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/gpu_memory',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per process, largest first', async () => {
    render(<GpuMemoryApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(4 + 1);
    expect(rows[1]).toHaveTextContent('11620');
  });

  it('shows the device above the rows rather than as one of them', async () => {
    render(<GpuMemoryApp />);

    await table();
    expect(screen.getByRole('heading', { name: 'mali0', level: 2 })).toBeInTheDocument();
    expect(stat('device')).toHaveTextContent('mali0');
    // 40318 pages of 4 KiB.
    expect(stat('held')).toHaveTextContent('157 MiB');
  });

  it('summarizes the processes holding memory', async () => {
    render(<GpuMemoryApp />);

    await table();
    expect(stat('processes')).toHaveTextContent('4');
    expect(stat('largest')).toHaveTextContent('pid 11620');
  });

  /** The count is what the file holds; the size is that count at a page each. */
  it('shows each row as pages and as the size they stand for', async () => {
    render(<GpuMemoryApp />);

    const row = await rowFor('11620');
    expect(row).toHaveTextContent('33,459');
    expect(within(row).getByTitle('33,459 pages of 4096 bytes')).toHaveTextContent('131 MiB');
    expect(row).toHaveTextContent('83%');
  });

  /** TGID is the process, PID the thread in it that opened the device. */
  it('marks a row belonging to a thread rather than to the process', async () => {
    render(<GpuMemoryApp />);

    const thread = await rowFor('11665');
    expect(
      within(thread).getByTitle('Opened by thread 11688, not the process’s main one'),
    ).toHaveTextContent('tid 11688');
    expect(within(await rowFor('11620')).queryByText(/^tid /)).not.toBeInTheDocument();
  });

  /** Here the device line and the rows are the same accounting seen twice. */
  it('says nothing about a difference where the rows add up', async () => {
    render(<GpuMemoryApp />);

    await table();
    expect(screen.queryByText(/no process claims/)).not.toBeInTheDocument();
    expect(screen.queryByText(/more than the device says/)).not.toBeInTheDocument();
  });

  it('reports the pages no row claims where the two disagree', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'unaccounted' }));
    render(<GpuMemoryApp />);

    expect(await screen.findByText(/leaving 28 MiB no process claims/)).toBeInTheDocument();
  });

  /** Rows over the device line is what a file read mid-allocation prints. */
  it('reports rows claiming more than the device says as exactly that', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'mali0 100\n  TGID PID PAGE_NUM\n1 1 80\n2 2 40\n' }));
    render(<GpuMemoryApp />);

    expect(await screen.findByText(/more than the device says it has/)).toBeInTheDocument();
  });

  it('counts a process once however many threads of it hold memory', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'many-processes' }));
    render(<GpuMemoryApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(4 + 1);
    expect(stat('processes')).toHaveTextContent('3');
  });

  it('reads a header with nothing under it as nothing holding memory', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-processes' }));
    render(<GpuMemoryApp />);

    expect(await screen.findByText(/No process is holding memory on mali0/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(stat('held')).toHaveTextContent('0 B');
  });

  it('says a file with no device line names no GPU', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '1 1 4\n' }));
    render(<GpuMemoryApp />);

    expect(await screen.findByText(/no device line in this file/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<GpuMemoryApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(gpuMemory('raspberry-pi'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<GpuMemoryApp />);

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
    render(<GpuMemoryApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/gpu_memory (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'raspberry-pi', processes: '4' },
  { fixture: 'many-processes', processes: '3' },
  { fixture: 'unaccounted', processes: '2' },
])('GpuMemoryApp with whatever the server serves: $fixture', ({ fixture, processes }) => {
  it(`renders ${processes} processes`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<GpuMemoryApp />);

    await table();
    expect(stat('processes')).toHaveTextContent(processes);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
