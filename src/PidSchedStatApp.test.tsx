import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidSchedStatFixture as schedstat } from './test/fixtures';
import { PidSchedStatApp } from './PidSchedStatApp';

/**
 * Stands in for the backend serving /proc/<pid>/schedstat. Mode 0444, so the
 * only refusal that matters is a process that is not there.
 */
function mockServer(
  options: { fixture?: string; pid?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/schedstat$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    return new Response(
      options.body ?? schedstat(options.fixture ?? 'busy', options.pid ?? match[1]!),
      { headers: { 'Content-Type': 'text/plain' } },
    );
  });
}

function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/schedstat`);
}

const table = () => screen.findByRole('table', { name: 'Scheduler counters' });
const rows = async () => within(await table()).getAllByRole('row').slice(1);

/** The row for one counter, matched on the kernel's name for it. */
const rowFor = async (name: string): Promise<HTMLElement> =>
  (await rows()).find((row) => within(row).queryByRole('rowheader')?.textContent?.includes(name))!;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidSchedStatApp', () => {
  it('reads /proc/self/schedstat when no process is named', async () => {
    render(<PidSchedStatApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/schedstat',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/schedstat');
  });

  it('reads the process its own URL names', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'contended', pid: '4242' }));
    render(<PidSchedStatApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/4242/schedstat', expect.anything());
  });

  it('shows a row per counter, numbered, since this file is read by position', async () => {
    render(<PidSchedStatApp />);

    expect(await rows()).toHaveLength(3);
    expect(await rowFor('sum_exec_runtime')).toHaveTextContent('4m 44s');
    // The counter as the file holds it stays beside the reading of it.
    expect(await rowFor('sum_exec_runtime')).toHaveTextContent('284,119,402,118 ns');
    expect(await rowFor('pcount')).toHaveTextContent('84,211');
  });

  /** The centrepiece: column two is the one worth reading. */
  it('marks the second counter as the one the file exists for', async () => {
    render(<PidSchedStatApp />);

    expect(await rowFor('run_delay')).toHaveClass('sched__row--key');
    expect(await rowFor('run_delay')).toHaveTextContent('whether the machine is oversubscribed');
  });

  it('says the third counter is turns rather than context switches', async () => {
    render(<PidSchedStatApp />);

    expect(await rowFor('pcount')).toHaveTextContent('timeslices, not context switches');
  });

  it('works out the share of wanted CPU time spent queued', async () => {
    render(<PidSchedStatApp />);

    const notice = await screen.findByTestId('wait-share');
    expect(notice).toHaveTextContent('<1% of the time this task wanted a CPU');
    expect(notice).toHaveTextContent('the scheduler doing its job');
    expect(notice).not.toHaveClass('notice--warn');
  });

  it('says when the queue is the answer rather than background noise', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'contended', pid: '4242' }));
    render(<PidSchedStatApp />);

    const notice = await screen.findByTestId('wait-share');
    expect(notice).toHaveTextContent('76% of the time this task wanted a CPU');
    expect(notice).toHaveTextContent('ready to run and there is no CPU free');
    expect(notice).toHaveClass('notice--warn');
    expect(await screen.findByTestId('summary')).toHaveTextContent('76%');
  });

  /** The per-turn wait is the figure /proc/schedstat reports per CPU. */
  it('gives an average turn and an average wait, and says what to compare them with', async () => {
    render(<PidSchedStatApp />);

    const notice = await screen.findByTestId('averages');
    expect(notice).toHaveTextContent('3.4 ms on a CPU each turn, after 4.9 µs of waiting');
    expect(notice).toHaveTextContent('/proc/schedstat');
  });

  it('says when the turns are too short for the work to be worth the scheduling', async () => {
    open('901');
    vi.stubGlobal('fetch', mockServer({ fixture: 'chatty', pid: '901' }));
    render(<PidSchedStatApp />);

    expect(await screen.findByTestId('chatty')).toHaveTextContent(
      'the scheduling costs more than the work',
    );
    expect(screen.queryByTestId('wait-share')).toHaveTextContent('scheduler doing its job');
  });

  /** `0 0 0` is a task that never ran and a kernel not collecting, printed alike. */
  it('reads three zeroes as two answers it cannot separate', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'not-collecting' }));
    render(<PidSchedStatApp />);

    const notice = await screen.findByTestId('all-zero');
    expect(notice).toHaveTextContent('kernel is not collecting');
    expect(notice).toHaveTextContent('kernel.sched_schedstats');
    // Nothing to average, so no averages are claimed.
    expect(screen.queryByTestId('averages')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wait-share')).not.toBeInTheDocument();
  });

  it('reports a truncated line and an over-long one', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '100 50\n' }));
    const { unmount } = render(<PidSchedStatApp />);
    expect(await screen.findByTestId('short')).toHaveTextContent('2 of the three counters');
    unmount();

    vi.stubGlobal('fetch', mockServer({ body: '100 50 7 99\n' }));
    render(<PidSchedStatApp />);
    expect(await screen.findByTestId('extra')).toHaveTextContent('1 more number');
  });

  it('reads a file that is not numbers as one from somewhere else', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'not a schedstat line\n' }));
    render(<PidSchedStatApp />);

    expect(await screen.findByTestId('unreadable')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reads an empty file as one the backend could not read', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<PidSchedStatApp />);

    expect(await screen.findByTestId('empty')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidSchedStatApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(schedstat('busy'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidSchedStatApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a process that is not there', async () => {
    open('9999');
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<PidSchedStatApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/9999/schedstat (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'busy', pid: 'self' },
  { fixture: 'contended', pid: '4242' },
  { fixture: 'chatty', pid: '901' },
  { fixture: 'shell', pid: 'self' },
  { fixture: 'not-collecting', pid: 'self' },
])('PidSchedStatApp with whatever the server serves: $fixture', ({ fixture, pid }) => {
  it('renders all three counters', async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture, pid }));
    render(<PidSchedStatApp />);

    expect(await rows()).toHaveLength(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
