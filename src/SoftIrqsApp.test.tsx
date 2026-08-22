import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSoftIrqsFixture as softirqs } from './test/fixtures';
import { SoftIrqsApp } from './SoftIrqsApp';

/** Stands in for the backend serving /proc/softirqs. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/softirqs') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? softirqs(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const table = () => screen.findByRole('table', { name: 'Softirqs by vector' });

/** The row for one vector. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === name)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SoftIrqsApp', () => {
  it('requests /proc/softirqs from its own path', async () => {
    render(<SoftIrqsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/softirqs',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per vector and a column per CPU', async () => {
    render(<SoftIrqsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(10 + 1);
    expect(within(await table()).getAllByRole('columnheader')).toHaveLength(4 + 8);
  });

  it('summarizes the machine’s softirq work', async () => {
    render(<SoftIrqsApp />);

    expect(await screen.findByText('CPUs')).toBeInTheDocument();
    expect(stat('softirqs')).toHaveTextContent('84.3M');
    expect(stat('CPUs')).toHaveTextContent('8');
    expect(stat('busiest vector')).toHaveTextContent('SCHED');
    expect(stat('vectors raised')).toHaveTextContent('8 of 10');
  });

  it('totals each CPU’s column and marks the busiest', async () => {
    render(<SoftIrqsApp />);

    await table();
    const chips = screen.getByTestId('per-cpu-totals').querySelectorAll('.chip');
    expect(chips).toHaveLength(8);
    expect(chips[0]).toHaveTextContent('CPU0 11.3M');
    expect(chips[0]).toHaveClass('chip--flag');
    expect(chips[1]).toHaveClass('chip--model');
  });

  it('says what each vector defers', async () => {
    render(<SoftIrqsApp />);

    expect(await rowFor('NET_RX')).toHaveTextContent(/NAPI polls here/);
    expect(await rowFor('RCU')).toHaveTextContent(/freeing memory once every CPU/);
  });

  it('shows a vector’s runs and its share of the machine', async () => {
    render(<SoftIrqsApp />);

    const row = await rowFor('TIMER');
    expect(row).toHaveTextContent('23.6M');
    expect(row).toHaveTextContent('28%');
    expect(within(row).getByTitle('23,604,219 handler runs')).toBeInTheDocument();
  });

  /**
   * The rows are a fixed list, so a zero is the vector never having run rather
   * than the machine not having it — which for HRTIMER is entirely ordinary.
   */
  it('reads an empty row as never run rather than as missing', async () => {
    render(<SoftIrqsApp />);

    const row = await rowFor('HRTIMER');
    expect(row).toHaveClass('sirq__row--idle');
    expect(
      within(row).getByTitle('This vector has never run on this machine'),
    ).toBeInTheDocument();
    expect(row).not.toHaveTextContent('0%');
  });

  it('marks the CPU that ran the most of a vector', async () => {
    render(<SoftIrqsApp />);

    const row = await rowFor('NET_RX');
    const top = row.querySelectorAll('.sirq__number--top');
    expect(top).toHaveLength(1);
    expect(top[0]).toHaveTextContent('812.4k');
    expect(top[0]).toHaveAttribute('title', 'CPU0 ran 14% of this vector');
  });

  /**
   * A softirq runs on the CPU that raised it, so this is a NIC with one
   * receive queue rather than anything the scheduler could move.
   */
  it('calls out a vector doing real work that one CPU ran nearly all of', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'single-queue-nic' }));
    render(<SoftIrqsApp />);

    await table();
    expect(screen.getByRole('status')).toHaveTextContent('NET_RX ran almost entirely on CPU0');
    expect(screen.getByRole('status')).toHaveTextContent('the rest cannot help');
  });

  it('says nothing of the sort about a vector that barely ran', async () => {
    render(<SoftIrqsApp />);

    // TASKLET is just as concentrated here, and 0.1% of the machine's work.
    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders a kernel from before IRQ_POLL was renamed', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    render(<SoftIrqsApp />);

    expect(await rowFor('BLOCK_IOPOLL')).toHaveTextContent(/before 4\.5/);
    expect(await rowFor('HRTIMER')).not.toHaveClass('sirq__row--idle');
  });

  it('says an unreadable file has no vectors', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<SoftIrqsApp />);

    expect(await screen.findByText(/no softirq vectors found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<SoftIrqsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(softirqs('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<SoftIrqsApp />);

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
    render(<SoftIrqsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/softirqs (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', cpus: 8 },
  { fixture: 'net-server', cpus: 16 },
  { fixture: 'single-queue-nic', cpus: 4 },
  { fixture: 'legacy-2.6', cpus: 2 },
  { fixture: 'idle-vm', cpus: 2 },
])('SoftIrqsApp with whatever the server serves: $fixture', ({ fixture, cpus }) => {
  it(`renders ${cpus} CPU columns`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<SoftIrqsApp />);

    const rendered = await screen.findByRole('table', { name: 'Softirqs by vector' });
    expect(within(rendered).getAllByRole('columnheader')).toHaveLength(4 + cpus);
    expect(within(rendered).getAllByRole('row')).toHaveLength(10 + 1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
