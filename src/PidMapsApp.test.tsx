import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidMapsFixture as maps } from './test/fixtures';
import { PidMapsApp } from './PidMapsApp';

/**
 * Stands in for the backend serving /proc/<pid>/maps. Mode 0444, but opening it
 * takes PTRACE_MODE_READ — so another user's is the 403, and a process that has
 * gone is the 404.
 */
function mockServer(
  options: { fixture?: string; pid?: string; failWith?: number; body?: string } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/maps$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', {
        status: options.failWith,
        statusText: options.failWith === 403 ? 'Forbidden' : 'Not Found',
      });
    }

    return new Response(options.body ?? maps(options.fixture ?? 'shell', options.pid ?? match[1]!), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/maps`);
}

const table = () => screen.findByRole('table', { name: 'Memory mappings' });
const rows = async () => within(await table()).getAllByRole('row').slice(1);

/** The row for one mapping, matched on the text anywhere in it. */
const rowWith = async (text: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.textContent?.includes(text))!;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidMapsApp', () => {
  it('reads /proc/self/maps when no process is named', async () => {
    render(<PidMapsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/maps',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/maps');
  });

  it('reads the process its own URL names', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'deleted-library', pid: '4242' }));
    render(<PidMapsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/4242/maps', expect.anything());
  });

  it('shows a row per mapping, with the range and the size it spans', async () => {
    render(<PidMapsApp />);

    expect(await rows()).toHaveLength(13);
    const first = (await rows())[0]!;
    expect(first).toHaveTextContent('55a4c1e00000');
    expect(first).toHaveTextContent('8.0 KiB');
    expect(first).toHaveTextContent('dash');
  });

  /** The centrepiece: the fourth character is the type, not a permission. */
  it('reads the fourth mode character as private or shared', async () => {
    render(<PidMapsApp />);

    expect(await rowWith('[heap]')).toHaveTextContent('private');
    expect(within(await table()).getAllByText('private').length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: /Mode/ })).toHaveAttribute(
      'title',
      expect.stringContaining('which is not a permission'),
    );
  });

  it('says the shared mapping is shared', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'odd-paths' }));
    render(<PidMapsApp />);

    expect(await rowWith('/dev/shm/postgres')).toHaveTextContent('shared');
  });

  /** Nothing in this file is memory — that is the other page. */
  it('says the total is address space rather than memory', async () => {
    render(<PidMapsApp />);

    const notice = await screen.findByTestId('not-memory');
    expect(notice).toHaveTextContent('None of that is memory');
    expect(notice).toHaveTextContent('smaps');
    expect(notice).toHaveTextContent('statm');
  });

  it('counts a reservation as address space costing nothing', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'jit' }));
    render(<PidMapsApp />);

    expect(await screen.findByTestId('not-memory')).toHaveTextContent('readable by nobody');
    expect(await rowWith('---p')).toHaveTextContent('reservation');
  });

  /** The mapping outlives the file, which is why a patched library stays in use. */
  it('says when a mapped file has been deleted since it was mapped', async () => {
    open('4242');
    vi.stubGlobal('fetch', mockServer({ fixture: 'deleted-library', pid: '4242' }));
    render(<PidMapsApp />);

    const notice = await screen.findByTestId('deleted');
    expect(notice).toHaveTextContent('a patched library still in use');
    expect(notice).toHaveTextContent('libssl.so.3');
    expect(within(await rowWith('libssl')).getAllByText('deleted').length).toBeGreaterThan(0);
  });

  it('says nothing of the sort where every mapped file is still there', async () => {
    render(<PidMapsApp />);

    await table();
    expect(screen.queryByTestId('deleted')).not.toBeInTheDocument();
  });

  it('flags a mapping that is writable and executable at once', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'jit' }));
    render(<PidMapsApp />);

    const notice = await screen.findByTestId('wx');
    expect(notice).toHaveTextContent('what an exploit needs too');
    expect(notice).toHaveTextContent('[anon:jit-code]');
    expect(await rowWith('jit-code')).toHaveClass('maps__row--wx');
  });

  it('decodes an octal escape in a filename and says why it is there', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'odd-paths' }));
    render(<PidMapsApp />);

    expect(await screen.findByTestId('escaped')).toHaveTextContent('\\012 is a newline');
  });

  it('groups the address space by kind', async () => {
    render(<PidMapsApp />);

    const kinds = await screen.findByTestId('kinds');
    expect(kinds).toHaveTextContent('file');
    expect(kinds).toHaveTextContent('heap');
    expect(kinds).toHaveTextContent('stack');
  });

  it('reads an empty file as a process with no address space', async () => {
    open('901');
    vi.stubGlobal('fetch', mockServer({ fixture: 'kernel-thread', pid: '901' }));
    render(<PidMapsApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('kernel thread');
    // And says how the neighbouring file answers the same question differently.
    expect(screen.getByTestId('empty')).toHaveTextContent('seven zeroes');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a line that is not a mapping', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '2000-4000 rw-p 00000000 00:00 0\nnope\n' }));
    render(<PidMapsApp />);

    expect(await screen.findByTestId('malformed')).toBeInTheDocument();
  });

  it('reports mappings that cover the same address', async () => {
    vi.stubGlobal('fetch', mockServer({
      body: '2000-4000 rw-p 00000000 00:00 0\n3000-5000 rw-p 00000000 00:00 0\n',
    }));
    render(<PidMapsApp />);

    expect(await screen.findByTestId('overlaps')).toHaveTextContent(
      'One address space cannot hold that',
    );
    expect(await screen.findByTestId('unordered')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidMapsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(maps('shell'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidMapsApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /** PTRACE_MODE_READ, despite the 0444 the mode bits show. */
  it('reports a refused read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 403 }));
    render(<PidMapsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/maps (HTTP 403 Forbidden)',
    );
  });

  it('reports a process that is not there', async () => {
    open('9999');
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<PidMapsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/9999/maps (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'shell', pid: 'self', mappings: 13 },
  { fixture: 'deleted-library', pid: '4242', mappings: 6 },
  { fixture: 'jit', pid: 'self', mappings: 7 },
  { fixture: 'odd-paths', pid: 'self', mappings: 6 },
])('PidMapsApp with whatever the server serves: $fixture', ({ fixture, pid, mappings }) => {
  it(`renders ${mappings} mappings`, async () => {
    open(pid);
    vi.stubGlobal('fetch', mockServer({ fixture, pid }));
    render(<PidMapsApp />);

    expect(await rows()).toHaveLength(mappings);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
