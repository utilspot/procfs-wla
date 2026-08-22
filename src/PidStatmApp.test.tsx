import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidStatmFixture as statm } from './test/fixtures';
import { PidStatmApp } from './PidStatmApp';

/**
 * Stands in for the backend serving /proc/<pid>/statm. A fixture is a machine
 * with a process in it, so this answers per pid and 404s for one it does not
 * have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; pid?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/statm$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    return new Response(options.body ?? statm(options.fixture ?? 'browser-tab', options.pid ?? match[1]!), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/statm`);
}

const table = () => screen.findByRole('table', { name: 'Memory counts' });

/** The row for one field, matched on the kernel's name for it. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => within(row).queryByRole('rowheader')?.textContent?.includes(name))!;
};

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidStatmApp', () => {
  it('reads /proc/self/statm when no process is named', async () => {
    render(<PidStatmApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/statm',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/statm');
  });

  it('reads the process its own URL names', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'shared-heavy', pid: '4242' }));
    render(<PidStatmApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/4242/statm', expect.anything());
  });

  it('shows a row per field, numbered, since this file is parsed by position', async () => {
    render(<PidStatmApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(8);
    expect(await rowFor('size')).toHaveTextContent('11 GiB');
    // The count the file actually holds, under the size it comes to.
    expect(await rowFor('size')).toHaveTextContent('2,857,280 pages');
  });

  /** The centrepiece: two of the seven are constants, not measurements. */
  it('says which two columns the kernel froze at zero', async () => {
    render(<PidStatmApp />);

    expect(await screen.findByTestId('constants')).toHaveTextContent(
      'not measurements of this process at all — fields 5 and 7',
    );
    expect(await rowFor('lib')).toHaveTextContent('not a measurement');
    expect(await rowFor('dt')).toHaveTextContent('not a measurement');
  });

  /** Three columns are address space and two are memory in RAM. */
  it('marks which measurement each column is', async () => {
    render(<PidStatmApp />);

    expect(await rowFor('size')).toHaveTextContent('address space');
    expect(await rowFor('resident')).toHaveTextContent('in RAM');
    expect(await rowFor('text')).toHaveTextContent('address space');
  });

  it('names the status field each count matches', async () => {
    render(<PidStatmApp />);

    expect(await rowFor('shared')).toHaveTextContent('RssFile + RssShmem');
    expect(await rowFor('data')).toHaveTextContent('VmData + VmStk');
  });

  /** The figure the file is opened for, and the one it does not carry. */
  it('works out the anonymous resident set', async () => {
    render(<PidStatmApp />);

    const notice = await screen.findByTestId('anonymous');

    expect(notice).toHaveTextContent('961 MiB of this process’s resident set is anonymous');
    expect(notice).toHaveTextContent('swap');
    expect(await screen.findByTestId('summary')).toHaveTextContent('961 MiB');
  });

  it('says the page size it assumed, since the file does not state one', async () => {
    render(<PidStatmApp />);

    await table();
    expect(screen.getByText(/this page has assumed/)).toHaveTextContent('4.0 KiB');
  });

  it('reads seven zeroes as a process with no mm rather than an empty file', async () => {
    open('901');
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-thread', pid: '901' }));
    render(<PidStatmApp />);

    expect(await screen.findByTestId('no-mm')).toHaveTextContent('Seven zeroes');
    // And the contrast with the two files that print nothing for the same process.
    expect(screen.getByTestId('no-mm')).toHaveTextContent('coredump_filter');
    expect(screen.queryByTestId('anonymous')).not.toBeInTheDocument();
  });

  it('says when almost nothing mapped is actually resident', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'sparse' }));
    render(<PidStatmApp />);

    expect(await screen.findByTestId('sparse')).toHaveTextContent(
      'weakest measure of “memory used”',
    );
  });

  it('says nothing of the sort for a process mostly resident', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'shell' }));
    render(<PidStatmApp />);

    await table();
    expect(screen.queryByTestId('sparse')).not.toBeInTheDocument();
  });

  it('reports counts that cannot all be true at once', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '10 50 20 1 0 2 0\n' }));
    render(<PidStatmApp />);

    expect(await screen.findByTestId('impossible')).toHaveTextContent(
      'more is resident than is mapped at all',
    );
  });

  it('reports a number in a column the kernel always writes zero to', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '100 50 20 10 7 30 0\n' }));
    render(<PidStatmApp />);

    expect(await screen.findByTestId('unused-set')).toHaveTextContent('Field 5 (lib)');
  });

  it('reports a truncated line and an over-long one', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '100 50 20\n' }));
    const { unmount } = render(<PidStatmApp />);
    expect(await screen.findByTestId('short')).toHaveTextContent('3 of the seven counts');
    unmount();

    vi.stubGlobal('fetch', mockServer({ body: '100 50 20 10 0 30 0 99\n' }));
    render(<PidStatmApp />);
    expect(await screen.findByTestId('extra')).toHaveTextContent('1 more number');
  });

  it('reads a file that is not numbers as one from somewhere else', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'not a statm line\n' }));
    render(<PidStatmApp />);

    expect(await screen.findByTestId('unreadable')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reads an empty file as one the backend could not read', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<PidStatmApp />);

    expect(await screen.findByTestId('empty')).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidStatmApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(statm('browser-tab'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidStatmApp />);

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
    render(<PidStatmApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/9999/statm (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'browser-tab', pid: 'self' },
  { fixture: 'shell', pid: 'self' },
  { fixture: 'shared-heavy', pid: '4242' },
  { fixture: 'sparse', pid: 'self' },
  { fixture: 'kernel-thread', pid: '901' },
])('PidStatmApp with whatever the server serves: $fixture', ({ fixture, pid }) => {
  it('renders all seven counts', async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture, pid }));
    render(<PidStatmApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(8);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
