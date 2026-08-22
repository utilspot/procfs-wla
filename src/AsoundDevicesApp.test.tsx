import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readAsoundDevicesFixture as devices } from './test/fixtures';
import { AsoundDevicesApp } from './AsoundDevicesApp';

/** Stands in for the backend serving /proc/asound/devices. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/asound/devices') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? devices(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Sound devices' });

/** The data rows, in the order the file listed them. */
const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row for a minor, which is what the file is keyed by. */
const rowFor = async (minor: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelector('td')?.textContent === minor)!;

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/asound/devices');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('AsoundDevicesApp', () => {
  it('requests /proc/asound/devices from its own path', async () => {
    render(<AsoundDevicesApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/asound/devices',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per registered device', async () => {
    render(<AsoundDevicesApp />);

    expect(await rows()).toHaveLength(7);
    expect(stat('nodes')).toHaveTextContent('7');
    expect(stat('cards')).toHaveTextContent('1');
    expect(stat('PCM nodes')).toHaveTextContent('4');
  });

  /** Which is what the file is for. */
  it('names the /dev/snd node each minor is', async () => {
    render(<AsoundDevicesApp />);

    expect(await rowFor('2')).toHaveTextContent('/dev/snd/pcmC0D0p');
    expect(await rowFor('3')).toHaveTextContent('/dev/snd/pcmC0D0c');
    expect(await rowFor('6')).toHaveTextContent('/dev/snd/controlC0');
    expect(
      within(await rowFor('33')).getByTitle('Character device 116:33'),
    ).toHaveTextContent('/dev/snd/timer');
  });

  it('reads the three line shapes as what each device belongs to', async () => {
    render(<AsoundDevicesApp />);

    expect(await rowFor('4')).toHaveTextContent('card 0, device 3');
    expect(await rowFor('6')).toHaveTextContent('card 0');
    expect(within(await rowFor('1')).getByTitle(/belong to the core/)).toHaveTextContent(
      'the core',
    );
  });

  /** A distribution kernel allocates minors rather than computing them. */
  it('reads the allocation scheme off the minors themselves', async () => {
    render(<AsoundDevicesApp />);

    const notice = await screen.findByTestId('scheme');
    expect(notice).toHaveTextContent('hands its minors out rather than computing them');
    expect(notice).toHaveTextContent('CONFIG_SND_DYNAMIC_MINORS');
    expect(
      within(await rowFor('2')).getByTitle(/static scheme would have put it at 16/),
    ).toBeInTheDocument();
  });

  it('says what each type of node is for', async () => {
    render(<AsoundDevicesApp />);

    expect(await rowFor('6')).toHaveTextContent('mixer elements');
    expect(await rowFor('2')).toHaveTextContent('substreams share this node');
  });

  describe('a kernel with computed minors', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'static-minors' }));
    });

    it('says the number encodes the card and the type', async () => {
      render(<AsoundDevicesApp />);

      const notice = await screen.findByTestId('scheme');
      expect(notice).toHaveTextContent('exactly where SNDRV_MINOR(card, dev) would put it');
      expect(notice).toHaveTextContent('PCM playback at 16, capture at 24');
    });

    it('renders a second card as the block above the first', async () => {
      render(<AsoundDevicesApp />);

      expect(await rowFor('32')).toHaveTextContent('card 1');
      expect(await rowFor('48')).toHaveTextContent('/dev/snd/pcmC1D0p');
      expect(stat('cards')).toHaveTextContent('2');
    });
  });

  it('shows one node for a device with four substreams behind it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raspberry-pi' }));
    render(<AsoundDevicesApp />);

    expect(await rows()).toHaveLength(4);
    expect(stat('PCM nodes')).toHaveTextContent('1');
  });

  it('names the MIDI and hardware-dependent nodes', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'midi-and-hwdep' }));
    render(<AsoundDevicesApp />);

    expect(await rowFor('4')).toHaveTextContent('/dev/snd/midiC0D0');
    expect(await rowFor('5')).toHaveTextContent('/dev/snd/hwC0D0');
  });

  it('renders a second card taking the minors after the first', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'two-cards' }));
    render(<AsoundDevicesApp />);

    expect(await rowFor('6')).toHaveTextContent('/dev/snd/pcmC1D0p');
    expect(await rowFor('8')).toHaveTextContent('/dev/snd/controlC1');
    expect(stat('cards')).toHaveTextContent('2');
  });

  /** Unlike the pcm and modules files, this one is never empty with ALSA up. */
  it('lists the core’s own two on a machine with no card', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-cards' }));
    render(<AsoundDevicesApp />);

    expect(await rows()).toHaveLength(2);
    expect(stat('cards')).toHaveTextContent('0');
    expect(stat('PCM nodes')).toHaveTextContent('0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('marks a type the kernel’s own printer could not name', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '  9: [ 0- 0]: ?\n' }));
    render(<AsoundDevicesApp />);

    expect(await screen.findByTestId('unknown')).toHaveTextContent(
      'snd_device_type_name has no case for',
    );
    const row = await rowFor('9');
    expect(within(row).getByTitle(/prints as a question mark/)).toHaveTextContent('?');
    expect(within(row).getByTitle(/No node name can be built/)).toHaveTextContent('—');
  });

  it('says an empty file is a read that failed rather than a machine with nothing', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<AsoundDevicesApp />);

    expect(await screen.findByText(/No devices in this file/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<AsoundDevicesApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(devices('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<AsoundDevicesApp />);

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
    render(<AsoundDevicesApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/asound/devices (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine with no card in it.
describe.each([
  { fixture: 'desktop', nodes: 7, cards: '1' },
  { fixture: 'raspberry-pi', nodes: 4, cards: '1' },
  { fixture: 'two-cards', nodes: 9, cards: '2' },
  { fixture: 'midi-and-hwdep', nodes: 7, cards: '1' },
  { fixture: 'static-minors', nodes: 8, cards: '2' },
  { fixture: 'no-cards', nodes: 2, cards: '0' },
])('AsoundDevicesApp with whatever the server serves: $fixture', (each) => {
  beforeEach(() => {
    window.history.pushState({}, '', '/asound/devices');
    vi.stubGlobal('fetch', mockServer({ fixture: each.fixture }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it(`renders ${each.nodes} nodes across ${each.cards} card(s)`, async () => {
    render(<AsoundDevicesApp />);

    expect(await rows()).toHaveLength(each.nodes);
    expect(stat('cards')).toHaveTextContent(each.cards);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
