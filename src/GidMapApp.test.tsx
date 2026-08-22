import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readGidMapFixture as gidMap } from './test/fixtures';
import { GidMapApp } from './GidMapApp';

/**
 * Stands in for the backend serving /proc/<pid>/gid_map. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/gid_map$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? gidMap(options.fixture ?? 'initial', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/gid_map`);
}

const table = () => screen.findByRole('table', { name: 'Group id mappings' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const rows = async () => within(await table()).getAllByRole('row').slice(1);

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('GidMapApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/gid_map when no process is named', async () => {
    render(<GidMapApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/gid_map',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/gid_map');
  });

  it('reads the process its own URL names', async () => {
    open('3117');
    vi.stubGlobal('fetch', mockServer({ fixture: 'rootless' }));
    render(<GidMapApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/3117/gid_map', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/3117/gid_map');
  });

  it('renders a row per range, with the groups on each side', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'rootless' }));
    render(<GidMapApp />);

    expect(await rows()).toHaveLength(2);
    expect(stat('ranges')).toHaveTextContent('2 of 340');
    expect(stat('group 0 is')).toHaveTextContent('1,000');
  });

  /**
   * The whole reason this page is not the uid_map one: an unprivileged writer
   * gets here only by turning setgroups() off, permanently.
   */
  it('reads a one-id map as a namespace whose groups are frozen', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'unshared' }));
    render(<GidMapApp />);

    const notice = await screen.findByTestId('setgroups');

    expect(notice).toHaveTextContent('very likely holds deny');
    expect(notice).toHaveTextContent('EPERM');
    expect(within(await screen.findByTestId('flags')).getByText('groups frozen')).toBeInTheDocument();
  });

  /** newgidmap held CAP_SETGID, so it never had to deny anything. */
  it('reads a map wider than one id as one that needed no deny', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'rootless' }));
    render(<GidMapApp />);

    const notice = await screen.findByTestId('setgroups');

    expect(notice).toHaveTextContent('very likely holds allow');
    expect(notice).toHaveTextContent('CAP_SETGID');
    expect(within(screen.getByTestId('flags')).queryByText('groups frozen')).not.toBeInTheDocument();
  });

  /** A written gid_map is what makes setgroups unwritable, so this one is settled. */
  it('is certain about the initial namespace rather than hedging', async () => {
    render(<GidMapApp />);

    const notice = await screen.findByTestId('setgroups');

    expect(notice).toHaveTextContent('/proc/<pid>/setgroups holds allow.');
    expect(notice).not.toHaveTextContent('very likely');
    expect(await screen.findByTestId('identity')).toBeInTheDocument();
  });

  it('reads an empty file as a namespace whose map was never written', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'unmapped' }));
    render(<GidMapApp />);

    expect(await screen.findByTestId('unmapped')).toHaveTextContent('nogroup');
    // And the one moment setgroups can still go either way, so no claim is made.
    expect(screen.queryByTestId('setgroups')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('marks the device groups held at their host numbers', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'shared-groups' }));
    render(<GidMapApp />);

    expect(await rows()).toHaveLength(7);
    expect(screen.getByTestId('passthrough')).toHaveTextContent('3 groups are held the same');
    expect(within(screen.getByTestId('flags')).getByText(/more than 5 ranges/)).toBeInTheDocument();
    // The audio group's row explains itself rather than showing bare numbers.
    const audio = (await rows()).find((row) => row.textContent?.includes('audio'))!;
    expect(audio).toHaveTextContent('itself on both sides');
  });

  it('reports ranges that tread on each other rather than translating them', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '         0       1000         10\n         5       2000         10\n' }));
    render(<GidMapApp />);

    expect(await screen.findByTestId('overlaps')).toHaveTextContent('refuses at write time');
  });

  it('reports a line that is not three numbers', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'not a mapping\n' }));
    render(<GidMapApp />);

    expect(await screen.findByTestId('malformed')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<GidMapApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(gidMap('initial', 'self'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<GidMapApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a process that is not there', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<GidMapApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/gid_map (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'initial', pid: 'self', ranges: 1 },
  { fixture: 'rootless', pid: 'self', ranges: 2 },
  { fixture: 'unshared', pid: 'self', ranges: 1 },
  { fixture: 'unshared', pid: '4242', ranges: 1 },
  { fixture: 'shared-groups', pid: 'self', ranges: 7 },
])('GidMapApp with whatever the server serves: $fixture/$pid', ({ fixture, pid, ranges }) => {
  it(`renders ${ranges} ranges`, async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<GidMapApp />);

    expect(await rows()).toHaveLength(ranges);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
