import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readNetArpFixture as arp } from './test/fixtures';
import { NetArpApp } from './NetArpApp';

/**
 * Stands in for the backend serving /proc/<pid>/net/arp. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/net\/arp$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? arp(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** Opens the page at the URL that names a process, which is what it reads. */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/net/arp`);
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

describe('NetArpApp', () => {
  it('reads /proc/self/net/arp when no process is named', async () => {
    render(<NetArpApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/net/arp',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/net/arp');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<NetArpApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/net/arp', expect.anything());
  });

  it('shows the neighbours, one row each', async () => {
    render(<NetArpApp />);

    await summary();
    expect(stat('neighbours')).toHaveTextContent('5');
    expect(stat('resolved')).toHaveTextContent('4');
    expect(stat('unresolved')).toHaveTextContent('1');
    expect(stat('interfaces')).toHaveTextContent('2');
    expect(rows()).toHaveLength(5);
    expect(rows()[0]).toHaveTextContent('192.168.1.1');
    expect(rows()[0]).toHaveTextContent('3c:22:fb:1a:2b:3c');
    expect(rows()[0]).toHaveTextContent('Ethernet');
    expect(rows()[0]).toHaveTextContent('wlan0');
  });

  it('names the bits behind the flags column', async () => {
    render(<NetArpApp />);

    await summary();
    const nas = rows().find((row) => row.textContent?.includes('192.168.1.31'))!;

    expect(nas).toHaveTextContent('0x6');
    expect(within(nas).getByText('com')).toHaveAttribute('title', expect.stringContaining('complete'));
    expect(within(nas).getByText('perm')).toHaveAttribute('title', expect.stringContaining('by hand'));
  });

  /** The whole reason the page reads a pid: the file belongs to a namespace. */
  it('reads a container process a table with none of the host in it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container-host' }));
    open('12282');
    render(<NetArpApp />);

    await summary();
    expect(stat('neighbours')).toHaveTextContent('2');
    expect(screen.getByRole('table')).not.toHaveTextContent('192.168.1.1');
    expect(screen.getByRole('table')).toHaveTextContent('172.17.0.1');
  });

  it('says the file belongs to a network namespace rather than to the process', async () => {
    render(<NetArpApp />);

    await summary();
    const note = screen.getByText(/network namespace/).closest('p')!;

    expect(note).toHaveTextContent('/proc/net is a link to self/net');
    expect(note).toHaveTextContent('IPv4 only');
    expect(note).toHaveTextContent('NOARP');
  });

  it('hides the addresses nothing answered for when asked', async () => {
    render(<NetArpApp />);

    await summary();
    expect(rows()).toHaveLength(5);

    await userEvent.click(screen.getByRole('checkbox'));
    expect(rows()).toHaveLength(4);
    expect(screen.getByRole('table')).not.toHaveTextContent('192.168.1.77');
  });

  it('explains what a published entry is', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'proxy-arp' }));
    render(<NetArpApp />);

    await summary();
    expect(stat('published')).toHaveTextContent('4');
    expect(screen.getByTestId('proxy')).toHaveTextContent('answers ARP for an address that is not');
    // Nothing is missing from a proxy entry, so the filter has nothing to offer.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('points at the flags a neighbour state cannot produce', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'proxy-arp' }));
    render(<NetArpApp />);

    expect(await screen.findByTestId('unexpected')).toHaveTextContent('ATF_DONTPUB');
  });

  it('shows the one hardware address several neighbours answer on', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'busy-server' }));
    render(<NetArpApp />);

    await summary();
    expect(screen.getByTestId('shared')).toHaveTextContent(
      '00:1c:73:aa:bb:01 answers for 3 addresses',
    );
    expect(screen.getByTestId('shared')).toHaveTextContent('bond0, bond0.40, bond0.50');
  });

  /** The column is a literal `*` on every kernel in service, so it is dropped. */
  it('shows the Mask column only where it holds a mask', async () => {
    render(<NetArpApp />);

    await summary();
    expect(screen.queryByRole('columnheader', { name: 'Mask' })).not.toBeInTheDocument();

    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-netmask' }));
    render(<NetArpApp />);

    await screen.findAllByTestId('summary');
    expect(screen.getAllByRole('columnheader', { name: 'Mask' })).toHaveLength(1);
    expect(screen.getByTestId('masked')).toHaveTextContent('older than anything in service');
  });

  it('reads a link that is not Ethernet', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-netmask' }));
    render(<NetArpApp />);

    await summary();
    expect(screen.getByRole('table')).toHaveTextContent('InfiniBand');
  });

  it('says so when the table is empty', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<NetArpApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('No neighbours in this table');
  });

  /** Which processes exist is the backend's answer to give, not this page's. */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<NetArpApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Failed to read /proc/${pid}/net/arp (HTTP 404 Not Found)`,
    );
  });

  it('offers the raw view like every other page', async () => {
    render(<NetArpApp />);

    await summary();
    await userEvent.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByTestId('raw-file')).toHaveTextContent('IP address');
  });
});
