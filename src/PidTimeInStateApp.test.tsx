import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidTimeInStateFixture as timeInState } from './test/fixtures';
import { PidTimeInStateApp } from './PidTimeInStateApp';

/**
 * Stands in for the backend serving /proc/<pid>/time_in_state. The file exists
 * only on a CONFIG_CPU_FREQ_TIMES kernel, so a 404 is the ordinary answer on
 * four of the five machines rather than a fault.
 */
function mockServer(
  options: { fixture?: string; pid?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/time_in_state$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    return new Response(
      options.body ?? timeInState(options.fixture ?? 'big-little', options.pid ?? match[1]!),
      { headers: { 'Content-Type': 'text/plain' } },
    );
  });
}

function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/time_in_state`);
}

const policy = (cpu: number) => screen.findByTestId(`policy-cpu${cpu}`);
const table = (cpu: number) =>
  screen.findByRole('table', { name: `Time at each frequency on cpu${cpu}` });

/** The row for one step, matched on the frequency in its header cell. */
const rowFor = async (cpu: number, label: string): Promise<HTMLElement> => {
  const rows = within(await table(cpu)).getAllByRole('row');
  return rows.find((row) => within(row).queryByRole('rowheader')?.textContent?.startsWith(label))!;
};

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidTimeInStateApp', () => {
  it('reads /proc/self/time_in_state when no process is named', async () => {
    render(<PidTimeInStateApp />);

    await policy(0);
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/time_in_state',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/time_in_state');
  });

  it('reads the process its own URL names', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'little-only', pid: '4242' }));
    render(<PidTimeInStateApp />);

    await policy(0);
    expect(fetch).toHaveBeenCalledWith('/0/api/file/4242/time_in_state', expect.anything());
  });

  /** The layout's whole advantage over the uid file: the boundary is named. */
  it('shows a card per frequency policy, named as the file names them', async () => {
    render(<PidTimeInStateApp />);

    expect(await policy(0)).toBeInTheDocument();
    expect(await policy(4)).toBeInTheDocument();
    expect(await screen.findByTestId('policies')).toHaveTextContent(
      'This machine has 2 frequency policies, and the file names each one',
    );
  });

  /** cpu0 is a cluster; the cores between it and cpu4 are never mentioned. */
  it('says a header names a policy rather than a core', async () => {
    render(<PidTimeInStateApp />);

    expect(await policy(0)).toHaveTextContent('not core 0 alone');
    expect(screen.getByTestId('policies')).toHaveTextContent('is every core of that cluster');
  });

  it('shows a row per step, with the kHz the file printed beside the reading of it', async () => {
    render(<PidTimeInStateApp />);

    expect(within(await table(0)).getAllByRole('row')).toHaveLength(5);
    const row = await rowFor(0, '300 MHz');
    expect(row).toHaveTextContent('300000 kHz');
    expect(row).toHaveTextContent('6m 50s');
    expect(row).toHaveTextContent('41028');
  });

  it('averages a frequency per policy, and says why not across them', async () => {
    render(<PidTimeInStateApp />);

    expect(await screen.findByTestId('mean-cpu0')).toHaveTextContent('Averaged 356 MHz');
    expect(await screen.findByTestId('mean-cpu4')).toHaveTextContent('Averaged 762 MHz');
    expect(screen.getByTestId('mean-cpu0')).toHaveTextContent('describes neither');
  });

  /** The figure a battery question is asking this file for. */
  it('says when a task is living at a policy’s most expensive step', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'top-step' }));
    render(<PidTimeInStateApp />);

    expect(await screen.findByTestId('top-step-cpu4')).toHaveTextContent(
      'went at 2.02 GHz, its top step',
    );
    expect(screen.queryByTestId('top-step-cpu0')).not.toBeInTheDocument();
  });

  it('reads a whole policy of zeroes as one the task never ran on', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'little-only', pid: '4242' }));
    render(<PidTimeInStateApp />);

    expect(await screen.findByTestId('unused-cpu4')).toHaveTextContent(
      'never run on this policy',
    );
    // And the same zeroes are also "never accounted", which the file cannot separate.
    expect(screen.getByTestId('unused-cpu4')).toHaveTextContent('cannot separate them');
    expect(await screen.findByTestId('one-policy')).toHaveTextContent('never been scheduled');
  });

  it('reads a file with no ticks anywhere as two answers it cannot separate', async () => {
    open('901');
    vi.stubGlobal('fetch', mockServer({ fixture: 'never-ran', pid: '901' }));
    render(<PidTimeInStateApp />);

    expect(await screen.findByTestId('never-ran')).toHaveTextContent(
      'not been accounted a single tick',
    );
    expect(screen.getByTestId('never-ran')).toHaveTextContent('/proc/<pid>/stat');
    expect(screen.queryByTestId('totals')).not.toBeInTheDocument();
  });

  it('says nothing about clusters on a machine with one policy', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'single-cluster' }));
    render(<PidTimeInStateApp />);

    await policy(0);
    expect(screen.queryByTestId('policies')).not.toBeInTheDocument();
    expect(screen.queryByTestId('one-policy')).not.toBeInTheDocument();
  });

  it('converts the ticks into the seconds they mean', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'single-cluster' }));
    render(<PidTimeInStateApp />);

    const summary = await screen.findByTestId('summary');
    expect(summary).toHaveTextContent('2m 32s');
    expect(summary).toHaveTextContent('15255');
  });

  /** Unlike io beside it, this file does not add a process's threads together. */
  it('says the figure is the task’s rather than the process’s', async () => {
    render(<PidTimeInStateApp />);

    expect(await screen.findByTestId('totals')).toHaveTextContent('a floor for a multi-threaded');
  });

  it('reports a frequency line that came before any header', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '300000 41\ncpu0\n300000 12\n' }));
    render(<PidTimeInStateApp />);

    expect(await screen.findByTestId('orphans')).toHaveTextContent('was not cpufreq_times.c');
  });

  it('reports a line that is neither a header nor a step', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'cpu0\n300000 12\nnot a step\n' }));
    render(<PidTimeInStateApp />);

    expect(await screen.findByTestId('malformed')).toBeInTheDocument();
  });

  it('reads an empty file as one the backend could not read', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<PidTimeInStateApp />);

    expect(await screen.findByTestId('empty')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidTimeInStateApp />);
    await policy(0);

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(timeInState('big-little'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidTimeInStateApp />);

    await policy(0);
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /**
   * Four of the five machines have no such file, the kernel option being an
   * Android one — so a 404 here is the ordinary answer rather than a fault.
   */
  it('reports the 404 a kernel without the accounting gives', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<PidTimeInStateApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/time_in_state (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'big-little', pid: 'self', policies: 2 },
  { fixture: 'little-only', pid: '4242', policies: 2 },
  { fixture: 'top-step', pid: 'self', policies: 2 },
  { fixture: 'single-cluster', pid: 'self', policies: 1 },
  { fixture: 'never-ran', pid: '901', policies: 2 },
])('PidTimeInStateApp with whatever the server serves: $fixture', ({ fixture, pid, policies }) => {
  it(`renders ${policies} policies`, async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture, pid }));
    render(<PidTimeInStateApp />);

    await policy(0);
    expect(screen.getAllByTestId(/^policy-cpu/)).toHaveLength(policies);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
