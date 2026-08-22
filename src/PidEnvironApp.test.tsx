import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidEnvironFixture as environ } from './test/fixtures';
import { PidEnvironApp } from './PidEnvironApp';

/**
 * Stands in for the backend serving /proc/<pid>/environ. A fixture is a machine
 * with a process or two in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; pid?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/environ$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', {
        status: options.failWith,
        statusText: options.failWith === 403 ? 'Forbidden' : 'Not Found',
      });
    }

    return new Response(
      options.body ?? environ(options.fixture ?? 'login-shell', options.pid ?? match[1]!),
      { headers: { 'Content-Type': 'text/plain' } },
    );
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/environ`);
}

const table = () => screen.findByRole('table', { name: 'Environment variables' });

/** How many variables the table is showing, which is its rows less the header. */
const variableCount = async (): Promise<number> =>
  within(await table()).getAllByRole('row').length - 1;

/** The row for a variable, matched on its name cell. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => within(row).queryAllByRole('cell')[0]?.textContent?.startsWith(name))!;
};

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidEnvironApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/environ when no process is named', async () => {
    render(<PidEnvironApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/environ',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/environ');
  });

  it('reads the process its own URL names', async () => {
    open('1');
    vi.stubGlobal('fetch', mockServer({ fixture: 'systemd-init', pid: '1' }));
    render(<PidEnvironApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/1/environ', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/1/environ');
  });

  it('renders a row per variable', async () => {
    render(<PidEnvironApp />);

    expect(await variableCount()).toBe(17);
    expect(await rowFor('USER')).toHaveTextContent('develop');
  });

  /** `LS_COLORS=rs=0:di=01;34:…` is one variable, split at the first equals. */
  it('keeps a value that has its own equals signs whole', async () => {
    render(<PidEnvironApp />);

    const row = await rowFor('LS_COLORS');

    expect(row).toHaveTextContent('rs=0:di=01;34');
  });

  it('shows a variable set to nothing as set rather than as missing', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'odd-entries' }));
    render(<PidEnvironApp />);

    const row = await rowFor('EMPTY');
    expect(
      within(row).getByTitle('Set, and set to nothing — which is not the same as unset'),
    ).toBeInTheDocument();
  });

  /** Nothing deduplicates the block, and getenv takes the first. */
  it('marks the later of two variables with the same name', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'odd-entries' }));
    render(<PidEnvironApp />);

    const rows = within(await table()).getAllByRole('row').filter((row) =>
      within(row).queryAllByRole('cell')[0]?.textContent?.startsWith('EDITOR'),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toHaveClass('env__row--shadowed');
    expect(rows[1]).toHaveClass('env__row--shadowed');
    expect(
      within(rows[1]!).getByTitle('Written earlier too, and getenv returns that one'),
    ).toBeInTheDocument();
  });

  /** `execve` takes any strings; getenv can never return one without `=`. */
  it('says which entries are not assignments at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'odd-entries' }));
    render(<PidEnvironApp />);

    await table();
    expect(screen.getByText(/One entry has/)).toBeInTheDocument();
    expect(screen.getByText('BROKEN_ENTRY_NO_EQUALS')).toBeInTheDocument();
    // The entry is named where it is explained, and is not a row of the table.
    expect(within(await table()).queryByText('BROKEN_ENTRY_NO_EQUALS')).not.toBeInTheDocument();
  });

  /**
   * The file is 0400 where cmdline is 0444, so a credential here has not been
   * shown to the machine — but it is on this page now.
   */
  it('warns about variables that look like credentials', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'with-secrets' }));
    render(<PidEnvironApp />);

    expect(
      await screen.findByText(/GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY, DATABASE_URL/),
    ).toBeInTheDocument();
    expect(within(await rowFor('GITHUB_TOKEN')).getByText('secret')).toBeInTheDocument();
    expect(within(await rowFor('REGISTRY_PASSWORD')).queryByText('secret')).not.toBeInTheDocument();
  });

  it('says nothing of the sort about an ordinary environment', async () => {
    render(<PidEnvironApp />);

    await table();
    expect(screen.queryByText(/looks like it carries/)).not.toBeInTheDocument();
    // PWD is the working directory here, whatever `--pwd` means on a command line.
    expect(within(await rowFor('PWD')).queryByText('secret')).not.toBeInTheDocument();
  });

  it('reads an empty file as a process with no memory to print', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<PidEnvironApp />);

    expect(await screen.findByText(/This file is empty, which is not an error/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidEnvironApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(environ('login-shell'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidEnvironApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /**
   * Mode 0400 and a ptrace check: another user's process is the ordinary case
   * for this file to refuse, and refusing is not a fault.
   */
  it('reports a refused read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 403 }));
    render(<PidEnvironApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/environ (HTTP 403 Forbidden)',
    );
  });

  it('reports a process that is not there', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<PidEnvironApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/environ (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'login-shell', pid: 'self', variables: '17' },
  { fixture: 'with-secrets', pid: 'self', variables: '10' },
  { fixture: 'systemd-init', pid: '1', variables: '4' },
  { fixture: 'odd-entries', pid: 'self', variables: '6' },
])('PidEnvironApp with whatever the server serves: $fixture', ({ fixture, pid, variables }) => {
  it(`renders ${variables} variables`, async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture, pid }));
    render(<PidEnvironApp />);

    expect(await variableCount()).toBe(Number(variables));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
