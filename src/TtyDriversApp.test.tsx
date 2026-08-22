import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readTtyDriversFixture as drivers } from './test/fixtures';
import { TtyDriversApp } from './TtyDriversApp';

/** Stands in for the backend serving /proc/tty/drivers. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/tty/drivers') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? drivers(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Registered tty drivers' });

/** The rows for the four nodes the kernel prints ahead of the drivers. */
const pseudoRows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .filter((row) => row.classList.contains('tty__row--pseudo'));

/** The rows for the drivers proper, which is what the file is a list of. */
const driverRows = async (): Promise<HTMLElement[]> => {
  const rows = within(await table()).getAllByRole('row');
  // The header is a row too, and is neither.
  return rows.filter(
    (row) => row.classList.contains('tty__row') && !row.classList.contains('tty__row--pseudo'),
  );
};

/**
 * The row for a driver, matched on the name's own text node — `/dev/tty` is
 * both the first pseudo-device's name and the VT driver's device, so a plain
 * text match would find either.
 */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.childNodes[0]?.textContent === name)!;
};

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/tty/drivers');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('TtyDriversApp', () => {
  it('requests /proc/tty/drivers from its own path', async () => {
    render(<TtyDriversApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/tty/drivers',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per line, the four pseudo-devices included', async () => {
    render(<TtyDriversApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(12 + 1);
    expect(await rowFor('usbserial')).toBeInTheDocument();
  });

  /**
   * The file's first four lines are devices rather than drivers, so a count of
   * its lines is four too many. The table keeps the two apart.
   */
  it('keeps the drivers apart from the pseudo-devices', async () => {
    render(<TtyDriversApp />);

    expect(await driverRows()).toHaveLength(8);
    expect(await pseudoRows()).toHaveLength(4);
  });

  it('marks each of the four as not a driver', async () => {
    render(<TtyDriversApp />);

    const ptmx = await rowFor('/dev/ptmx');
    expect(within(ptmx).getByText('not a driver')).toBeInTheDocument();
    expect(ptmx).toHaveClass('tty__row--pseudo');

    // The driver below is one, whatever its device is called.
    const usb = await rowFor('usbserial');
    expect(within(usb).queryByText('not a driver')).not.toBeInTheDocument();
    expect(usb).not.toHaveClass('tty__row--pseudo');
  });

  it('shows the device, major and minors of a driver', async () => {
    render(<TtyDriversApp />);

    const serial = await rowFor('serial');
    expect(serial).toHaveTextContent('/dev/ttyS');
    expect(serial).toHaveTextContent('64-95');
    expect(within(serial).getByTitle('32 device numbers reserved')).toBeInTheDocument();
  });

  it('spells a single minor as the one number the kernel prints', async () => {
    render(<TtyDriversApp />);

    const printk = await rowFor('ttyprintk');
    expect(within(printk).getByTitle('one device number')).toHaveTextContent('3');
  });

  /** A million reserved numbers is not a million terminals, so the count is shown. */
  it('shows how many numbers a range reserves', async () => {
    render(<TtyDriversApp />);

    expect(await rowFor('pty_slave')).toHaveTextContent('(1,048,576)');
    expect(await rowFor('serial')).toHaveTextContent('(32)');
  });

  it('explains what a type means', async () => {
    render(<TtyDriversApp />);

    const slave = await rowFor('pty_slave');
    expect(within(slave).getByText('pty:slave')).toHaveAttribute(
      'title',
      expect.stringContaining('slave half'),
    );

    const tty = await rowFor('/dev/tty');
    expect(within(tty).getByText('system:/dev/tty')).toHaveAttribute(
      'title',
      expect.stringContaining('controlling terminal'),
    );
  });

  it('marks the driver the kernel never named', async () => {
    render(<TtyDriversApp />);

    const vt = await rowFor('unknown');
    expect(within(vt).getByText('no name')).toBeInTheDocument();
    expect(within(vt).getByTitle(/without a driver_name/)).toBeInTheDocument();
  });

  it('says nothing about callout devices on a kernel that has none', async () => {
    render(<TtyDriversApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns about a callout device an old kernel still registers', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-callout' }));
    render(<TtyDriversApp />);

    await table();
    const warning = screen.getByRole('status');

    expect(warning).toHaveTextContent('/dev/cua is a callout device');
    expect(warning).toHaveTextContent('dropped these during 2.6');
  });

  it('renders a machine with no console driver at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'minimal' }));
    render(<TtyDriversApp />);

    expect(await driverRows()).toHaveLength(3);
    expect(screen.queryByText('no name')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<TtyDriversApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(drivers('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<TtyDriversApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no drivers', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<TtyDriversApp />);

    expect(await screen.findByText(/no tty drivers found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<TtyDriversApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/tty/drivers (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from a laptop to a kernel with no virtual terminals.
describe.each([
  { fixture: 'desktop', rows: 12, drivers: 8 },
  { fixture: 'vm-guest', rows: 10, drivers: 6 },
  { fixture: 'raspberry-pi', rows: 10, drivers: 6 },
  { fixture: 'minimal', rows: 7, drivers: 3 },
  { fixture: 'legacy-callout', rows: 9, drivers: 5 },
])('TtyDriversApp with whatever the server serves: $fixture', ({ fixture, rows, drivers: count }) => {
  it(`renders ${rows} rows, ${count} of them drivers`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<TtyDriversApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(rows + 1);
    expect(await driverRows()).toHaveLength(count);
    // The four are printed whatever else the kernel has.
    expect(await pseudoRows()).toHaveLength(4);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
