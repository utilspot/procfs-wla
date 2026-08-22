import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSysUserFixture as fixture } from './test/fixtures';
import { SysUserUcountApp } from './SysUserUcountApp';
import { LIMITS } from './lib/sys-user-ucount';

/** Stands in for the backend serving one file of /proc/sys/user. */
function mockServer(
  name: string,
  options: { scenario?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== `/0/api/file/sys/user/${name}`) {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? fixture(options.scenario ?? 'desktop', name), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the one page at the URL naming one of the twelve, as the server would:
 * the name is in the URL and nowhere else, which is where the page reads it.
 */
function open(name: string, options: Parameters<typeof mockServer>[1] = {}) {
  window.history.pushState({}, '', `/sys/user/${name}`);
  vi.stubGlobal('fetch', mockServer(name, options));
  render(<SysUserUcountApp />);
}

/** The page, once the read has come back: its summary is the first thing on it. */
const loaded = () => screen.findByTestId('summary');

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('SysUserUcountApp', () => {
  it('requests the file its own URL names, two directories down', async () => {
    open('max_inotify_watches');

    await loaded();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/sys/user/max_inotify_watches',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('leads with the ceiling, what it is counted against, and the errno', async () => {
    open('max_cgroup_namespaces');

    await loaded();
    expect(stat('ceiling')).toHaveTextContent('55,274');
    expect(stat('counted per')).toHaveTextContent('uid × namespace');
    expect(stat('at the limit')).toHaveTextContent('ENOSPC');
    expect(stat('if still default')).toHaveTextContent('110,548');
  });

  /** The difference between the twelve that is worth a page each. */
  it('gives a descriptor limit EMFILE and no thread reading', async () => {
    open('max_inotify_instances');

    await loaded();
    expect(stat('ceiling')).toHaveTextContent('128');
    expect(stat('at the limit')).toHaveTextContent('EMFILE');
    expect(within(screen.getByTestId('summary')).queryByText('if still default')).toBeNull();
  });

  it('says what the file it is on is for', async () => {
    open('max_inotify_watches');

    expect(await screen.findByTestId('note')).toHaveTextContent(
      'upper limit on inotify watches reached',
    );
  });

  it('names the call that makes one, and the errno past the limit', async () => {
    open('max_net_namespaces');

    expect(await screen.findByTestId('reading')).toHaveTextContent(
      'made with clone(CLONE_NEWNET) or unshare(CLONE_NEWNET), and refused with ENOSPC',
    );
  });

  /**
   * The page is about the one file. Every limit against what it bounds is the
   * listing of the directory they are all in — `sys/user/index.html` — and the
   * trail at the top of this page is the way there, so carrying it here as well
   * would put eleven rows nobody asked for under the one number they did.
   */
  it('says nothing about the other eleven in a table of its own', async () => {
    open('max_uts_namespaces');

    await loaded();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByText('max_cgroup_namespaces')).toBeNull();
  });

  it('names the older sysctl the same counter is also registered as', async () => {
    open('max_fanotify_marks');

    await loaded();
    expect(screen.getByText(/older name/)).toHaveTextContent('/proc/sys/fs/fanotify/max_user_marks');
  });

  it('says nothing about a second name for a limit that has none', async () => {
    open('max_time_namespaces');

    await loaded();
    expect(screen.queryByText(/older name/)).not.toBeInTheDocument();
  });

  describe('a machine locked down by hand', () => {
    it('says no user namespace can be created at all', async () => {
      open('max_user_namespaces', { scenario: 'hardened' });

      const notice = await screen.findByTestId('disabled');
      expect(notice).toHaveTextContent('No user namespaces can be created');
      expect(notice).toHaveTextContent('clone(CLONE_NEWUSER) fails with ENOSPC');
      expect(stat('ceiling')).toHaveTextContent('none at all');
    });

    /** The other file that is 0 there hands out descriptors, so EMFILE. */
    it('names the right errno for a disabled descriptor limit', async () => {
      open('max_fanotify_groups', { scenario: 'hardened' });

      expect(await screen.findByTestId('disabled')).toHaveTextContent(
        'fanotify_init() fails with EMFILE',
      );
    });
  });

  describe('a user namespace of its own', () => {
    it('explains why two billion is not what it looks like', async () => {
      open('max_pid_namespaces', { scenario: 'new-userns' });

      const notice = await screen.findByTestId('fresh');
      expect(notice).toHaveTextContent('user namespace with no limit of its own');
      expect(notice).toHaveTextContent('every ancestor user namespace as well');
      expect(notice).toHaveTextContent('eleven files beside it');
      expect(stat('ceiling')).toHaveTextContent('no limit of its own');
    });
  });

  it('says a memory-derived default has hit the ceiling it clamps to', async () => {
    open('max_inotify_watches', { scenario: 'server' });

    const notice = await screen.findByTestId('clamped');
    expect(notice).toHaveTextContent('the ceiling the default is clamped to');
    expect(notice).toHaveTextContent('1% of addressable memory');
    expect(stat('ceiling')).toHaveTextContent('1,048,576');
  });

  it('says nothing about clamping for a namespace limit of the same size', async () => {
    open('max_net_namespaces', { scenario: 'server' });

    await loaded();
    expect(screen.queryByTestId('clamped')).not.toBeInTheDocument();
  });

  it('reads a limit somebody raised', async () => {
    open('max_inotify_watches', { scenario: 'raised' });

    await loaded();
    expect(stat('ceiling')).toHaveTextContent('524,288');
    expect(screen.queryByTestId('clamped')).not.toBeInTheDocument();
  });

  it('says a file that is not one number is not this file', async () => {
    open('max_mnt_namespaces', { body: 'many\n' });

    expect(await screen.findByText(/No number in this file/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    open('max_ipc_namespaces');
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(
      fixture('desktop', 'max_ipc_namespaces'),
      { normalizeWhitespace: false },
    );
  });

  it('links nowhere but back up its own path', async () => {
    open('max_time_namespaces');

    await loaded();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — and for a
    // file two directories down there are more of them than usual.
    expect(links.length).toBeGreaterThan(1);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a failed read', async () => {
    open('max_mnt_namespaces', { failWith: 404 });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/sys/user/max_mnt_namespaces (HTTP 404 Not Found)',
    );
  });

  it('refuses a URL naming a file that is not one of the twelve', () => {
    // One document answers for all twelve now, so a name that is not one of
    // them is something a reader can type — and it is answered rather than
    // thrown, with the names there are.
    window.history.pushState({}, '', '/sys/user/max_pid_namespace');
    render(<SysUserUcountApp />);

    expect(screen.getByRole('alert')).toHaveTextContent('max_ipc_namespaces');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/sys/user');
    expect(screen.queryByRole('table')).toBeNull();
  });

  /** The document's own name, which is a URL a reader can reach the same way. */
  it('refuses the document URL itself, which names no limit', () => {
    window.history.pushState({}, '', '/sys/user/limit');
    render(<SysUserUcountApp />);

    expect(screen.getByRole('alert')).toHaveTextContent('reads the one its own URL names');
  });

  /** Nothing is fetched for a URL the page will not read from. */
  it('asks for nothing when the URL names no limit', () => {
    window.history.pushState({}, '', '/sys/user/max_pid_namespace');
    vi.stubGlobal('fetch', vi.fn());
    render(<SysUserUcountApp />);

    expect(fetch).not.toHaveBeenCalled();
  });
});

// Every one of the twelve has a page, and each has to render what its own file
// says — the errno among it, since that is what differs.
describe.each(LIMITS.map((limit) => ({ name: limit.name, errno: limit.errno })))(
  'SysUserUcountApp on $name',
  ({ name, errno }) => {
    afterEach(() => {
      vi.unstubAllGlobals();
      window.history.pushState({}, '', '/');
    });

    it(`reads the desktop capture and reports ${errno}`, async () => {
      open(name);

      await loaded();
      expect(stat('at the limit')).toHaveTextContent(errno);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  },
);
