import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readDefaultSmpAffinityFixture as affinity } from './test/fixtures';
import { IrqDefaultSmpAffinityApp } from './IrqDefaultSmpAffinityApp';

/** Stands in for the backend serving /proc/irq/default_smp_affinity. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/irq/default_smp_affinity') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? affinity(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const summary = () => screen.findByTestId('summary');
const grid = () => screen.findByRole('list', { name: 'CPU slots the mask spells' });

/** The tile under this label, whose value is the line above it. */
const statFor = async (label: string): Promise<HTMLElement> => {
  const tiles = within(await summary()).getAllByText(label);
  return tiles[0]!.parentElement!;
};

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/irq/default_smp_affinity');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('IrqDefaultSmpAffinityApp', () => {
  it('requests /proc/irq/default_smp_affinity from its own path', async () => {
    render(<IrqDefaultSmpAffinityApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/irq/default_smp_affinity',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('shows the mask as the CPUs it names', async () => {
    render(<IrqDefaultSmpAffinityApp />);

    expect(await statFor('CPUs in the mask')).toHaveTextContent('4');
    expect(await statFor('as a CPU list')).toHaveTextContent('0-3');
    expect(await statFor('CPU slots the kernel has')).toHaveTextContent('4');
  });

  /** The order is the one thing about this format that reads backwards. */
  it('lays the groups out in file order, with the CPUs each covers', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'numa-96' }));
    render(<IrqDefaultSmpAffinityApp />);

    const groups = within(await screen.findByTestId('mask')).getAllByRole('listitem');

    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveTextContent('CPUs 95–64');
    expect(groups[2]).toHaveTextContent('CPUs 31–0');
    expect(screen.getByTestId('mask')).toHaveTextContent('the group on the right is the one holding CPU 0');
  });

  it('draws a slot per bit the mask spells, lit for the CPUs it names', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'isolated' }));
    render(<IrqDefaultSmpAffinityApp />);

    const slots = within(await grid()).getAllByRole('listitem');

    expect(slots).toHaveLength(8);
    expect(slots[0]).toHaveClass('affinity__cpu--set');
    expect(slots[1]).toHaveClass('affinity__cpu--set');
    expect(slots[2]).not.toHaveClass('affinity__cpu--set');
  });

  it('says so when nothing has narrowed the default', async () => {
    render(<IrqDefaultSmpAffinityApp />);

    expect(await screen.findByTestId('untouched')).toHaveTextContent(
      'Every bit is set, which is the mask a kernel starts with',
    );
    expect(screen.queryByTestId('narrowed')).not.toBeInTheDocument();
  });

  it('names what narrowed a default that is not all CPUs', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'isolated' }));
    render(<IrqDefaultSmpAffinityApp />);

    const narrowed = await screen.findByTestId('narrowed');

    expect(narrowed).toHaveTextContent('2 of the 8 slots this mask spells are set');
    expect(narrowed).toHaveTextContent('irqaffinity=0-1');
    expect(screen.queryByTestId('untouched')).not.toBeInTheDocument();
  });

  /**
   * The kernel intersects the mask with the online CPUs and falls back to all
   * of them, so this one reads as "none" and behaves as "every CPU".
   */
  it('warns that an empty mask is not honoured', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-cpus' }));
    render(<IrqDefaultSmpAffinityApp />);

    const none = await screen.findByTestId('no-cpus');

    expect(none).toHaveTextContent('names no CPU, and the kernel will not honour it');
    expect(none).toHaveTextContent('falls back to');
    expect(await statFor('as a CPU list')).toHaveTextContent('—');
  });

  /** 33 slots: every CPU is set, and the mask is still not all `f`. */
  it('reads a padded top digit as the CPUs there are rather than as a narrowed default', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'ragged-33' }));
    render(<IrqDefaultSmpAffinityApp />);

    const padded = await screen.findByTestId('padded');

    expect(padded).toHaveTextContent(
      '33 of the 36 slots this mask spells are set — and that is very likely every CPU there is',
    );
    expect(padded).toHaveTextContent('not a multiple of four');
    // Not the notice for a mask something really did narrow.
    expect(screen.queryByTestId('narrowed')).not.toBeInTheDocument();
    expect(await statFor('CPU slots the kernel has')).toHaveTextContent('33–36');
  });

  /** Two of eight, with a gap below the top digit: nothing about that is padding. */
  it('does not read a mask with slots to spare as padding', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'isolated' }));
    render(<IrqDefaultSmpAffinityApp />);

    await screen.findByTestId('narrowed');
    expect(screen.queryByTestId('padded')).not.toBeInTheDocument();
  });

  it('says the file is the default a new interrupt starts with', async () => {
    render(<IrqDefaultSmpAffinityApp />);

    await summary();
    expect(screen.getByText(/writing here moves nothing/i)).toBeInTheDocument();
    expect(screen.getByText(/Managed interrupts ignore it/)).toBeInTheDocument();
  });

  it('flags groups that are not the chunks the kernel writes', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'ff,ff\n' }));
    render(<IrqDefaultSmpAffinityApp />);

    expect(await screen.findByTestId('ungrouped')).toHaveTextContent(
      'exactly eight hex digits',
    );
  });

  it('flags a mask with the kernel’s newline trimmed off', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'f' }));
    render(<IrqDefaultSmpAffinityApp />);

    expect(await screen.findByTestId('unterminated')).toHaveTextContent(
      'does not end with a newline',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<IrqDefaultSmpAffinityApp />);
    await summary();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent(affinity('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<IrqDefaultSmpAffinityApp />);

    await summary();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file holds no mask', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '0-3\n' }));
    render(<IrqDefaultSmpAffinityApp />);

    expect(await screen.findByTestId('unreadable')).toHaveTextContent(
      'does not hold a CPU mask',
    );
    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
  });

  it('says so when there is nothing in the file at all', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '\n' }));
    render(<IrqDefaultSmpAffinityApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('There is nothing in this file');
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<IrqDefaultSmpAffinityApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/irq/default_smp_affinity (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from the four-CPU default to a mask naming nothing at all.
describe.each([
  { fixture: 'desktop', cpus: 4, slots: 4 },
  { fixture: 'isolated', cpus: 2, slots: 8 },
  { fixture: 'numa-96', cpus: 96, slots: 96 },
  { fixture: 'ragged-33', cpus: 33, slots: 36 },
  { fixture: 'no-cpus', cpus: 0, slots: 4 },
])('IrqDefaultSmpAffinityApp with whatever the server serves: $fixture', ({ fixture, cpus, slots }) => {
  it(`shows ${cpus} CPUs across ${slots} slots`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<IrqDefaultSmpAffinityApp />);

    expect(await statFor('CPUs in the mask')).toHaveTextContent(String(cpus));
    expect(within(await grid()).getAllByRole('listitem')).toHaveLength(slots);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
