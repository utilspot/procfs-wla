import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readAsoundPcmFixture as pcm } from './test/fixtures';
import { AsoundPcmApp } from './AsoundPcmApp';

/** Stands in for the backend serving /proc/asound/pcm. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/asound/pcm') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? pcm(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'PCM devices' });

/** The data rows, in the order the file listed them. */
const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row for a device, matched on the address in its first cell. */
const rowFor = async (address: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelector('td')?.textContent === address)!;

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/asound/pcm');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('AsoundPcmApp', () => {
  it('requests /proc/asound/pcm from its own path', async () => {
    render(<AsoundPcmApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/asound/pcm',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per device', async () => {
    render(<AsoundPcmApp />);

    expect(await rows()).toHaveLength(3);
  });

  it('summarizes the devices, the cards and the substreams', async () => {
    render(<AsoundPcmApp />);

    await table();
    expect(stat('devices')).toHaveTextContent('3');
    expect(stat('cards')).toHaveTextContent('1');
    expect(stat('playback')).toHaveTextContent('3');
    expect(stat('capture')).toHaveTextContent('1');
  });

  /** Both names are printed, and they are separate fields. */
  it('shows the id beside the name it is not the same field as', async () => {
    render(<AsoundPcmApp />);

    const row = await rowFor('00-00');
    expect(within(row).getByTitle(/pcm->id/)).toHaveTextContent('ALC256 Analog');
    expect(within(row).getByTitle(/pcm->name/)).toHaveTextContent('ALC256 Analog');
  });

  it('says which direction a device has, from the fields the kernel printed', async () => {
    render(<AsoundPcmApp />);

    expect(within(await rowFor('00-00')).getByText('duplex')).toBeInTheDocument();
    expect(within(await rowFor('00-03')).getByText('playback only')).toHaveAttribute(
      'title',
      expect.stringContaining('No capture field at all'),
    );
  });

  /** A stream with no substreams is left out rather than printed as 0. */
  it('shows a missing count as a field that was never printed', async () => {
    render(<AsoundPcmApp />);

    const row = await rowFor('00-03');
    expect(
      within(row).getByTitle(/no capture substreams, so the kernel left the field out/),
    ).toHaveTextContent('—');
  });

  /** Which is where the P lines on the timers page come from. */
  it('names the timer lines a device’s substreams have', async () => {
    render(<AsoundPcmApp />);

    expect(await rowFor('00-00')).toHaveTextContent('P0-0-0 P0-0-1');
    expect(
      within(await rowFor('00-07')).getByTitle(/1 substream, so one line in \/proc\/asound\/timers/),
    ).toHaveTextContent('P0-7-0');
  });

  it('explains device numbers that skip as the driver’s own', async () => {
    render(<AsoundPcmApp />);

    const notice = await screen.findByTestId('gaps');
    expect(notice).toHaveTextContent('The device numbers skip on card 0');
    expect(notice).toHaveTextContent('HDMI ones at 3 and 7');
  });

  it('says nothing about mixing on a machine where nothing does', async () => {
    render(<AsoundPcmApp />);

    await table();
    expect(screen.queryByTestId('multi-open')).not.toBeInTheDocument();
  });

  describe('a card that mixes in hardware', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'many-substreams' }));
    });

    it('reads the counts as streams at once rather than channels', async () => {
      render(<AsoundPcmApp />);

      const notice = await screen.findByTestId('multi-open');
      expect(notice).toHaveTextContent('2 devices carry more than one stream at a time');
      expect(notice).toHaveTextContent('00-00 (32)');
      expect(notice).toHaveTextContent('substreams, not channels');
    });

    it('keeps an id that is nothing like the name beside it', async () => {
      render(<AsoundPcmApp />);

      const row = await rowFor('00-00');
      expect(row).toHaveTextContent('emu10k1');
      expect(row).toHaveTextContent('ADC Capture/Standard PCM Playback');
    });

    it('abbreviates the timer lines of a device that has too many to list', async () => {
      render(<AsoundPcmApp />);

      expect(
        within(await rowFor('00-00')).getByTitle(/33 substreams.*P0-0-0 through P0-0-1/),
      ).toHaveTextContent('P0-0-0 … P0-0-1');
    });

    it('says nothing about gaps where the numbering has none', async () => {
      render(<AsoundPcmApp />);

      await table();
      expect(screen.queryByTestId('gaps')).not.toBeInTheDocument();
    });
  });

  it('reads a microphone as a device with no playback at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'capture-only' }));
    render(<AsoundPcmApp />);

    expect(within(await rowFor('00-00')).getByText('capture only')).toBeInTheDocument();
    expect(stat('playback')).toHaveTextContent('0');
    expect(stat('capture')).toHaveTextContent('1');
  });

  it('counts a second card as a second card', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'usb-headset' }));
    render(<AsoundPcmApp />);

    await table();
    expect(stat('cards')).toHaveTextContent('2');
    expect(await rowFor('01-00')).toHaveTextContent('USB Audio');
    expect(await rowFor('01-00')).toHaveTextContent('P1-0-0 P1-0-1');
  });

  it('reads four substreams as four playback timer lines two apart', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raspberry-pi' }));
    render(<AsoundPcmApp />);

    const row = await rowFor('00-00');
    // Four is few enough for the title to name them all, and too many for the
    // cell to, so the cell shows the ends of the run.
    expect(within(row).getByTitle(/4 lines in \/proc\/asound\/timers: P0-0-0, P0-0-2, P0-0-4, P0-0-6/)).toHaveTextContent(
      'P0-0-0 … P0-0-6',
    );
    expect(stat('playback')).toHaveTextContent('4');
  });

  /**
   * An empty file is an answer here rather than a failure: the sound core can
   * be loaded with no card under it.
   */
  it('explains a machine with no PCM device at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-devices' }));
    render(<AsoundPcmApp />);

    expect(await screen.findByText(/No PCM devices on this machine/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<AsoundPcmApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(pcm('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<AsoundPcmApp />);

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
    render(<AsoundPcmApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/asound/pcm (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine with no device in it.
describe.each([
  { fixture: 'desktop', devices: 3, cards: '1' },
  { fixture: 'raspberry-pi', devices: 1, cards: '1' },
  { fixture: 'usb-headset', devices: 3, cards: '2' },
  { fixture: 'capture-only', devices: 1, cards: '1' },
  { fixture: 'many-substreams', devices: 3, cards: '1' },
])('AsoundPcmApp with whatever the server serves: $fixture', (each) => {
  beforeEach(() => {
    window.history.pushState({}, '', '/asound/pcm');
    vi.stubGlobal('fetch', mockServer({ fixture: each.fixture }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it(`renders ${each.devices} devices on ${each.cards} card(s)`, async () => {
    render(<AsoundPcmApp />);

    expect(await rows()).toHaveLength(each.devices);
    expect(stat('cards')).toHaveTextContent(each.cards);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
