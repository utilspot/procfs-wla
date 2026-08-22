import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readAsoundCardsFixture as cards } from './test/fixtures';
import { AsoundCardsApp } from './AsoundCardsApp';

/** Stands in for the backend serving /proc/asound/cards. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/asound/cards') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? cards(options.fixture ?? 'two-cards'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Sound cards' });

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
  window.history.pushState({}, '', '/asound/cards');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('AsoundCardsApp', () => {
  it('requests /proc/asound/cards from its own path', async () => {
    render(<AsoundCardsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/asound/cards',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  /** The record is two lines, and one row is one card. */
  it('renders a row per card rather than per line', async () => {
    render(<AsoundCardsApp />);

    expect(await rows()).toHaveLength(2);
    expect(stat('cards')).toHaveTextContent('2');
    expect(stat('drivers')).toHaveTextContent('2');
  });

  it('shows the four names a card has, the long one under the short', async () => {
    render(<AsoundCardsApp />);

    const row = await rowFor('0');
    expect(row).toHaveTextContent('PCH');
    expect(row).toHaveTextContent('HDA-Intel');
    expect(row).toHaveTextContent('HDA Intel PCH');
    expect(row).toHaveTextContent('HDA Intel PCH at 0xf7f60000 irq 145');
  });

  /** The id is the handle that survives a reboot; the slot is not. */
  it('names the card both ways, by word and by number', async () => {
    render(<AsoundCardsApp />);

    const row = await rowFor('1');
    expect(within(row).getByTitle(/does not move when the slots do/)).toHaveTextContent('hw:Headset');
    expect(within(row).getByTitle('And by number, which does')).toHaveTextContent('hw:1');
  });

  it('says nothing about collisions or fallbacks where there are none', async () => {
    render(<AsoundCardsApp />);

    await table();
    expect(screen.queryByTestId('colliding')).not.toBeInTheDocument();
    expect(screen.queryByTestId('defaulted')).not.toBeInTheDocument();
  });

  describe('two of the same device', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'two-of-a-kind' }));
    });

    it('explains the suffix, and that it is counted in hex', async () => {
      render(<AsoundCardsApp />);

      const notice = await screen.findByTestId('colliding');
      expect(notice).toHaveTextContent('2 cards share the name USB Audio Device');
      expect(notice).toHaveTextContent('Device_1');
      expect(notice).toHaveTextContent('_B');
    });

    it('marks the suffixed id and keeps the bus address that tells them apart', async () => {
      render(<AsoundCardsApp />);

      expect(within(await rowFor('1')).getByText('suffixed')).toHaveAttribute(
        'title',
        expect.stringContaining('counted in hex'),
      );
      expect(await rowFor('0')).toHaveTextContent('usb-0000:00:14.0-2');
      expect(await rowFor('1')).toHaveTextContent('usb-0000:00:14.0-4');
    });
  });

  it('marks a driver name the field could not hold', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raspberry-pi' }));
    render(<AsoundCardsApp />);

    const row = await rowFor('0');
    expect(within(row).getByText('cut')).toHaveAttribute('title', '15 characters, which is the whole field');
    expect(row).toHaveTextContent('bcm2835_headpho');
  });

  it('says when the long name repeats the short one', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raspberry-pi' }));
    render(<AsoundCardsApp />);

    expect(
      within(await rowFor('0')).getByTitle('The long name says no more than the short one'),
    ).toHaveTextContent('same again');
  });

  it('explains the id a card with no usable name falls back to', async () => {
    vi.stubGlobal('fetch', mockServer({ body: ' 0 [Default        ]: USB-Audio - USB Audio\n                      USB Audio at usb-0000:00:14.0-1\n' }));
    render(<AsoundCardsApp />);

    const notice = await screen.findByTestId('defaulted');
    expect(notice).toHaveTextContent('A card is named Default');
    expect(notice).toHaveTextContent('/proc/asound/card0');
  });

  /** The kernel says it in words, which no other file in the directory does. */
  it('reads the sentinel as the answer it is', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-soundcards' }));
    render(<AsoundCardsApp />);

    const notice = await screen.findByTestId('no-soundcards');
    expect(notice).toHaveTextContent('--- no soundcards ---');
    expect(notice).toHaveTextContent('no card under it');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('tells an empty file from the sentinel and calls it a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<AsoundCardsApp />);

    // The sentence is broken up by the <code> around the sentinel, so the
    // halves either side of it are what there is to match on.
    expect(
      await screen.findByText(/the read failing rather than the machine having nothing/),
    ).toBeInTheDocument();
    expect(screen.getByText('--- no soundcards ---')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<AsoundCardsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(cards('two-cards'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<AsoundCardsApp />);

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
    render(<AsoundCardsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/asound/cards (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', cards: 1, drivers: '1' },
  { fixture: 'raspberry-pi', cards: 1, drivers: '1' },
  { fixture: 'two-cards', cards: 2, drivers: '2' },
  { fixture: 'two-of-a-kind', cards: 2, drivers: '1' },
  { fixture: 'emulated', cards: 1, drivers: '1' },
])('AsoundCardsApp with whatever the server serves: $fixture', (each) => {
  beforeEach(() => {
    window.history.pushState({}, '', '/asound/cards');
    vi.stubGlobal('fetch', mockServer({ fixture: each.fixture }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it(`renders ${each.cards} cards from ${each.drivers} driver(s)`, async () => {
    render(<AsoundCardsApp />);

    expect(await rows()).toHaveLength(each.cards);
    expect(stat('drivers')).toHaveTextContent(each.drivers);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
