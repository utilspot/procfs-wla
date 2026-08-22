import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readUidMapFixture as uidMap } from './test/fixtures';
import { UidMapApp } from './UidMapApp';

/**
 * Stands in for the backend serving /proc/<pid>/uid_map. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/uid_map$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? uidMap(options.fixture ?? 'initial', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/uid_map`);
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const summary = () => screen.findByTestId('summary');

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('UidMapApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/uid_map when no process is named', async () => {
    render(<UidMapApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/uid_map',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    // Which process was read is said once, in the page's heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/uid_map');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<UidMapApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/uid_map', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/uid_map');
  });

  /**
   * Which processes exist is the backend's answer to give, not this page's to
   * guess: a URL naming one that is not there is asked for and the 404 shown.
   */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<UidMapApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP 404`);
    expect(fetch).toHaveBeenCalledWith(`/0/api/file/${pid}/uid_map`, expect.anything());
  });

  it('accepts the kernel’s own symbolic names', async () => {
    // No fixture has a thread-self directory, so serve one body for any pid:
    // what matters here is that the value is accepted and reaches the path.
    vi.stubGlobal('fetch', mockServer({ body: uidMap('initial', 'self') }));
    open('thread-self');
    render(<UidMapApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/thread-self/uid_map', expect.anything());
  });

  /** Every id standing for itself: a process not in a user namespace of its own. */
  it('reads the initial namespace’s map as the identity map it is', async () => {
    render(<UidMapApp />);

    await summary();
    expect(stat('ranges')).toHaveTextContent('1 of 340');
    expect(stat('uid 0 is')).toHaveTextContent('0');
    expect(screen.getByTestId('identity')).toHaveTextContent('initial user namespace');
    expect(screen.getByTestId('flags')).toHaveTextContent('identity map');
  });

  /** The range stops one short of (uid_t)-1, which is not a user id. */
  it('says why the identity range stops one short of 4294967295', async () => {
    render(<UidMapApp />);

    await summary();
    expect(screen.getByTestId('identity')).toHaveTextContent('(uid_t)-1');
    expect(rows()[0]).toHaveTextContent('0–4,294,967,294');
  });

  it('says what uid 0 in a rootless container is outside it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'rootless' }));
    render(<UidMapApp />);

    await summary();
    expect(stat('uid 0 is')).toHaveTextContent('1,000');
    expect(screen.getByTestId('remapped')).toHaveTextContent(
      'Uid 0 in this namespace is uid 1,000 outside it',
    );
    expect(screen.getByTestId('flags')).toHaveTextContent('root is uid 1,000 outside');
    expect(screen.queryByTestId('identity')).not.toBeInTheDocument();
  });

  it('shows a row per range, with both ends of each', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'rootless' }));
    render(<UidMapApp />);

    await summary();
    expect(rows()).toHaveLength(2);
    expect(rows()[1]).toHaveTextContent('1–65,536');
    expect(rows()[1]).toHaveTextContent('100,000–165,535');
    expect(rows()[1]).toHaveTextContent('Ids 1–65536 inside are ids 100000–165535 outside');
  });

  it('marks the ranges that come out of a delegated subuid allocation', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'rootless' }));
    render(<UidMapApp />);

    await summary();
    expect(screen.getByTestId('flags')).toHaveTextContent('1 delegated range');
    expect(rows()[1]).toHaveTextContent('delegated range');
  });

  /**
   * An empty file is a namespace whose map has not been written, not a missing
   * one — and until it is, every id in there is the overflow uid.
   */
  it('explains an empty file rather than showing an empty table', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'unmapped' }));
    render(<UidMapApp />);

    expect(await screen.findByTestId('unmapped')).toHaveTextContent(
      'No mapping has been written for this namespace',
    );
    expect(screen.getByTestId('unmapped')).toHaveTextContent('overflow uid 65534');
    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  /** All the kernel takes from a writer without CAP_SETUID in the parent. */
  it('recognises the single mapping an unprivileged process may write', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'map-self' }));
    render(<UidMapApp />);

    await summary();
    expect(screen.getByTestId('flags')).toHaveTextContent('one id, written unprivileged');
    expect(stat('ids mapped')).toHaveTextContent('1');
  });

  it('says when uid 0 is not mapped at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'map-self' }));
    render(<UidMapApp />);

    await summary();
    expect(stat('uid 0 is')).toHaveTextContent('unmapped');
    expect(screen.getByTestId('no-root')).toHaveTextContent('Uid 0 is not mapped at all');
  });

  it('marks an id that is the same on both sides', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'many-extents' }));
    render(<UidMapApp />);

    await summary();
    expect(screen.getByTestId('flags')).toHaveTextContent('3 unchanged ids');
    expect(rows()[1]).toHaveTextContent('is itself on both sides');
  });

  /** Five ranges was the cap before 4.15, so a longer map needs a newer kernel. */
  it('says when a map has more ranges than an older kernel would have taken', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'many-extents' }));
    render(<UidMapApp />);

    await summary();
    expect(rows()).toHaveLength(6);
    expect(stat('ranges')).toHaveTextContent('6 of 340');
    expect(screen.getByTestId('flags')).toHaveTextContent('more than 5 ranges');
  });

  /**
   * The kernel refuses an overlapping map at write time, so a file with one did
   * not come from a running namespace and no translation of it is honest.
   */
  it('refuses to read two ranges that cover the same id as a namespace', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '         0       1000        100\n        50       5000         10\n' }));
    render(<UidMapApp />);

    expect(await screen.findByTestId('overlaps')).toHaveTextContent('cover the same id');
    expect(screen.getByTestId('overlaps')).toHaveTextContent('refuses at write time');
  });

  it('says so where a line is not three numbers', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '0 1000 1\nnot a mapping\n' }));
    render(<UidMapApp />);

    expect(await screen.findByTestId('malformed')).toHaveTextContent('not three numbers');
    // The one line that is a range is still shown.
    expect(rows()).toHaveLength(1);
  });

  it('reports a process the backend does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open('4242');
    render(<UidMapApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/uid_map (HTTP 404 Not Found)',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<UidMapApp />);
    await summary();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent('4294967295');
  });

  it('links nowhere but back up its own path', async () => {
    render(<UidMapApp />);

    await summary();
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
    render(<UidMapApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/uid_map (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, and every one of them has a
// `self` for the page opened without a pid.
describe.each([
  { fixture: 'initial', ranges: 1 },
  { fixture: 'rootless', ranges: 2 },
  { fixture: 'map-self', ranges: 1 },
  { fixture: 'many-extents', ranges: 6 },
])('UidMapApp with whatever the server serves: $fixture', ({ fixture, ranges }) => {
  it(`reads ${ranges} range(s) from self`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<UidMapApp />);

    await screen.findByTestId('summary');
    expect(rows()).toHaveLength(ranges);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/** The one fixture with nothing in its file, which is a state and not a failure. */
describe('UidMapApp with whatever the server serves: unmapped', () => {
  it('says the namespace has no map yet, without an error', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'unmapped' }));
    render(<UidMapApp />);

    await screen.findByTestId('unmapped');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
