import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidSetgroupsFixture as setgroups } from './test/fixtures';
import { PidSetgroupsApp } from './PidSetgroupsApp';

/**
 * Stands in for the backend serving /proc/<pid>/setgroups. A fixture is a
 * machine with a process or two in it, so this answers per pid and 404s for one
 * it does not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; pid?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/setgroups$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    return new Response(
      options.body ?? setgroups(options.fixture ?? 'allow', options.pid ?? match[1]!),
      { headers: { 'Content-Type': 'text/plain' } },
    );
  });
}

function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/setgroups`);
}

const table = () => screen.findByRole('table', { name: 'Conditions setgroups needs' });
const rows = async () => within(await table()).getAllByRole('row').slice(1);

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidSetgroupsApp', () => {
  it('reads /proc/self/setgroups when no process is named', async () => {
    render(<PidSetgroupsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/setgroups',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/setgroups');
  });

  it('reads the process its own URL names', async () => {
    open('3117');
    vi.stubGlobal('fetch', mockServer({ fixture: 'mixed', pid: '3117' }));
    render(<PidSetgroupsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/3117/setgroups', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/3117/setgroups');
  });

  /** The centrepiece: allow is one of three conditions, not permission. */
  it('shows the three conditions and marks the one this file answers', async () => {
    render(<PidSetgroupsApp />);

    expect(await rows()).toHaveLength(3);
    expect((await rows())[0]).toHaveClass('setg__row--reported');
    expect((await rows())[0]).toHaveTextContent('met');
    expect((await rows())[1]).toHaveTextContent('not here');
    expect((await rows())[1]).toHaveTextContent('/proc/<pid>/gid_map');
    expect((await rows())[2]).toHaveTextContent('/proc/<pid>/status');
  });

  it('says allow is necessary rather than sufficient', async () => {
    render(<PidSetgroupsApp />);

    const notice = await screen.findByTestId('allowed');

    expect(notice).toHaveTextContent('one of three conditions is met');
    expect(notice).toHaveTextContent('brand-new namespace');
    expect(await screen.findByTestId('summary')).toHaveTextContent('1 of 3');
  });

  /** deny is an `and` that has already failed, so it is the whole answer. */
  it('says deny settles the question on its own', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'denied' }));
    render(<PidSetgroupsApp />);

    expect(await screen.findByTestId('denied')).toHaveTextContent('for as long as it exists');
    expect(await screen.findByTestId('short-circuit')).toHaveTextContent(
      'The other two conditions do not matter here',
    );
    expect((await rows())[0]).toHaveTextContent('not met');
  });

  it('says an allow can still change and a deny never can', async () => {
    const { unmount } = render(<PidSetgroupsApp />);
    expect(await screen.findByTestId('still-writable')).toHaveTextContent('only while no');
    expect(await screen.findByTestId('summary')).toHaveTextContent('deny is still writable');
    unmount();

    vi.stubGlobal('fetch', mockServer({ fixture: 'denied' }));
    render(<PidSetgroupsApp />);
    expect(await screen.findByTestId('summary')).toHaveTextContent('never again');
    expect(screen.queryByTestId('still-writable')).not.toBeInTheDocument();
  });

  it('says what a value implies about how the namespace was made', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'denied' }));
    render(<PidSetgroupsApp />);

    const notice = await screen.findByTestId('origin');

    expect(notice).toHaveTextContent('before writing gid_map');
    expect(notice).toHaveTextContent('a single range of a single id');
  });

  /** The flag hangs off the namespace, not the process the path names. */
  it('says the answer belongs to the namespace rather than the process', async () => {
    render(<PidSetgroupsApp />);

    expect(await screen.findByTestId('namespace')).toHaveTextContent(
      'not this process’s',
    );
  });

  it('answers differently for two pids in different namespaces', async () => {
    open('1');
    vi.stubGlobal('fetch', mockServer({ fixture: 'mixed', pid: '1' }));
    const { unmount } = render(<PidSetgroupsApp />);
    expect(await screen.findByTestId('allowed')).toBeInTheDocument();
    unmount();

    open('3117');
    vi.stubGlobal('fetch', mockServer({ fixture: 'mixed', pid: '3117' }));
    render(<PidSetgroupsApp />);
    expect(await screen.findByTestId('denied')).toBeInTheDocument();
  });

  it('reads a word the kernel would not have written that way', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'ALLOW\n' }));
    render(<PidSetgroupsApp />);

    expect(await screen.findByTestId('reformatted')).toHaveTextContent('lower case');
    // Still read as the setting it plainly is.
    expect(screen.getByTestId('allowed')).toBeInTheDocument();
  });

  it('refuses a file holding neither word', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'maybe\n' }));
    render(<PidSetgroupsApp />);

    expect(await screen.findByTestId('unreadable')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reads an empty file as one the backend could not read', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<PidSetgroupsApp />);

    expect(await screen.findByTestId('empty')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidSetgroupsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(setgroups('allow'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidSetgroupsApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a process that is not there', async () => {
    open('9999');
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<PidSetgroupsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/9999/setgroups (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'allow', pid: 'self', word: 'allow' },
  { fixture: 'allow', pid: '1', word: 'allow' },
  { fixture: 'denied', pid: 'self', word: 'deny' },
  { fixture: 'denied', pid: '4242', word: 'deny' },
  { fixture: 'mixed', pid: '3117', word: 'deny' },
])('PidSetgroupsApp with whatever the server serves: $fixture/$pid', ({ fixture, pid, word }) => {
  it(`renders ${word}`, async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture, pid }));
    render(<PidSetgroupsApp />);

    expect(await screen.findByTestId('summary')).toHaveTextContent(word);
    expect(await rows()).toHaveLength(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
