import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readCmdlineFixture as cmdline } from './test/fixtures';
import { CmdlineApp } from './CmdlineApp';

/** Stands in for the backend serving /proc/cmdline. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/cmdline') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? cmdline(options.fixture ?? 'ubuntu-desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** The page has a parameter table and a "booted with" table, so name them. */
const table = () => screen.findByRole('table', { name: 'Kernel parameters' });
const bootedWith = () => screen.getByRole('table', { name: 'Notable boot parameters' });

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CmdlineApp', () => {
  it('requests /proc/cmdline from its own path', async () => {
    render(<CmdlineApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/cmdline',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per parameter', async () => {
    render(<CmdlineApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(7 + 1); // + header
  });

  /**
   * No row of counts: every one of them counted something the page has in
   * view — the table, the module chips, the card at the foot — so the page
   * opens on what the machine booted with instead.
   */
  it('counts nothing above the page', async () => {
    const { container } = render(<CmdlineApp />);

    await table();
    expect(container.querySelector('.summary')).toBeNull();
    for (const label of ['parameters', 'flags', 'modules configured', 'arguments for init']) {
      expect(screen.queryByText(label), label).not.toBeInTheDocument();
    }
    // What the row sat above is untouched.
    expect(bootedWith()).toBeInTheDocument();
  });

  it('calls out what the machine booted', async () => {
    render(<CmdlineApp />);

    await table();
    const field = (label: string) =>
      within(bootedWith()).getByRole('rowheader', { name: label }).closest('tr')!;

    expect(field('kernel')).toHaveTextContent('/boot/vmlinuz-6.8.0-45-generic');
    expect(field('root device')).toHaveTextContent('UUID=1b9f3a7c-5d2e-4f81-9a6b-0c3d8e7f2a41');
    expect(field('Mounted')).toHaveTextContent('read-only (ro)');
  });

  it('shows a bare flag as a flag rather than an empty value', async () => {
    render(<CmdlineApp />);

    const row = within(await table()).getByText('quiet').closest('tr')!;
    expect(within(row).getByText('flag')).toBeInTheDocument();
  });

  it('splits a dotted key into its module and name', async () => {
    render(<CmdlineApp />);

    const row = within(await table()).getByText('enable_psr').closest('tr')!;
    expect(within(row).getByText('i915.')).toBeInTheDocument();
    expect(row).toHaveTextContent('0');
  });

  it('hides the module parameters on request', async () => {
    const user = userEvent.setup();
    render(<CmdlineApp />);

    await table();
    await user.click(screen.getByRole('checkbox', { name: /hide module parameters \(2 of 7\)/i }));

    expect(within(await table()).getAllByRole('row')).toHaveLength(5 + 1);
    expect(within(await table()).queryByText('enable_psr')).not.toBeInTheDocument();
  });

  it('marks a parameter that a later one overrides', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'server-serial' }));
    render(<CmdlineApp />);

    const rows = within(await table()).getAllByRole('row');
    const consoles = rows.filter((row) => row.textContent?.includes('console'));

    expect(consoles).toHaveLength(2);
    expect(within(consoles[0]!).getByText('overridden')).toBeInTheDocument();
    expect(within(consoles[1]!).queryByText('overridden')).not.toBeInTheDocument();
    // The one the kernel acts on is the one summarized.
    expect(within(bootedWith()).getByText('ttyS0,115200n8')).toBeInTheDocument();
  });

  it('warns about parameters that relax a protection', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'rescue-shell' }));
    render(<CmdlineApp />);

    await table();
    const warning = screen.getByRole('status');

    expect(warning).toHaveTextContent('5 parameters relax a kernel protection');
    expect(warning).toHaveTextContent('nokaslr (kernel address randomisation disabled)');
    expect(warning).toHaveTextContent('init is a shell');
  });

  it('says nothing about protections on an ordinary boot', async () => {
    render(<CmdlineApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('separates the arguments handed to init', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'custom-init' }));
    render(<CmdlineApp />);

    await table();
    expect(screen.getByRole('heading', { name: 'Passed to init' })).toBeInTheDocument();
    expect(screen.getByText('--unit=rescue.target')).toBeInTheDocument();
    // And they are not listed among the kernel parameters.
    expect(within(await table()).queryByText('--system')).not.toBeInTheDocument();
  });

  it('keeps a quoted value with spaces in one piece', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'custom-init' }));
    render(<CmdlineApp />);

    const row = within(await table()).getByText('dyndbg').closest('tr')!;
    expect(row).toHaveTextContent('module nvme +p');
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<CmdlineApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(cmdline('ubuntu-desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<CmdlineApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no parameters', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '\n' }));
    render(<CmdlineApp />);

    expect(await screen.findByText(/no kernel parameters found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<CmdlineApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/cmdline (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including a Pi that has no BOOT_IMAGE at all.
describe.each([
  { fixture: 'ubuntu-desktop', rows: 7, expected: 'splash' },
  { fixture: 'server-serial', rows: 11, expected: 'crashkernel' },
  { fixture: 'rescue-shell', rows: 9, expected: 'single' },
  { fixture: 'rpi-boot', rows: 15, expected: 'rootwait' },
  { fixture: 'custom-init', rows: 6, expected: 'loglevel' },
])('CmdlineApp with whatever the server serves: $fixture', ({ fixture, rows, expected }) => {
  it(`renders ${rows} parameters`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<CmdlineApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(rows + 1);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
