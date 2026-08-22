import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readAsoundModulesFixture as modules } from './test/fixtures';
import { AsoundModulesApp } from './AsoundModulesApp';

/** Stands in for the backend serving /proc/asound/modules. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/asound/modules') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? modules(options.fixture ?? 'usb-headset'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Cards and their modules' });

/** The data rows, in the order the file listed them. */
const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row for a card, matched on the slot in its first cell. */
const rowFor = async (slot: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelector('td')?.textContent === slot)!;

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/asound/modules');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('AsoundModulesApp', () => {
  it('requests /proc/asound/modules from its own path', async () => {
    render(<AsoundModulesApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/asound/modules',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per card rather than per module', async () => {
    render(<AsoundModulesApp />);

    expect(await rows()).toHaveLength(2);
    expect(stat('cards')).toHaveTextContent('2');
    expect(stat('drivers')).toHaveTextContent('2');
  });

  it('reads the number as the slot every other ALSA name is built from', async () => {
    render(<AsoundModulesApp />);

    const row = await rowFor('1');
    expect(within(row).getByTitle(/index into snd_cards\[\]/)).toHaveTextContent('1');
    expect(row).toHaveTextContent('hw:1');
  });

  it('says which module registered the card, and how it is spelled on disk', async () => {
    render(<AsoundModulesApp />);

    expect(
      within(await rowFor('0')).getByTitle(/On disk it is snd-hda-intel\.ko/),
    ).toHaveTextContent('snd_hda_intel');
  });

  /** Which is the whole misreading this file invites. */
  it('says what a driver is, and that the codecs behind it are not here', async () => {
    render(<AsoundModulesApp />);

    expect(await rowFor('0')).toHaveTextContent('register no card of their own');
    expect(await rowFor('1')).toHaveTextContent('One module for every USB audio device');
  });

  /** The arrangement written out as the parameter that would pin it. */
  it('offers the slots= line that keeps this order across reboots', async () => {
    render(<AsoundModulesApp />);

    expect(await screen.findByTestId('slots-option')).toHaveTextContent(
      'options snd slots=snd_hda_intel,snd_usb_audio',
    );
  });

  it('says nothing about a shared driver or a gap where there is neither', async () => {
    render(<AsoundModulesApp />);

    await table();
    expect(screen.queryByTestId('shared')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gaps')).not.toBeInTheDocument();
  });

  describe('two cards on one module', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'two-of-a-kind' }));
    });

    it('calls out the pair slots= cannot pin apart', async () => {
      render(<AsoundModulesApp />);

      const notice = await screen.findByTestId('shared');
      expect(notice).toHaveTextContent('snd_usb_audio registered 2 cards');
      expect(notice).toHaveTextContent('slots 0 and 1');
      expect(notice).toHaveTextContent('index=');
    });

    it('marks both rows and counts one driver against two cards', async () => {
      render(<AsoundModulesApp />);

      expect(within(await rowFor('0')).getByText('two cards')).toBeInTheDocument();
      expect(stat('cards')).toHaveTextContent('2');
      expect(stat('drivers')).toHaveTextContent('1');
    });
  });

  describe('a slot standing empty', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'pinned-slots' }));
    });

    it('explains the hole as a slot rather than a missing card', async () => {
      render(<AsoundModulesApp />);

      const notice = await screen.findByTestId('gaps');
      expect(notice).toHaveTextContent('Slot 1 is empty');
      expect(notice).toHaveTextContent('never loaded');
      expect(stat('highest slot')).toHaveTextContent('2');
    });

    /** The parameter is positional, so there is no line to offer. */
    it('offers no slots= line for an arrangement it cannot spell', async () => {
      render(<AsoundModulesApp />);

      await table();
      expect(screen.queryByTestId('slots-option')).not.toBeInTheDocument();
    });
  });

  it('reads the Pi’s on-board audio as its one card', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raspberry-pi' }));
    render(<AsoundModulesApp />);

    expect(await rowFor('0')).toHaveTextContent('snd_bcm2835');
    expect(await rowFor('0')).toHaveTextContent("Raspberry Pi's on-board audio");
  });

  it('shows a driver it has no note for without inventing one', async () => {
    vi.stubGlobal('fetch', mockServer({ body: ' 0 snd_soc_rockchip_i2s\n' }));
    render(<AsoundModulesApp />);

    const row = await rowFor('0');
    expect(row).toHaveTextContent('snd_soc_rockchip_i2s');
    expect(within(row).getByTitle('A driver this page has no note for')).toHaveTextContent('—');
  });

  /**
   * An empty file is an answer here: the loop prints the slots that are taken,
   * and a sound core with no card has none.
   */
  it('explains a machine with the core loaded and no card', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-cards' }));
    render(<AsoundModulesApp />);

    expect(await screen.findByText(/No cards on this machine/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<AsoundModulesApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(modules('usb-headset'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<AsoundModulesApp />);

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
    render(<AsoundModulesApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/asound/modules (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', cards: 1, drivers: '1' },
  { fixture: 'raspberry-pi', cards: 1, drivers: '1' },
  { fixture: 'usb-headset', cards: 2, drivers: '2' },
  { fixture: 'two-of-a-kind', cards: 2, drivers: '1' },
  { fixture: 'pinned-slots', cards: 2, drivers: '2' },
])('AsoundModulesApp with whatever the server serves: $fixture', (each) => {
  beforeEach(() => {
    window.history.pushState({}, '', '/asound/modules');
    vi.stubGlobal('fetch', mockServer({ fixture: each.fixture }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it(`renders ${each.cards} cards from ${each.drivers} driver(s)`, async () => {
    render(<AsoundModulesApp />);

    expect(await rows()).toHaveLength(each.cards);
    expect(stat('drivers')).toHaveTextContent(each.drivers);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
