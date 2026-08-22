import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidCmdlineFixture as cmdline } from './test/fixtures';
import { PidCmdlineApp } from './PidCmdlineApp';

/**
 * Stands in for the backend serving /proc/<pid>/cmdline. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/cmdline$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? cmdline(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/cmdline`);
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const table = () => screen.findByRole('table', { name: 'Arguments' });

/** One row of the argument table, by its index. */
const row = (index: number): HTMLElement =>
  screen.getAllByRole('row').find((candidate) => {
    const cells = within(candidate).queryAllByRole('cell');
    return cells[0]?.textContent === String(index);
  })!;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidCmdlineApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/cmdline when no process is named', async () => {
    render(<PidCmdlineApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/cmdline',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    // Which process was read is said once, in the page's heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/cmdline');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<PidCmdlineApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/cmdline', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/cmdline');
  });

  /**
   * Which processes exist is the backend's answer to give, not this page's to
   * guess: a URL naming one that is not there is asked for and the 404 shown.
   */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<PidCmdlineApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP 404`);
    expect(fetch).toHaveBeenCalledWith(`/0/api/file/${pid}/cmdline`, expect.anything());
  });

  it('accepts the kernel’s own symbolic names', async () => {
    // No fixture has a thread-self directory, so serve one body for any pid:
    // what matters here is that the value is accepted and reaches the path.
    vi.stubGlobal('fetch', mockServer({ body: cmdline('desktop', 'self') }));
    open('thread-self');
    render(<PidCmdlineApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/thread-self/cmdline', expect.anything());
  });

  it('counts the arguments and the bytes they took', async () => {
    render(<PidCmdlineApp />);

    await table();
    expect(stat('arguments')).toHaveTextContent('5');
    expect(stat('bytes')).toHaveTextContent('31');
    expect(stat('argv[0] says')).toHaveTextContent('grep');
  });

  it('gives a row per argument, in order, with its length', async () => {
    render(<PidCmdlineApp />);

    await table();
    expect(within(row(0)).getAllByRole('cell')[1]).toHaveTextContent('grep');
    expect(within(row(1)).getAllByRole('cell')[1]).toHaveTextContent('--color=auto');
    expect(within(row(4)).getAllByRole('cell')[1]).toHaveTextContent('src');
    expect(within(row(1)).getAllByRole('cell')[2]).toHaveTextContent('12');
  });

  /** argv[0] is whatever the caller passed, so it is marked rather than trusted. */
  it('marks argv[0] as the argument it is', async () => {
    render(<PidCmdlineApp />);

    await table();
    expect(within(row(0)).getByText('argv[0]')).toBeInTheDocument();
    expect(within(row(1)).queryByText('argv[0]')).not.toBeInTheDocument();
  });

  it('rebuilds the line a shell would take, and says the spaces are its own', async () => {
    render(<PidCmdlineApp />);

    await table();
    expect(screen.getByTestId('command')).toHaveTextContent('grep --color=auto -rn TODO src');
    expect(screen.getByText(/the file had neither, only/i)).toBeInTheDocument();
  });

  it('quotes an argument holding whitespace, and marks the row', async () => {
    open('3117');
    render(<PidCmdlineApp />);

    await table();
    expect(screen.getByTestId('command')).toHaveTextContent(
      `'exec /usr/local/bin/backup.sh "$@"' '' --dry-run`,
    );
    expect(within(row(2)).getByText('holds whitespace')).toBeInTheDocument();
  });

  it('keeps an empty argument visible rather than losing it', async () => {
    open('3117');
    render(<PidCmdlineApp />);

    await table();
    expect(within(row(3)).getByText('(empty)')).toBeInTheDocument();
    expect(within(row(3)).getByText('empty')).toBeInTheDocument();
    expect(screen.getByTestId('flags')).toHaveTextContent('empty arguments 1');
  });

  /** A kernel thread never had a vector; a zombie no longer has one. */
  it('explains an empty file rather than showing an empty table', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-thread' }));
    open('142');
    render(<PidCmdlineApp />);

    const notice = await screen.findByTestId('empty');
    expect(notice).toHaveTextContent('no argument vector at all');
    expect(notice).toHaveTextContent('kernel thread');
    expect(notice).toHaveTextContent('zombie');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('says a process rewrote its own argv, and how much space it left', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'rewritten-title' }));
    render(<PidCmdlineApp />);

    await table();
    expect(screen.getByTestId('title')).toHaveTextContent('overwrote its own argv');
    expect(screen.getByTestId('title')).toHaveTextContent('86 NULs behind it');
    expect(screen.getByTestId('flags')).toHaveTextContent('padding 86');
    // A status line is not a program name, however much of a path it looks like.
    expect(stat('argv[0] says')).toHaveTextContent('—');
  });

  it('says so differently where the file holds no NUL at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'rewritten-title' }));
    open('901');
    render(<PidCmdlineApp />);

    await table();
    expect(screen.getByTestId('title')).toHaveTextContent('no NUL anywhere in the file');
    expect(screen.getByTestId('flags')).toHaveTextContent('no closing NUL');
  });

  it('reads the leading dash on argv[0] as the login marker it is', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'login-shell' }));
    render(<PidCmdlineApp />);

    await table();
    expect(screen.getByTestId('flags')).toHaveTextContent('login shell');
    // And not as part of the program's name.
    expect(stat('argv[0] says')).toHaveTextContent('bash');
  });

  /**
   * The point of the page: this file is world-readable, so an argument is not
   * a place to put a password.
   */
  it('calls out a credential passed as an argument', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'secrets' }));
    render(<PidCmdlineApp />);

    await table();
    expect(screen.getByTestId('secrets')).toHaveTextContent('the value of --password');
    expect(screen.getByTestId('secrets')).toHaveTextContent('every user on the machine can read');
    expect(within(row(5)).getByText('the value of --password')).toBeInTheDocument();
  });

  it('calls out credentials written into a URL', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'secrets' }));
    open('2044');
    render(<PidCmdlineApp />);

    await table();
    expect(screen.getByTestId('secrets')).toHaveTextContent('a URL with a password in it');
  });

  it('says nothing of the sort about an ordinary command line', async () => {
    render(<PidCmdlineApp />);

    await table();
    expect(screen.queryByTestId('secrets')).not.toBeInTheDocument();
    expect(screen.queryByTestId('title')).not.toBeInTheDocument();
  });

  it('reports a process the backend does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open('4242');
    render(<PidCmdlineApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/cmdline (HTTP 404 Not Found)',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidCmdlineApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(cmdline('desktop', 'self'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidCmdlineApp />);

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
    render(<PidCmdlineApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/cmdline (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, and every one of them has a
// `self` for the page opened without a pid.
describe.each([
  { fixture: 'desktop', args: 5 },
  { fixture: 'kernel-thread', args: 2 },
  { fixture: 'rewritten-title', args: 1 },
  { fixture: 'login-shell', args: 1 },
  { fixture: 'secrets', args: 7 },
])('PidCmdlineApp with whatever the server serves: $fixture', ({ fixture, args }) => {
  it(`reads ${args} arguments from self`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<PidCmdlineApp />);

    await screen.findByRole('table', { name: 'Arguments' });
    expect(stat('arguments')).toHaveTextContent(String(args));
  });
});
