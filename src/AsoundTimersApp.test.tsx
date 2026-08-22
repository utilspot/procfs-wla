import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readAsoundTimersFixture as timers } from './test/fixtures';
import { AsoundTimersApp } from './AsoundTimersApp';

/** Stands in for the backend serving /proc/asound/timers. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/asound/timers') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? timers(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'ALSA timers' });

/** The data rows, in the order the file listed them. */
const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row for a timer, matched on the identifier in its first cell. */
const rowFor = async (id: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelector('td')?.textContent === id)!;

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/asound/timers');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('AsoundTimersApp', () => {
  it('requests /proc/asound/timers from its own path', async () => {
    render(<AsoundTimersApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/asound/timers',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per timer and none for the clients under them', async () => {
    render(<AsoundTimersApp />);

    expect(await rows()).toHaveLength(6);
  });

  it('summarizes the tick, the streams and who is holding a timer', async () => {
    render(<AsoundTimersApp />);

    await table();
    expect(stat('timers')).toHaveTextContent('6');
    expect(stat('kernel tick')).toHaveTextContent('1000 Hz');
    expect(stat('streams up')).toHaveTextContent('1');
    expect(stat('clients')).toHaveTextContent('1');
  });

  /** Which nothing else under /proc spells out. */
  it('reads CONFIG_HZ off the system timer', async () => {
    render(<AsoundTimersApp />);

    const notice = await screen.findByTestId('kernel-tick');
    expect(notice).toHaveTextContent('This kernel ticks at 1000 Hz');
    expect(notice).toHaveTextContent('1000.000us');
  });

  it('says a PCM timer’s resolution is the period of the stream on it', async () => {
    render(<AsoundTimersApp />);

    const notice = await screen.findByTestId('configured');
    expect(notice).toHaveTextContent('1 substream has a stream set up on it');
    expect(notice).toHaveTextContent('P0-0-0 at 10.667 ms');
  });

  /** The resolution is nanoseconds however the kernel spelled it. */
  it('shows a resolution in the unit that reads, and what was printed behind it', async () => {
    render(<AsoundTimersApp />);

    const row = await rowFor('G3');
    expect(within(row).getByTitle(/0\.001us as printed — 1 nanoseconds/)).toHaveTextContent('1 ns');
    expect(
      within(await rowFor('G0')).getByTitle(/1000\.000us as printed.*CONFIG_HZ = 1000/),
    ).toHaveTextContent('1 ms');
  });

  /** hw.ticks is a ceiling, so it is shown as the interval it stands for. */
  it('reads the tick ceiling as the longest interval it allows', async () => {
    render(<AsoundTimersApp />);

    expect(within(await rowFor('G0')).getByTitle(/2 h 46 min at this resolution/)).toHaveTextContent(
      '10,000,000',
    );
  });

  it('unpacks the substream and direction the third number packs together', async () => {
    render(<AsoundTimersApp />);

    expect(within(await rowFor('P0-0-1')).getByText('substream 0 capture')).toHaveAttribute(
      'title',
      expect.stringContaining('Printed as 1'),
    );
    expect(within(await rowFor('P0-0-0')).getByText('substream 0 playback')).toBeInTheDocument();
  });

  it('says an idle substream has no period rather than a period of zero', async () => {
    render(<AsoundTimersApp />);

    const row = await rowFor('P0-0-1');
    expect(within(row).getByTitle(/No stream is configured on this substream/)).toHaveTextContent(
      '—',
    );
  });

  it('marks the timers with no clock of their own', async () => {
    render(<AsoundTimersApp />);

    expect(within(await rowFor('P0-0-0')).getByText('SLAVE')).toHaveAttribute(
      'title',
      expect.stringContaining('SNDRV_TIMER_HW_SLAVE'),
    );
    expect(within(await rowFor('G0')).queryByText('SLAVE')).toBeNull();
  });

  it('shows the clients holding a timer open, and which have started it', async () => {
    render(<AsoundTimersApp />);

    const row = await rowFor('G3');
    expect(within(row).getByText('sequencer queue 0')).toHaveAttribute(
      'title',
      'Open, but not started',
    );
  });

  describe('a Raspberry Pi', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'raspberry-pi' }));
    });

    it('reads a 250 Hz kernel off the same line', async () => {
      render(<AsoundTimersApp />);

      await table();
      expect(stat('kernel tick')).toHaveTextContent('250 Hz');
    });

    /** Which is what makes the numbers count in twos rather than one at a time. */
    it('reads playback substreams that count in twos', async () => {
      render(<AsoundTimersApp />);

      expect(within(await rowFor('P0-0-4')).getByText('substream 2 playback')).toBeInTheDocument();
      expect(within(await rowFor('P0-0-6')).getByText('substream 3 playback')).toBeInTheDocument();
    });
  });

  describe('a 2.6 kernel', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    });

    it('names the 1024 Hz RTC timer a modern kernel no longer registers', async () => {
      render(<AsoundTimersApp />);

      const row = await rowFor('G1');
      expect(within(row).getByTitle(/marked unused in a modern kernel/)).toHaveTextContent(
        'RTC timer',
      );
      expect(stat('kernel tick')).toHaveTextContent('100 Hz');
    });

    it('counts a client that has started the timer', async () => {
      render(<AsoundTimersApp />);

      await table();
      expect(stat('clients')).toHaveTextContent('1 · 1 running');
      expect(within(await rowFor('G1')).getByText('application')).toHaveAttribute(
        'title',
        expect.stringContaining('Started or running'),
      );
    });
  });

  it('reads a card’s own timer as belonging to the card rather than a stream', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'card-timer' }));
    render(<AsoundTimersApp />);

    const row = await rowFor('C0-0');
    expect(within(row).getByTitle('Card 0, timer 0')).toBeInTheDocument();
    expect(row).toHaveTextContent('EMU10K1 timer');
    expect(row).toHaveTextContent('20.833 µs');
  });

  it('renders a machine with no card as its two global timers', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-cards' }));
    render(<AsoundTimersApp />);

    expect(await rows()).toHaveLength(2);
    expect(stat('streams up')).toHaveTextContent('0');
    expect(screen.queryByTestId('configured')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lists both ends of a duplex stream when both are configured', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'low-latency' }));
    render(<AsoundTimersApp />);

    const notice = await screen.findByTestId('configured');
    expect(notice).toHaveTextContent('2 substreams have a stream set up on them');
    expect(notice).toHaveTextContent('P0-0-0 at 1.333 ms, P0-0-1 at 1.333 ms');
    expect(stat('clients')).toHaveTextContent('3 · 2 running');
  });

  it('says an empty file is a read that failed rather than a machine with no timers', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<AsoundTimersApp />);

    expect(await screen.findByText(/No timers in this file/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<AsoundTimersApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(timers('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<AsoundTimersApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /** Three of the five captures have no /proc/asound at all. */
  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<AsoundTimersApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/asound/timers (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine with no card in it.
describe.each([
  { fixture: 'desktop', timers: 6, hz: '1000 Hz' },
  { fixture: 'raspberry-pi', timers: 6, hz: '250 Hz' },
  { fixture: 'legacy-2.6', timers: 4, hz: '100 Hz' },
  { fixture: 'card-timer', timers: 5, hz: '1000 Hz' },
  { fixture: 'low-latency', timers: 4, hz: '1000 Hz' },
  { fixture: 'no-cards', timers: 2, hz: '1000 Hz' },
])('AsoundTimersApp with whatever the server serves: $fixture', (each) => {
  beforeEach(() => {
    window.history.pushState({}, '', '/asound/timers');
    vi.stubGlobal('fetch', mockServer({ fixture: each.fixture }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it(`renders ${each.timers} timers on a ${each.hz} kernel`, async () => {
    render(<AsoundTimersApp />);

    expect(await rows()).toHaveLength(each.timers);
    expect(stat('kernel tick')).toHaveTextContent(each.hz);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
