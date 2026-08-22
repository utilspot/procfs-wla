import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readLimitsFixture as limits } from './test/fixtures';
import { LimitsApp } from './LimitsApp';

/**
 * Stands in for the backend serving /proc/<pid>/limits. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/limits$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? limits(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/limits`);
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const table = () => screen.findByRole('table', { name: 'Resource limits' });

/** One row of the table, by the limit it is for. */
const row = (name: string): HTMLElement =>
  screen.getByRole('cell', { name: new RegExp(`^${name}`) }).closest('tr') as HTMLElement;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('LimitsApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/limits when no process is named', async () => {
    render(<LimitsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/limits',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    // Which process was read is said once, in the page's heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/limits');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<LimitsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/limits', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/limits');
  });

  /**
   * Which processes exist is the backend's answer to give, not this page's to
   * guess: a URL naming one that is not there is asked for and the 404 shown.
   */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<LimitsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP 404`);
    expect(fetch).toHaveBeenCalledWith(`/0/api/file/${pid}/limits`, expect.anything());
  });

  it('accepts the kernel’s own symbolic names', async () => {
    // No fixture has a thread-self directory, so serve one body for any pid:
    // what matters here is that the value is accepted and reaches the path.
    vi.stubGlobal('fetch', mockServer({ body: limits('desktop', 'self') }));
    open('thread-self');
    render(<LimitsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/thread-self/limits', expect.anything());
  });

  it('counts what the process limits and what it leaves alone', async () => {
    render(<LimitsApp />);

    await table();
    expect(stat('limits')).toHaveTextContent('16');
    expect(stat('unlimited')).toHaveTextContent('7');
    expect(stat('it can raise')).toHaveTextContent('3');
  });

  it('gives every limit its pair, in the unit the row is counted in', async () => {
    render(<LimitsApp />);

    await table();
    const cells = within(row('Max stack size')).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('8 MiB');
    expect(cells[2]).toHaveTextContent('unlimited');
    expect(cells[3]).toHaveTextContent('bytes');
  });

  it('names the constant setrlimit is called with, and the ulimit flag', async () => {
    render(<LimitsApp />);

    await table();
    const note = within(row('Max open files')).getAllByRole('cell')[4]!;

    expect(note).toHaveTextContent('RLIMIT_NOFILE');
    expect(note).toHaveTextContent('ulimit -n');
    expect(note).toHaveTextContent('EMFILE');
  });

  /**
   * The gap between soft and hard is headroom the process can take itself,
   * which is the single most useful thing this file says.
   */
  it('marks a limit the process could raise without any privilege', async () => {
    render(<LimitsApp />);

    await table();
    expect(within(row('Max open files')).getByText('raisable')).toBeInTheDocument();
    expect(within(row('Max processes')).queryByText('raisable')).not.toBeInTheDocument();
  });

  it('says so up front for the file limit, which is the one that bites', async () => {
    render(<LimitsApp />);

    await table();
    expect(screen.getByTestId('nofile')).toHaveTextContent('enforced at 1,024');
    expect(screen.getByTestId('nofile')).toHaveTextContent('ceiling of 1,048,576');
    expect(screen.getByTestId('nofile')).toHaveTextContent('needs no privilege');
  });

  it('says nothing of the sort where the process is already at the ceiling', async () => {
    open('12282');
    render(<LimitsApp />);

    await table();
    expect(screen.queryByTestId('nofile')).not.toBeInTheDocument();
    expect(stat('it can raise')).toHaveTextContent('1');
  });

  /** Counted across the real user id machine-wide, not for this process. */
  it('marks the three limits that are per user rather than per process', async () => {
    render(<LimitsApp />);

    await table();
    for (const name of ['Max processes', 'Max pending signals', 'Max msgqueue size']) {
      expect(within(row(name)).getByText('per user'), name).toBeInTheDocument();
    }
    expect(within(row('Max open files')).queryByText('per user')).not.toBeInTheDocument();
  });

  it('marks the two no kernel has enforced since 2.4', async () => {
    render(<LimitsApp />);

    await table();
    expect(within(row('Max resident set')).getByText('not enforced')).toHaveAttribute(
      'title',
      expect.stringContaining('2.4.30'),
    );
  });

  it('shows the limits usually asked about without unfolding the table', async () => {
    render(<LimitsApp />);

    await table();
    const headline = screen.getByTestId('headline');
    expect(headline).toHaveTextContent('open files 1,024');
    expect(headline).toHaveTextContent('stack 8 MiB');
    expect(headline).toHaveTextContent('no core dumps');
  });

  /** The value is 20 minus the lowest nice the process may ask for. */
  it('reads the nice ceiling backwards, as the kernel writes it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'realtime' }));
    render(<LimitsApp />);

    await table();
    expect(within(row('Max nice priority')).getAllByRole('cell')[4]).toHaveTextContent(
      'floor of nice -20',
    );
  });

  it('calls out real-time priority with no timeout to cut a runaway short', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'realtime' }));
    open('3117');
    render(<LimitsApp />);

    await table();
    expect(screen.getByTestId('rttime')).toHaveTextContent('SCHED_FIFO');
    expect(screen.getByTestId('rttime')).toHaveTextContent('RLIMIT_RTTIME');
  });

  it('says nothing of the sort where RTTIME is set', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'realtime' }));
    render(<LimitsApp />);

    await table();
    expect(screen.queryByTestId('rttime')).not.toBeInTheDocument();
  });

  /** Every limit pinned: nothing can be raised back without CAP_SYS_RESOURCE. */
  it('shows a locked-down service with nothing left to raise', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'hardened-service' }));
    render(<LimitsApp />);

    await table();
    expect(stat('it can raise')).toHaveTextContent('0');
    expect(screen.queryByTestId('nofile')).not.toBeInTheDocument();
    expect(within(row('Max address space')).getAllByRole('cell')[1]).toHaveTextContent('2 GiB');
  });

  /** RLIMIT_RTTIME arrived in 2.6.25, so an older file is a row short. */
  it('reads an older kernel’s file without inventing the row it lacks', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    render(<LimitsApp />);

    await table();
    expect(stat('limits')).toHaveTextContent('15');
    expect(screen.queryByRole('cell', { name: /^Max realtime timeout/ })).not.toBeInTheDocument();
  });

  it('reports a process the backend does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open('4242');
    render(<LimitsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/limits (HTTP 404 Not Found)',
    );
  });

  it('says an unreadable file has no limits in it', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<LimitsApp />);

    expect(await screen.findByText(/no limits found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<LimitsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(limits('desktop', 'self'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<LimitsApp />);

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
    render(<LimitsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/limits (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, and every one of them has a
// `self` for the page opened without a pid.
describe.each([
  { fixture: 'desktop', limits: 16 },
  { fixture: 'container', limits: 16 },
  { fixture: 'hardened-service', limits: 16 },
  { fixture: 'realtime', limits: 16 },
  { fixture: 'legacy-2.6', limits: 15 },
])('LimitsApp with whatever the server serves: $fixture', ({ fixture, limits: count }) => {
  it(`reads ${count} limits from self`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<LimitsApp />);

    await screen.findByRole('table', { name: 'Resource limits' });
    expect(stat('limits')).toHaveTextContent(String(count));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
