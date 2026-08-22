import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readDmaFixture as dma } from './test/fixtures';
import { DmaApp } from './DmaApp';

/** Stands in for the backend serving /proc/dma. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/dma') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? dma(options.fixture ?? 'sound-card'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'ISA DMA channels' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a channel number, matched on its first cell. */
const rowFor = async (channel: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === channel)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DmaApp', () => {
  it('requests /proc/dma from its own path', async () => {
    render(<DmaApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/dma',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  /**
   * The file lists only allocated channels, so showing all eight — with the
   * rest marked free — says more than echoing the three lines back.
   */
  it('renders all eight ISA channels, not just the allocated ones', async () => {
    render(<DmaApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(8 + 1);
    expect(await rowFor('0')).toHaveTextContent('free');
    expect(await rowFor('1')).toHaveTextContent('SoundBlaster8');
  });

  it('summarizes what is taken and what is left', async () => {
    render(<DmaApp />);

    expect(await screen.findByText('allocated')).toBeInTheDocument();
    expect(stat('allocated')).toHaveTextContent('3 of 8');
    expect(stat('carrying data')).toHaveTextContent('2');
    expect(stat('free')).toHaveTextContent('5');
  });

  // The cascade is allocated but chains the controllers; it carries no data.
  it('marks the cascade and leaves it out of the working channels', async () => {
    render(<DmaApp />);

    const row = await rowFor('4');
    expect(
      within(row).getByTitle('Chains the second controller to the first; it cannot carry data'),
    ).toBeInTheDocument();
    // The cascade is not among the channels shown as carrying data.
    expect(within(await rowFor('1')).getByText('SoundBlaster8')).toBeInTheDocument();
    expect(within(row).queryByText(/SoundBlaster/)).not.toBeInTheDocument();
    expect(stat('carrying data')).toHaveTextContent('2');
  });

  it('shows the width and controller each channel belongs to', async () => {
    render(<DmaApp />);

    expect(await rowFor('1')).toHaveTextContent('8-bit');
    expect(await rowFor('5')).toHaveTextContent('16-bit');
  });

  it('dims the channels it inferred as free', async () => {
    render(<DmaApp />);

    expect(await rowFor('0')).toHaveClass('dma__row--free');
    expect(await rowFor('1')).not.toHaveClass('dma__row--free');
  });

  it('shows a machine with nothing but the cascade', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'cascade-only' }));
    render(<DmaApp />);

    await table();
    expect(stat('allocated')).toHaveTextContent('1 of 8');
    expect(stat('carrying data')).toHaveTextContent('0');
    expect(stat('free')).toHaveTextContent('7');
  });

  it('shows a machine with every channel taken', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'busy-legacy' }));
    render(<DmaApp />);

    await table();
    expect(stat('free')).toHaveTextContent('0');
    expect(within(await table()).queryByText('free')).not.toBeInTheDocument();
  });

  /**
   * `No DMA` means the machine has no controller at all, which is not the same
   * as one with nothing allocated — so the page says that instead of drawing an
   * empty eight-row table.
   */
  it('explains a machine with no ISA DMA controller', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-isa-dma' }));
    render(<DmaApp />);

    expect(await screen.findByText(/no ISA DMA controller/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    // Normal for ARM64, so not an error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // An empty file is a controller with nothing allocated — different again.
  it('shows all eight as free for an empty file', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<DmaApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(8 + 1);
    expect(stat('free')).toHaveTextContent('8');
    expect(screen.queryByText(/no ISA DMA controller/i)).not.toBeInTheDocument();
  });

  it('makes no ISA claims about a channel outside the eight', async () => {
    vi.stubGlobal('fetch', mockServer({ body: ' 4: cascade\n12: someotherdma\n' }));
    render(<DmaApp />);

    const other = await screen.findByRole('table', { name: 'Allocated DMA channels' });
    expect(within(other).getAllByRole('row')).toHaveLength(2 + 1);
    expect(screen.getByText(/other than the ISA 8237 pair/i)).toBeInTheDocument();
    // No width or controller columns, since neither applies.
    expect(screen.queryByText('16-bit')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<DmaApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(dma('sound-card'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<DmaApp />);

    await table();
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
    render(<DmaApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/dma (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine that has no controller at all.
describe.each([
  { fixture: 'cascade-only', allocated: '1 of 8' },
  { fixture: 'sound-card', allocated: '3 of 8' },
  { fixture: 'floppy-and-parport', allocated: '3 of 8' },
  { fixture: 'busy-legacy', allocated: '8 of 8' },
])('DmaApp with whatever the server serves: $fixture', ({ fixture, allocated }) => {
  it(`renders ${allocated} allocated`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<DmaApp />);

    await table();
    expect(stat('allocated')).toHaveTextContent(allocated);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
