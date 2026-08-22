import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSmapsFixture as smaps } from './test/fixtures';
import { SmapsApp } from './SmapsApp';

/**
 * Stands in for the backend serving /proc/<pid>/smaps. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/smaps$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? smaps(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/smaps`);
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const kinds = () => screen.findByRole('table', { name: 'Memory by kind of mapping' });

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('SmapsApp', () => {
  /** `self` is a path like any other; the URL naming it is why it is read. */
  it('reads /proc/self/smaps at the URL naming self', async () => {
    render(<SmapsApp />);

    await kinds();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/smaps',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    // Which process was read is said once, in the page's heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/smaps');
  });

  /** And at the base, where a request naming no page at all is sent. */
  it('reads /proc/self/smaps at a URL with no page in it', async () => {
    window.history.replaceState({}, '', '/');
    render(<SmapsApp />);

    await kinds();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/self/smaps', expect.anything());
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<SmapsApp />);

    await kinds();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/smaps', expect.anything());
  });

  it('puts the process it read in the heading', async () => {
    open('12282');
    render(<SmapsApp />);

    await kinds();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/smaps');
  });

  /**
   * Which processes exist is the backend's answer to give, not this page's to
   * guess: a URL naming one that is not there is asked for and the 404 shown.
   */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<SmapsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP 404`);
    expect(fetch).toHaveBeenCalledWith(`/0/api/file/${pid}/smaps`, expect.anything());
  });

  it('accepts the kernel’s own symbolic names', async () => {
    // No fixture has a thread-self directory, so serve one body for any pid:
    // what matters here is that the value is accepted and reaches the path.
    vi.stubGlobal('fetch', mockServer({ body: smaps('desktop', 'self') }));
    open('thread-self');
    render(<SmapsApp />);

    await kinds();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/thread-self/smaps', expect.anything());
  });

  it('summarizes what the process costs', async () => {
    render(<SmapsApp />);

    await kinds();
    expect(stat('proportional (Pss)')).toHaveTextContent('233 KiB');
    expect(stat('resident (Rss)')).toHaveTextContent('2.0 MiB');
    expect(stat('mappings')).toHaveTextContent('38');
  });

  /** Rss counted whole, Pss counted fairly — the gap is what is shared. */
  it('shows how much of the resident memory is shared', async () => {
    render(<SmapsApp />);

    await kinds();
    expect(screen.getByTestId('flags')).toHaveTextContent('shared 88%');
    expect(screen.getByTestId('flags')).toHaveTextContent('private dirty');
  });

  it('groups the mappings by what they are', async () => {
    render(<SmapsApp />);

    const table = await kinds();
    expect(within(table).getByText('file')).toBeInTheDocument();
    expect(within(table).getByText('anon')).toBeInTheDocument();
  });

  it('orders the mappings by what they proportionally cost', async () => {
    open('12282');
    render(<SmapsApp />);

    await kinds();
    expect(screen.getByTestId('ordering')).toHaveTextContent('largest first');
    const regions = screen.getAllByRole('region');
    expect(regions[0]).toHaveTextContent('chrome');
    expect(regions[0]).toHaveTextContent('pss 56 MiB');
  });

  it('unfolds a mapping’s full accounting on request', async () => {
    const user = userEvent.setup();
    render(<SmapsApp />);
    await kinds();

    const first = screen.getAllByRole('region')[0]!;
    await user.click(within(first).getByRole('button', { name: /Show all \d+ fields/ }));

    expect(within(first).getByText('Private_Dirty')).toBeInTheDocument();
    expect(within(first).getByText(/counted fairly/)).toBeInTheDocument();
  });

  it('shows the VmFlags codes with what they mean', async () => {
    const user = userEvent.setup();
    render(<SmapsApp />);
    await kinds();

    const first = screen.getAllByRole('region')[0]!;
    await user.click(within(first).getByRole('button', { name: /Show all \d+ fields/ }));

    expect(within(first).getByTitle('Readable')).toHaveTextContent('rd');
  });

  /** Size is address space; a reservation holds a great deal and uses none. */
  it('marks a mapping that holds address space and nothing else', async () => {
    const user = userEvent.setup();
    open('12282');
    render(<SmapsApp />);

    await kinds();
    expect(screen.getByTestId('flags')).toHaveTextContent('reservations 4');

    // Nothing is resident in them, so they sort last and are folded away.
    await user.click(screen.getByRole('button', { name: /Show all \d+ mappings/ }));
    expect(screen.getAllByText('reservation')).toHaveLength(4);
  });

  it('calls out a mapping that is writable and executable at once', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'jit-wx' }));
    render(<SmapsApp />);

    await kinds();
    expect(screen.getByTestId('wx')).toHaveTextContent('[anon:jit-code] is both');
    expect(screen.getByTestId('wx')).toHaveTextContent('writable and executable');
  });

  it('says nothing of the sort about a process without one', async () => {
    render(<SmapsApp />);

    await kinds();
    expect(screen.queryByTestId('wx')).not.toBeInTheDocument();
  });

  it('shows what has gone to swap', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'swapped' }));
    render(<SmapsApp />);

    await kinds();
    expect(screen.getByTestId('flags')).toHaveTextContent('swap 94 KiB');
  });

  it('folds the long tail of mappings away, and back', async () => {
    const user = userEvent.setup();
    render(<SmapsApp />);
    await kinds();

    expect(screen.getAllByRole('region')).toHaveLength(12);
    await user.click(screen.getByRole('button', { name: 'Show all 38 mappings' }));
    expect(screen.getAllByRole('region')).toHaveLength(38);
  });

  it('reports a process the backend does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open('4242');
    render(<SmapsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/smaps (HTTP 404 Not Found)',
    );
  });

  it('says an unreadable file has no mappings', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<SmapsApp />);

    expect(await screen.findByText(/no mappings found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<SmapsApp />);
    await kinds();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(smaps('desktop', 'self'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<SmapsApp />);

    await kinds();
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
    render(<SmapsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/smaps (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, and every one of them has a
// `self` for the page opened without a pid.
describe.each([
  { fixture: 'desktop', mappings: 38 },
  { fixture: 'shared-pair', mappings: 38 },
  { fixture: 'swapped', mappings: 38 },
  { fixture: 'jit-wx', mappings: 39 },
  { fixture: 'minimal', mappings: 15 },
])('SmapsApp with whatever the server serves: $fixture', ({ fixture, mappings }) => {
  it(`reads ${mappings} mappings from self`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<SmapsApp />);

    await screen.findByRole('table', { name: 'Memory by kind of mapping' });
    expect(stat('mappings')).toHaveTextContent(String(mappings));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
