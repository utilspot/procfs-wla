import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readUptimeFixture as uptime } from './test/fixtures';
import { UptimeApp } from './UptimeApp';

/** Stands in for the backend serving /proc/uptime. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/uptime') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? uptime(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const table = () => screen.findByRole('table', { name: 'Idle share by CPU count' });

/** The row for one candidate CPU count. */
const rowFor = async (label: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent?.startsWith(label))!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UptimeApp', () => {
  it('requests /proc/uptime from its own path', async () => {
    render(<UptimeApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/uptime',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('summarizes the two numbers the file is made of', async () => {
    render(<UptimeApp />);

    expect(await screen.findByText('up')).toBeInTheDocument();
    expect(stat('up')).toHaveTextContent('4h 51m');
    expect(stat('idle across all CPUs')).toHaveTextContent('1d 3h 23m');
    expect(stat('CPUs’ worth of idle')).toHaveTextContent('5.64');
    expect(stat('at least')).toHaveTextContent('6 CPUs');
  });

  /** The idle figure is a sum across CPUs, not a length of wall time. */
  it('says what each of the two fields actually counts', async () => {
    render(<UptimeApp />);

    await table();
    const fields = screen.getByTestId('fields');
    expect(
      within(fields).getByTitle(
        'Seconds since boot, from CLOCK_BOOTTIME — time spent suspended included',
      ),
    ).toHaveTextContent('uptime 17465.37');
    expect(
      within(fields).getByTitle('Idle seconds added up across every CPU, iowait not among them'),
    ).toHaveTextContent('idle 98587.48');
  });

  /**
   * The count is not in this file, so the page gives a share per candidate
   * rather than one answer — and marks the row the file does pin down.
   */
  it('gives the idle share per candidate CPU count', async () => {
    render(<UptimeApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(4 + 1);
    const fewest = await rowFor('6 CPUs');
    expect(fewest).toHaveTextContent('94%');
    expect(fewest).toHaveTextContent('6%');
    expect(fewest).toHaveClass('uptime__row--fewest');
    expect(within(fewest).getByText('fewest possible')).toBeInTheDocument();
    expect(await rowFor('8 CPUs')).toHaveTextContent('71%');
  });

  it('marks only the fewest possible count', async () => {
    render(<UptimeApp />);

    await table();
    expect(document.querySelectorAll('.uptime__row--fewest')).toHaveLength(1);
  });

  it('reads a busy server as busy once a plausible count is applied', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'busy-server' }));
    render(<UptimeApp />);

    expect(await screen.findByText('up')).toBeInTheDocument();
    expect(stat('up')).toHaveTextContent('200d 0h 2m');
    expect(await rowFor('16 CPUs')).toHaveTextContent('90%');
  });

  /**
   * Uptime counts time spent suspended and the idle total does not, so a
   * laptop comes back with less idle than its uptime implies.
   */
  it('explains less than a CPU-second of idle per second', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'after-suspend' }));
    render(<UptimeApp />);

    await table();
    expect(screen.getByRole('status')).toHaveTextContent(
      'less than one CPU-second of idle here per second of uptime',
    );
    expect(screen.getByRole('status')).toHaveTextContent('suspended');
  });

  it('says nothing of the sort about a machine with idle to spare', async () => {
    render(<UptimeApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  /** A namespaced uptime beside the host's idle total cannot be one machine. */
  it('calls out a pair that implies a machine larger than any that exists', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container-timens' }));
    render(<UptimeApp />);

    await table();
    expect(screen.getByRole('status')).toHaveTextContent('at least 14,953 CPUs');
    expect(screen.getByRole('status')).toHaveTextContent('time namespace');
  });

  it('renders a single-core guest, where the two figures do line up', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'single-core-idle' }));
    render(<UptimeApp />);

    expect(await rowFor('1 CPU')).toHaveTextContent('99%');
    expect(stat('at least')).toHaveTextContent('1 CPUs');
  });

  it('renders a machine seconds after boot', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'fresh-boot' }));
    render(<UptimeApp />);

    expect(await screen.findByText('up')).toBeInTheDocument();
    expect(stat('up')).toHaveTextContent('12 s');
  });

  it('renders an uptime with no idle figure beside it', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '17465.37\n' }));
    render(<UptimeApp />);

    expect(await screen.findByText('up')).toBeInTheDocument();
    expect(stat('idle across all CPUs')).toHaveTextContent('—');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('says a file that is not two numbers is not this file', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<UptimeApp />);

    expect(await screen.findByText(/no uptime found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<UptimeApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(uptime('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<UptimeApp />);

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
    render(<UptimeApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/uptime (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', minimum: '6 CPUs' },
  { fixture: 'busy-server', minimum: '2 CPUs' },
  { fixture: 'fresh-boot', minimum: '6 CPUs' },
  { fixture: 'after-suspend', minimum: '1 CPUs' },
  { fixture: 'single-core-idle', minimum: '1 CPUs' },
  { fixture: 'container-timens', minimum: '14,953 CPUs' },
])('UptimeApp with whatever the server serves: $fixture', ({ fixture, minimum }) => {
  it(`reads at least ${minimum}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<UptimeApp />);

    await screen.findByRole('table', { name: 'Idle share by CPU count' });
    expect(stat('at least')).toHaveTextContent(minimum);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
