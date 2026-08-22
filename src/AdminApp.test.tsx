import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminApp } from './AdminApp';
import { HOST_ROOT } from './api/paths';

/**
 * What the test server offers: five captured machines and the host. One choice
 * covers the whole of `/proc`, so the page is six buttons and a current one.
 */
const MACHINES = [
  { name: 'container', description: 'Inside a container — an overlay root and a user namespace' },
  { name: 'desktop', description: 'Ordinary x86_64 desktop — an Intel laptop on Ubuntu' },
  { name: 'raspberry-pi', description: 'Raspberry Pi 4 — ARM64 and an SD card root' },
  { name: 'server', description: 'Two-socket server — NUMA memory and a degraded RAID5' },
  { name: 'vm', description: 'Small virtio guest — one vCPU and zram swap' },
  { name: 'host', description: 'The real /proc on the computer this server runs on' },
];

/** Stands in for the test server's machine control endpoints. */
function mockServer(options: { rejectPut?: boolean; failList?: boolean; machines?: typeof MACHINES } = {}) {
  let current = 'desktop';

  return vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname === '/fixtures' && (init?.method ?? 'GET') === 'GET') {
      if (options.failList) return new Response('not found', { status: 404 });
      return Response.json({ machines: options.machines ?? MACHINES, current });
    }

    if (url.pathname === '/fixtures/current' && init?.method === 'PUT') {
      if (options.rejectPut) {
        return Response.json({ error: 'unknown machine: nope' }, { status: 400 });
      }
      current = (JSON.parse(String(init.body)) as { name: string }).name;
      return Response.json({ current });
    }

    return new Response('not found', { status: 404 });
  });
}

const buttons = () => within(screen.getByRole('region', { name: 'Machines' })).getAllByRole('button');
const buttonFor = (name: string) =>
  buttons().find((button) => button.querySelector('.admin__machine-name')?.textContent?.startsWith(name))!;

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminApp', () => {
  /** The heading is the path this page is served at, and the way out of it. */
  it('heads the page with its own path, leading back to the listing of /proc', async () => {
    render(<AdminApp />);

    await screen.findByRole('button', { name: /desktop/ });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/0/admin');
    expect(screen.getByRole('link', { name: 'proc' })).toHaveAttribute('href', '/');
  });

  it('reads the machines from the test server', async () => {
    render(<AdminApp />);

    await screen.findByRole('region', { name: 'Machines' });
    expect(fetch).toHaveBeenCalledWith(
      '/fixtures',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  /** Six of them: the five captures, and the host beside them. */
  it('renders one button per machine and nothing else', async () => {
    render(<AdminApp />);

    await screen.findByRole('region', { name: 'Machines' });
    expect(buttons()).toHaveLength(6);
    expect(buttons().map((button) => button.querySelector('.admin__machine-name')?.firstChild?.textContent)).toEqual([
      'container',
      'desktop',
      'raspberry-pi',
      'server',
      'vm',
      'host',
    ]);
  });

  it('says what kind of computer each one is', async () => {
    render(<AdminApp />);

    await screen.findByRole('region', { name: 'Machines' });
    expect(buttonFor('raspberry-pi')).toHaveTextContent('ARM64 and an SD card root');
    expect(buttonFor('server')).toHaveTextContent('degraded RAID5');
  });

  it('marks the one being served', async () => {
    render(<AdminApp />);

    await screen.findByRole('region', { name: 'Machines' });
    expect(buttonFor('desktop')).toHaveAttribute('aria-pressed', 'true');
    expect(within(buttonFor('desktop')).getByText('serving')).toBeInTheDocument();
    expect(buttonFor('vm')).toHaveAttribute('aria-pressed', 'false');
  });

  /** The one choice that is not a capture, so it is marked as the live one. */
  it('marks the host choice as live', async () => {
    render(<AdminApp />);

    await screen.findByRole('region', { name: 'Machines' });
    expect(within(buttonFor('host')).getByText('live')).toBeInTheDocument();
    expect(within(buttonFor('host')).getByTitle(`Reads ${HOST_ROOT} on this computer`)).toBeInTheDocument();
    expect(within(buttonFor('desktop')).queryByText('live')).not.toBeInTheDocument();
  });

  it('switches the machine when a button is pressed', async () => {
    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByRole('region', { name: 'Machines' });

    await user.click(buttonFor('raspberry-pi'));

    expect(fetch).toHaveBeenCalledWith(
      '/fixtures/current',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: 'raspberry-pi' }) }),
    );
    await waitFor(() => expect(buttonFor('raspberry-pi')).toHaveAttribute('aria-pressed', 'true'));
    expect(buttonFor('desktop')).toHaveAttribute('aria-pressed', 'false');
  });

  it('says which machine it switched to, and when', async () => {
    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByRole('region', { name: 'Machines' });

    await user.click(buttonFor('container'));

    expect(await screen.findByText(/Serving container since/)).toBeInTheDocument();
  });

  it('switches to the host like any other', async () => {
    const user = userEvent.setup();
    render(<AdminApp />);
    await screen.findByRole('region', { name: 'Machines' });

    await user.click(buttonFor('host'));

    await waitFor(() => expect(buttonFor('host')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('reports a switch the server refused, and keeps the old one marked', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', mockServer({ rejectPut: true }));
    render(<AdminApp />);
    await screen.findByRole('region', { name: 'Machines' });

    await user.click(buttonFor('vm'));

    expect(await screen.findByRole('alert')).toHaveTextContent('unknown machine: nope');
    expect(buttonFor('desktop')).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports a server with no catalogue at all', async () => {
    vi.stubGlobal('fetch', mockServer({ failList: true }));
    render(<AdminApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent('no machine catalogue');
    expect(screen.queryByRole('region', { name: 'Machines' })).not.toBeInTheDocument();
  });

  /** A server on a computer with no `/proc` offers the five and no more. */
  it('offers only what the server reported', async () => {
    vi.stubGlobal('fetch', mockServer({ machines: MACHINES.slice(0, 5) }));
    render(<AdminApp />);

    await screen.findByRole('region', { name: 'Machines' });
    expect(buttons()).toHaveLength(5);
    expect(screen.queryByText('live')).not.toBeInTheDocument();
  });
});
