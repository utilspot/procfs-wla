import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readTimerListFixture as timerList } from './test/fixtures';
import { TimerListApp } from './TimerListApp';

/** Stands in for the backend serving /proc/timer_list. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/timer_list') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? timerList(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** One clock base's table of pending timers. */
const base = (cpu: number, clock: number) =>
  screen.findByRole('table', { name: `Timers on clock ${clock} of cpu ${cpu}` });

/** The row for a callback within a base's table. */
const rowFor = async (table: HTMLElement, callback: string): Promise<HTMLElement> => {
  const rows = within(table).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === callback)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TimerListApp', () => {
  it('requests /proc/timer_list from its own path', async () => {
    render(<TimerListApp />);

    await base(0, 0);
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/timer_list',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a card per CPU and one per tick device', async () => {
    render(<TimerListApp />);

    await base(0, 0);
    expect(screen.getByRole('region', { name: 'CPU 0' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Broadcast device' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Per CPU device: 3' })).toBeInTheDocument();
  });

  it('summarizes what the machine has pending', async () => {
    render(<TimerListApp />);

    expect(await screen.findByText('CPUs')).toBeInTheDocument();
    expect(stat('pending timers')).toHaveTextContent('11');
    expect(stat('CPUs')).toHaveTextContent('4');
    expect(stat('next expiry')).toHaveTextContent('793 µs');
    expect(stat('since boot')).toHaveTextContent('1h 9m');
  });

  it('names the timer that is up next', async () => {
    render(<TimerListApp />);

    expect(await screen.findByTestId('next-timer')).toHaveTextContent(
      'Next up: tick_sched_timer on cpu 0 in 793 µs, then 10 more',
    );
  });

  it('says what a callback is there for', async () => {
    render(<TimerListApp />);

    const row = await rowFor(await base(0, 0), 'hrtimer_wakeup');
    expect(within(row).getByTitle(/task asleep with a deadline/)).toBeInTheDocument();
  });

  /**
   * The expiry is a range, and the gap is room to batch the wakeup with
   * another one rather than waking the CPU twice.
   */
  it('shows a timer’s slack as the window it is', async () => {
    render(<TimerListApp />);

    const row = await rowFor(await base(0, 0), 'hrtimer_wakeup');
    expect(row).toHaveTextContent('115 ms');
    expect(
      within(row).getByTitle('May fire from 65 ms — anywhere in a 50 ms window'),
    ).toHaveTextContent('50 ms');
  });

  it('says a timer with no slack has none', async () => {
    render(<TimerListApp />);

    const row = await rowFor(await base(0, 0), 'tick_sched_timer');
    expect(within(row).getByTitle('No slack: this one fires at its deadline')).toBeInTheDocument();
  });

  /** Eight bases is four clocks, each with a hard and a soft one. */
  it('marks the soft clock bases and hides the empty ones', async () => {
    render(<TimerListApp />);

    await base(0, 0);
    const cpu0 = screen.getByRole('region', { name: 'CPU 0' });
    // Only the two bases with timers on them are drawn.
    expect(within(cpu0).getAllByRole('table')).toHaveLength(2);
    expect(within(cpu0).getByText('6 of 8 clock bases have nothing queued.')).toBeInTheDocument();
  });

  it('reads the machine’s shape off the header', async () => {
    render(<TimerListApp />);

    await base(0, 0);
    const chips = screen.getByTestId('machine');
    expect(within(chips).getByText('v0.9')).toBeInTheDocument();
    expect(chips).toHaveTextContent('clock bases 8');
    expect(chips).toHaveTextContent('with slack 2');
  });

  /** Two `mode` numbers in one block, meaning two different things. */
  it('keeps the tick mode apart from the device’s own state', async () => {
    render(<TimerListApp />);

    await base(0, 0);
    const device = screen.getByRole('region', { name: 'Per CPU device: 0' });
    // The tick's own mode…
    expect(
      within(device).getByTitle(/each tick is programmed for when it is next needed/),
    ).toHaveTextContent('tick oneshot');
    // …and, further down the same block, the device's state.
    expect(
      within(device).getByTitle('Oneshot — programmed for a single event, then reprogrammed'),
    ).toHaveTextContent('device 3');
  });

  it('reads KTIME_MAX as nothing programmed rather than a date', async () => {
    render(<TimerListApp />);

    await base(0, 0);
    const broadcast = screen.getByRole('region', { name: 'Broadcast device' });
    expect(
      within(broadcast).getByTitle('KTIME_MAX: nothing is programmed on this device at all'),
    ).toHaveTextContent('nothing');
  });

  it('flags the CPUs that stopped their tick and leaned on the broadcast device', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'idle-nohz' }));
    render(<TimerListApp />);

    await base(0, 0);
    const chips = screen.getByTestId('machine');
    expect(chips).toHaveTextContent('tickless cpu 0, 1');
    expect(chips).toHaveTextContent('on broadcast cpu 0, 1');
  });

  /** What the file exists to catch. */
  it('calls out an hrtimer interrupt that hung', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'hung-timers' }));
    render(<TimerListApp />);

    await base(0, 0);
    expect(screen.getByRole('status')).toHaveTextContent(
      'cpu 0 hung 417 times, worst 8.8 ms',
    );
    expect(screen.getByRole('status')).toHaveTextContent('already in the past');
  });

  it('says nothing of the sort on a machine keeping up', async () => {
    render(<TimerListApp />);

    await base(0, 0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders a kernel from before the soft bases', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-v0.8' }));
    render(<TimerListApp />);

    await base(0, 0);
    expect(screen.getByTestId('machine')).toHaveTextContent('clock bases 4');
    expect(screen.getByRole('region', { name: 'CPU 0' })).toHaveTextContent('low resolution');
    expect(screen.getByRole('region', { name: 'Broadcast device' })).toHaveTextContent(
      /No hardware behind this tick device/,
    );
  });

  it('renders a file read with the pointers zeroed', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'restricted' }));
    render(<TimerListApp />);

    const row = await rowFor(await base(0, 0), 'tick_sched_timer');
    expect(row).toHaveTextContent('0000000000000000');
  });

  it('says an unreadable file is not this file', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<TimerListApp />);

    expect(await screen.findByText(/no cpus or tick devices found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<TimerListApp />);
    await base(0, 0);

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(timerList('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<TimerListApp />);

    await base(0, 0);
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<TimerListApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/timer_list (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', cpus: 4, timers: 11 },
  { fixture: 'idle-nohz', cpus: 2, timers: 2 },
  { fixture: 'hung-timers', cpus: 2, timers: 4 },
  { fixture: 'legacy-v0.8', cpus: 1, timers: 1 },
  { fixture: 'restricted', cpus: 2, timers: 3 },
])('TimerListApp with whatever the server serves: $fixture', ({ fixture, cpus, timers }) => {
  it(`renders ${cpus} CPUs and ${timers} timers`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<TimerListApp />);

    await screen.findAllByRole('table');
    expect(document.querySelectorAll('.tl:not(.tl__device)')).toHaveLength(cpus);
    expect(within(screen.getByTestId('summary')).getByText('pending timers').previousSibling)
      .toHaveTextContent(String(timers));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
