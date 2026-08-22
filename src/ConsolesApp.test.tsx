import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readConsolesFixture as consoles } from './test/fixtures';
import { ConsolesApp } from './ConsolesApp';

/** Stands in for the backend serving /proc/consoles. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/consoles') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? consoles(options.fixture ?? 'serial-server'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Registered consoles' });

/**
 * A summary tile's value, scoped to the summary — `enabled` also appears as a
 * flag name in the table.
 */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a console, matched on the name's own text node. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.childNodes[0]?.textContent === name)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConsolesApp', () => {
  it('requests /proc/consoles from its own path', async () => {
    render(<ConsolesApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/consoles',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per console', async () => {
    render(<ConsolesApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(2 + 1);
    expect(await rowFor('ttyS0')).toBeInTheDocument();
  });

  it('summarizes the machine', async () => {
    render(<ConsolesApp />);

    expect(await screen.findByText('consoles')).toBeInTheDocument();
    expect(stat('consoles')).toHaveTextContent('2');
    expect(stat('enabled')).toHaveTextContent('2');
  });

  /**
   * Several consoles can be enabled; only the one flagged preferred is what
   * /dev/console refers to, which is the question this page exists to answer.
   */
  it('names the console /dev/console refers to', async () => {
    render(<ConsolesApp />);

    await table();
    expect(stat('/dev/console')).toHaveTextContent('ttyS0');

    const serial = await rowFor('ttyS0');
    expect(within(serial).getByTitle('This is what /dev/console refers to')).toBeInTheDocument();

    // The VT is enabled too, but it is not the preferred one.
    const vt = await rowFor('tty0');
    expect(within(vt).queryByText('/dev/console')).not.toBeInTheDocument();
  });

  it('shows the device number', async () => {
    render(<ConsolesApp />);

    expect(await rowFor('ttyS0')).toHaveTextContent('4:64');
    expect(await rowFor('tty0')).toHaveTextContent('4:1');
  });

  // Most consoles only write, so the missing operations matter as much as the
  // present ones.
  it('shows which of the three operations a driver implements', async () => {
    render(<ConsolesApp />);

    const vt = await rowFor('tty0');
    expect(within(vt).getByTitle('implements write')).toHaveTextContent('W');
    expect(within(vt).getByTitle('implements unblank')).toHaveTextContent('U');
    expect(within(vt).getByTitle('does not implement read')).toHaveTextContent('—');
  });

  it('expands the flag letters into names', async () => {
    render(<ConsolesApp />);

    const serial = await rowFor('ttyS0');
    expect(within(serial).getByText('enabled')).toBeInTheDocument();
    expect(within(serial).getByText('preferred')).toBeInTheDocument();
    expect(within(serial).getByTitle(/^C — this is the console/)).toBeInTheDocument();
  });

  it('says nothing about boot consoles when none is registered', async () => {
    render(<ConsolesApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns about an early boot console that is still registered', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'boot-console' }));
    render(<ConsolesApp />);

    await table();
    const warning = screen.getByRole('status');

    expect(warning).toHaveTextContent('uart8250 is an early boot console');
    expect(warning).toHaveTextContent('hands over to a real driver');
  });

  // A boot console and netconsole both lack a device node; that is normal.
  it('shows a dash for a console with no device number', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'boot-console' }));
    render(<ConsolesApp />);

    const boot = await rowFor('uart8250');
    expect(within(boot).getByTitle('This console has no device node')).toHaveTextContent('—');
  });

  it('reads netconsole as an ordinary console with no device', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'netconsole' }));
    render(<ConsolesApp />);

    const netcon = await rowFor('netcon0');
    expect(within(netcon).getByText('any-context')).toBeInTheDocument();
    // No device, but not a boot console either, so no warning.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('marks a console that is registered but not enabled', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'braille-and-disabled' }));
    render(<ConsolesApp />);

    const off = await rowFor('ttyS1');
    expect(within(off).getByText('not enabled')).toBeInTheDocument();
    expect(off).toHaveClass('cons__row--disabled');
    expect(stat('enabled')).toHaveTextContent('2');
    expect(stat('consoles')).toHaveTextContent('3');
  });

  it('shows a console that implements read', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'braille-and-disabled' }));
    render(<ConsolesApp />);

    expect(within(await rowFor('ttyS1')).getByTitle('implements read')).toHaveTextContent('R');
    expect(within(await rowFor('brltty')).getByText('braille')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<ConsolesApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(consoles('serial-server'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<ConsolesApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no consoles', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<ConsolesApp />);

    expect(await screen.findByText(/no consoles found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<ConsolesApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/consoles (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from one VT to a braille display beside a disabled line.
describe.each([
  { fixture: 'desktop-vt', rows: 1, preferred: 'tty0' },
  { fixture: 'serial-server', rows: 2, preferred: 'ttyS0' },
  { fixture: 'boot-console', rows: 2, preferred: 'ttyS0' },
  { fixture: 'netconsole', rows: 3, preferred: 'tty0' },
  { fixture: 'braille-and-disabled', rows: 3, preferred: 'tty0' },
])('ConsolesApp with whatever the server serves: $fixture', ({ fixture, rows, preferred }) => {
  it(`renders ${rows} consoles with ${preferred} preferred`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<ConsolesApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(rows + 1);
    expect(stat('/dev/console')).toHaveTextContent(preferred);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
