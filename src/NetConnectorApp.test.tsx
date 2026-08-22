import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readNetConnectorFixture as connector } from './test/fixtures';
import { NetConnectorApp } from './NetConnectorApp';

/**
 * Stands in for the backend serving /proc/<pid>/net/connector. The file exists
 * only in the initial network namespace, so `only` is how a fixture says which
 * of its processes are in one — the rest 404, as the mock server does.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/net\/connector$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? connector(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** Opens the page at the URL that names a process, which is what it reads. */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/net/connector`);
}

const summary = () => screen.findByTestId('summary');
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('NetConnectorApp', () => {
  it('reads /proc/self/net/connector when no process is named', async () => {
    render(<NetConnectorApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/net/connector',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/net/connector');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<NetConnectorApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/net/connector', expect.anything());
  });

  it('shows the one registration nearly every machine has', async () => {
    render(<NetConnectorApp />);

    await summary();
    expect(stat('registered')).toHaveTextContent('1');
    expect(stat('process events')).toHaveTextContent('yes');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('cn_proc');
    expect(rows()[0]).toHaveTextContent('1:1');
    expect(rows()[0]).toHaveTextContent('CN_IDX_PROC / CN_VAL_PROC');
    expect(rows()[0]).toHaveTextContent('fork, exec, exit');
  });

  /**
   * The sharpest thing this file says, and it says it by not being there:
   * `cn_init` creates it under `init_net.proc_net` only.
   */
  it('reports the 404 for a process in a network namespace of its own', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self', '1'] }));
    open('12282');
    render(<NetConnectorApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/12282/net/connector (HTTP 404 Not Found)',
    );
  });

  it('says the file belongs to the initial network namespace alone', async () => {
    render(<NetConnectorApp />);

    await summary();
    const note = screen.getByText(/kernel-side receivers/).closest('p')!;

    expect(note).toHaveTextContent('init_net.proc_net');
    expect(note).toHaveTextContent('404, not an empty table');
    expect(note).toHaveTextContent('NETLINK_CONNECTOR');
  });

  it('tells an empty table from a missing file', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-events' }));
    render(<NetConnectorApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('Nothing is registered on the bus');
    expect(screen.getByTestId('empty')).toHaveTextContent('CONFIG_PROC_EVENTS');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reads the 1-wire bus beside the process events', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'one-wire' }));
    render(<NetConnectorApp />);

    await summary();
    expect(stat('registered')).toHaveTextContent('2');
    expect(rows()[1]).toHaveTextContent('w1');
    expect(rows()[1]).toHaveTextContent('3:1');
  });

  it('dates the kernel by a registration whose driver Linux deleted', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'storage-server' }));
    render(<NetConnectorApp />);

    await summary();
    expect(stat('driver gone')).toHaveTextContent('1');
    expect(screen.getByTestId('removed')).toHaveTextContent(
      'deleted the driver behind this address in 3.2',
    );
    expect(screen.getByTestId('removed')).toHaveTextContent('ever handed out twice');
  });

  it('points at an index the ABI never allocated', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'out-of-tree' }));
    render(<NetConnectorApp />);

    await summary();
    expect(stat('out of tree')).toHaveTextContent('1');
    expect(screen.getByTestId('out-of-tree')).toHaveTextContent('holds index 42, past the 11');
    expect(within(screen.getByRole('table')).getByText('past the column')).toBeInTheDocument();
  });

  it('says so when the process-events connector is not registered', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'Name            ID\nw1              3:1\n' }));
    render(<NetConnectorApp />);

    await summary();
    expect(stat('process events')).toHaveTextContent('no');
    expect(screen.getByTestId('no-proc-events')).toHaveTextContent('CONFIG_PROC_EVENTS');
  });

  /** Which processes exist is the backend's answer to give, not this page's. */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<NetConnectorApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Failed to read /proc/${pid}/net/connector (HTTP 404 Not Found)`,
    );
  });

  it('offers the raw view like every other page', async () => {
    render(<NetConnectorApp />);

    await summary();
    await userEvent.click(screen.getByRole('button', { name: 'Raw' }));

    // Text content is whitespace-normalised, so the column padding is not
    // what to assert on here — the raw view is byte-for-byte in the DOM.
    expect(screen.getByTestId('raw-file')).toHaveTextContent('Name ID cn_proc 1:1');
    expect(screen.getByTestId('raw-file').textContent).toBe('Name            ID\ncn_proc         1:1\n');
  });
});
