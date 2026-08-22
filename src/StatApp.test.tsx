import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readStatFixture as stat } from './test/fixtures';
import { StatApp } from './StatApp';

/** Stands in for the backend serving /proc/stat. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/stat') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? stat(options.fixture ?? 'desktop-8core'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** The page has two tables — the CPU rows and the counters — so name them. */
const cpuTable = () => screen.findByRole('table', { name: 'CPU time since boot' });

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StatApp', () => {
  it('requests /proc/stat from its own path', async () => {
    render(<StatApp />);

    await cpuTable();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/stat',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('summarizes the machine', async () => {
    render(<StatApp />);

    expect(await screen.findByText('logical CPUs')).toBeInTheDocument();
    expect(screen.getByText('logical CPUs').previousSibling).toHaveTextContent('8');
    expect(screen.getByText('busy since boot').previousSibling).toHaveTextContent('3.2%');
    expect(screen.getByText('running').previousSibling).toHaveTextContent('2');
  });

  it('renders a row for the aggregate and one per CPU', async () => {
    render(<StatApp />);

    const rows = within(await cpuTable()).getAllByRole('row');
    expect(rows).toHaveLength(1 + 1 + 8); // header + all + cpu0..cpu7
    expect(screen.getByText('all')).toBeInTheDocument();
    expect(screen.getByText('cpu7')).toBeInTheDocument();
  });

  it('breaks each CPU down into a segment per state', async () => {
    render(<StatApp />);

    const row = (await screen.findByText('cpu0')).closest('tr')!;
    const idle = within(row).getByTitle(/^idle /);

    // Segment widths are the states' shares, so they fill the bar exactly.
    expect(idle).toHaveStyle({ width: '96.54064519906828%' });
    expect(within(row).getByTitle(/^user /)).toBeInTheDocument();
  });

  it('lists the states with their shares', async () => {
    render(<StatApp />);

    await cpuTable();
    expect(screen.getByText('idle').parentElement).toHaveTextContent('96.6%');
    expect(screen.getByText('user').parentElement).toHaveTextContent('2.5%');
  });

  it('shows the counters that accumulate since boot', async () => {
    render(<StatApp />);

    await cpuTable();
    const field = (label: string) => screen.getByRole('rowheader', { name: label }).closest('tr')!;

    expect(field('Context switches')).toHaveTextContent('892,374,615');
    expect(field('Processes created')).toHaveTextContent('1,284,736');
    expect(field('Interrupts')).toHaveTextContent('184,729,103');
  });

  it('shows a counter the kernel does not report as absent, not zero', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    render(<StatApp />);

    await cpuTable();
    const softirqs = screen.getByRole('rowheader', { name: 'Soft IRQs' }).closest('tr')!;

    expect(within(softirqs).getByTitle('Not reported by this kernel')).toHaveTextContent('—');
  });

  it('leaves steal out for a kernel that does not report it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    render(<StatApp />);

    await cpuTable();
    expect(screen.queryByText('steal')).not.toBeInTheDocument();
  });

  it('surfaces steal time on an oversubscribed VM', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'busy-server' }));
    render(<StatApp />);

    await cpuTable();
    expect(screen.getByText('steal')).toBeInTheDocument();
    expect(screen.getByText('blocked on I/O').previousSibling).toHaveTextContent('12');
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<StatApp />);
    await cpuTable();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(stat('desktop-8core'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<StatApp />);

    await cpuTable();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no CPU counters', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<StatApp />);

    expect(await screen.findByText(/no cpu counters found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<StatApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/stat (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including a 2.6 kernel that stops at seven columns.
describe.each([
  { fixture: 'desktop-8core', cpus: 8, busy: '3.2%' },
  { fixture: 'container-2core', cpus: 2, busy: '5.8%' },
  { fixture: 'legacy-2.6', cpus: 2, busy: '17.9%' },
  { fixture: 'busy-server', cpus: 4, busy: '78.8%' },
  { fixture: 'single-core-idle', cpus: 1, busy: '0.3%' },
])('StatApp with whatever the server serves: $fixture', ({ fixture, cpus, busy }) => {
  it(`renders ${cpus} CPUs at ${busy} busy`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<StatApp />);

    const table = await cpuTable();
    expect(within(table).getAllByRole('row')).toHaveLength(cpus + 2);
    expect(screen.getByText('busy since boot').previousSibling).toHaveTextContent(busy);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
