import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readDevicesFixture as devices } from './test/fixtures';
import { DevicesApp } from './DevicesApp';

/** Stands in for the backend serving /proc/devices. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/devices') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? devices(options.fixture ?? 'desktop-x86'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** The page has a table per section, so they are queried by name. */
const charTable = () => screen.findByRole('table', { name: 'Character devices by major number' });
const blockTable = () => screen.findByRole('table', { name: 'Block devices by major number' });

/** Opens the page at a URL, or at the base, where it names no file. */
function open(url = '/') {
  window.history.replaceState({}, '', url);
}

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('DevicesApp', () => {
  it('requests /proc/devices from its own path', async () => {
    open('/devices');
    render(<DevicesApp />);

    await charTable();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/devices',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  /**
   * The page reads the file its own URL names, so that where a page is served
   * and what it reads are one fact. Every page works this way; this is the one
   * that proves it end to end, rather than each of the forty repeating it.
   */
  it('reads the file its URL names rather than a path of its own', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(devices('desktop-x86'), { status: 200 })),
    );
    open('/self/mountinfo');
    render(<DevicesApp />);

    await charTable();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/self/mountinfo', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/mountinfo');
  });

  /** The dev and preview servers serve a page at its own file name. */
  it('reads the same file at the URL with the extension on', async () => {
    open('/devices.html');
    render(<DevicesApp />);

    await charTable();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/devices', expect.anything());
  });

  /**
   * `/` is where the servers land a request that names no page, and they send
   * it to the first document rather than 404ing. Nothing in the URL says what
   * to read there, so the page reads what it has always read.
   */
  it('reads its declared path where the URL names no file', async () => {
    open('/');
    render(<DevicesApp />);

    await charTable();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/devices', expect.anything());
  });

  it('summarizes the file', async () => {
    render(<DevicesApp />);

    expect(await screen.findByText('registered names')).toBeInTheDocument();
    expect(screen.getByText('registered names').previousSibling).toHaveTextContent('61');
    expect(screen.getByText('character majors').previousSibling).toHaveTextContent('40');
    expect(screen.getByText('block majors').previousSibling).toHaveTextContent('16');
    expect(screen.getByText('shared majors').previousSibling).toHaveTextContent('2');
  });

  it('renders a row per major, not per line', async () => {
    render(<DevicesApp />);

    // 45 character lines collapse to 40 majors, since 4 and 5 are shared.
    expect(within(await charTable()).getAllByRole('row')).toHaveLength(40 + 1);
    expect(within(await blockTable()).getAllByRole('row')).toHaveLength(16 + 1);
  });

  it('groups the drivers that share a major', async () => {
    render(<DevicesApp />);

    const row = (await within(await charTable()).findByText('4')).closest('tr')!;

    expect(within(row).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '/dev/vc/0',
      'tty',
      'ttyS',
    ]);
  });

  it('keeps the two number spaces apart', async () => {
    render(<DevicesApp />);

    const char7 = (await within(await charTable()).findByText('7')).closest('tr')!;
    const block7 = within(await blockTable()).getByText('7').closest('tr')!;

    expect(within(char7).getByText('vcs')).toBeInTheDocument();
    expect(within(block7).getByText('loop')).toBeInTheDocument();
  });

  it('points out a driver holding several majors', async () => {
    render(<DevicesApp />);

    await charTable();
    // `sd` also appears in the block table, so anchor on the count instead.
    expect(screen.getByText('7 majors').parentElement).toHaveTextContent('sd');
    // And each of its rows marks it as holding several.
    expect(within(await blockTable()).getAllByTitle('sd holds several majors')).toHaveLength(7);
  });

  it('marks the local and experimental ranges', async () => {
    render(<DevicesApp />);

    const row = (await within(await charTable()).findByText('240')).closest('tr')!;
    const ordinary = within(await charTable()).getByText('180').closest('tr')!;

    expect(within(row).getByText('local')).toBeInTheDocument();
    expect(within(ordinary).queryByText('local')).not.toBeInTheDocument();
  });

  it('hides the local ranges on request', async () => {
    const user = userEvent.setup();
    render(<DevicesApp />);

    await charTable();
    expect(within(await charTable()).getByText('254')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /hide the local and experimental/i }));

    expect(within(await charTable()).queryByText('254')).not.toBeInTheDocument();
    expect(within(await charTable()).getByText('180')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<DevicesApp />);
    await charTable();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(devices('desktop-x86'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<DevicesApp />);

    await charTable();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no devices', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<DevicesApp />);

    expect(await screen.findByText(/no devices found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<DevicesApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/devices (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from a container's handful of majors to a 16-major storage server.
describe.each([
  { fixture: 'desktop-x86', character: 40, block: 16, expected: 'nvme' },
  { fixture: 'container', character: 5, block: 5, expected: 'device-mapper' },
  { fixture: 'raspberry-pi', character: 31, block: 6, expected: 'mmc' },
  { fixture: 'server-multipath', character: 35, block: 23, expected: 'megaraid_sas_ioctl' },
  { fixture: 'legacy-ide', character: 14, block: 9, expected: 'ide0' },
])(
  'DevicesApp with whatever the server serves: $fixture',
  ({ fixture, character, block, expected }) => {
    it(`renders ${character} character and ${block} block majors`, async () => {
      vi.stubGlobal('fetch', mockServer({ fixture }));
      render(<DevicesApp />);

      expect(within(await charTable()).getAllByRole('row')).toHaveLength(character + 1);
      expect(within(await blockTable()).getAllByRole('row')).toHaveLength(block + 1);
      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  },
);
