import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readNetDevFixture as dev } from './test/fixtures';
import { NetDevApp } from './NetDevApp';

/**
 * Stands in for the backend serving /proc/<pid>/net/dev. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/net\/dev$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? dev(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** Opens the page at the URL that names a process, which is what it reads. */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/net/dev`);
}

const summary = () => screen.findByTestId('summary');
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;
/** The two header rows are not data, so they come off the top. */
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(2);

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('NetDevApp', () => {
  it('reads /proc/self/net/dev when no process is named', async () => {
    render(<NetDevApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/net/dev',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/net/dev');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<NetDevApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/net/dev', expect.anything());
  });

  it('shows the interfaces, one row each', async () => {
    render(<NetDevApp />);

    await summary();
    expect(stat('interfaces')).toHaveTextContent('4');
    expect(stat('busiest')).toHaveTextContent('wlp3s0');
    expect(rows()).toHaveLength(4);
    expect(rows()[0]).toHaveTextContent('lo');
    expect(rows()[2]).toHaveTextContent('wlp3s0');
    expect(rows()[2]).toHaveTextContent('48 GB');
  });

  /** The file is per namespace, so the pid picks which table is read. */
  it('reads a container process its own interfaces and none of the host’s', async () => {
    open('12282');
    render(<NetDevApp />);

    await summary();
    expect(stat('interfaces')).toHaveTextContent('2');
    expect(screen.getByRole('table')).toHaveTextContent('eth0');
    expect(screen.getByRole('table')).not.toHaveTextContent('wlp3s0');
  });

  it('says which counters are not errors and which are buckets', async () => {
    render(<NetDevApp />);

    await summary();
    const note = screen.getByText(/network namespace/).closest('p')!;

    expect(note).toHaveTextContent('not errors');
    expect(note).toHaveTextContent('rx_length_errors + rx_over_errors + rx_crc_errors');
    expect(note).toHaveTextContent('ip -s link');
  });

  it('counts multicast as a count rather than a fault', async () => {
    render(<NetDevApp />);

    await summary();
    expect(screen.getByTestId('multicast')).toHaveTextContent('wlp3s0 multicast');
    expect(screen.queryByTestId('faulty')).not.toBeInTheDocument();
  });

  it('hides the interfaces nothing has gone through when asked', async () => {
    render(<NetDevApp />);

    await summary();
    expect(rows()).toHaveLength(4);

    await userEvent.click(screen.getByRole('checkbox'));
    expect(rows()).toHaveLength(3);
    expect(screen.getByRole('table')).not.toHaveTextContent('enp0s31f6');
  });

  it('points at a link with something wrong with it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'flaky-link' }));
    render(<NetDevApp />);

    await summary();
    expect(stat('with errors')).toHaveTextContent('1');
    expect(screen.getByTestId('faulty')).toHaveTextContent('eth0 has something in the error columns');
    expect(screen.getByTestId('faulty')).toHaveTextContent('Read the rate rather than the count');
  });

  it('explains collisions as the half-duplex link they imply', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'flaky-link' }));
    render(<NetDevApp />);

    expect(await screen.findByTestId('collisions')).toHaveTextContent('only a half-duplex link');
    expect(screen.getByTestId('collisions')).toHaveTextContent('duplex mismatch');
  });

  /**
   * Six characters is low enough that most names reach it, so this is said once
   * under the table rather than as a badge on nearly every row.
   */
  it('says once that the names ran into the colon', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'long-names' }));
    render(<NetDevApp />);

    await summary();
    const glued = await screen.findByTestId('glued');

    expect(glued).toHaveTextContent('4 of these names are 6 characters or longer');
    expect(glued).toHaveTextContent('br-1a2b3c4d5e6f: is the longest of them');
    expect(glued).toHaveTextContent('nothing is lost');
    // The counters still read correctly behind a name that ran over the column.
    expect(rows().find((row) => row.textContent?.includes('br-1a2b3c4d5e6f'))).toHaveTextContent(
      '1.8 MB',
    );
  });

  it('says the compressed column is not an error', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'dialup' }));
    render(<NetDevApp />);

    expect(await screen.findByTestId('compressed')).toHaveTextContent('not an error');
    expect(screen.getByTestId('compressed')).toHaveTextContent('ppp0');
  });

  it('says so when there is not even a loopback', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<NetDevApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('No interfaces in this table');
  });

  /** Which processes exist is the backend's answer to give, not this page's. */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<NetDevApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Failed to read /proc/${pid}/net/dev (HTTP 404 Not Found)`,
    );
  });

  it('offers the raw view like every other page', async () => {
    render(<NetDevApp />);

    await summary();
    await userEvent.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByTestId('raw-file')).toHaveTextContent('Inter-');
  });
});
