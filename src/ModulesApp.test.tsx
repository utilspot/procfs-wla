import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readModulesFixture as modules } from './test/fixtures';
import { ModulesApp } from './ModulesApp';

/** Stands in for the backend serving /proc/modules. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/modules') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? modules(options.fixture ?? 'desktop-nvidia'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Loaded modules by size' });

/**
 * The row for a module. Matched on the name cell's own text node, since its
 * full text also carries the taint chips — `nvidia` renders as `nvidiaPOE`.
 */
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

describe('ModulesApp', () => {
  it('requests /proc/modules from its own path', async () => {
    render(<ModulesApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/modules',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per module, largest first', async () => {
    render(<ModulesApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(20 + 1); // + header
    expect(rows[1]?.querySelector('td')?.textContent).toContain('nvidia');
  });

  it('summarizes the table', async () => {
    render(<ModulesApp />);
    await table();
    // Scoped to the body: `modules` is also a step of the path at the top.
    const body = within(screen.getByRole('main'));

    expect(body.getByText('modules').previousSibling).toHaveTextContent('20');
    expect(body.getByText('memory').previousSibling).toHaveTextContent('58 MiB');
    expect(body.getByText('nothing depends on').previousSibling).toHaveTextContent('2');
  });

  // The file states one direction; the page shows both.
  it('shows both what uses a module and what it depends on', async () => {
    render(<ModulesApp />);

    const row = await rowFor('ext4');
    const cells = within(row).getAllByRole('cell');

    // "Used by" is the kernel's own field — nothing depends on ext4 here.
    expect(within(cells[3]!).getByText('—')).toBeInTheDocument();
    // "Depends on" is the inversion: ext4 needs mbcache and jbd2.
    expect(within(cells[4]!).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'mbcache',
      'jbd2',
    ]);
  });

  it('shows the other direction for a module that is depended on', async () => {
    render(<ModulesApp />);

    const cells = within(await rowFor('jbd2')).getAllByRole('cell');

    expect(within(cells[3]!).getByText('ext4')).toBeInTheDocument();
    expect(within(cells[4]!).getByText('—')).toBeInTheDocument();
  });

  it('marks each taint letter with what it means', async () => {
    render(<ModulesApp />);

    const row = await rowFor('nvidia');
    expect(within(row).getByTitle('proprietary, not GPL-compatible')).toHaveTextContent('P');
    expect(within(row).getByTitle('built out of tree')).toHaveTextContent('O');
    expect(within(row).getByTitle('unsigned')).toHaveTextContent('E');
  });

  it('warns which modules taint the kernel', async () => {
    render(<ModulesApp />);

    await table();
    const warning = screen.getByRole('status');

    expect(warning).toHaveTextContent('3 of 20 modules taint the kernel');
    expect(warning).toHaveTextContent('nvidia, nvidia_modeset, nvidia_drm');
  });

  it('says nothing about taint on an untainted kernel', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'server-minimal' }));
    render(<ModulesApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('hides the modules nothing holds a reference to', async () => {
    const user = userEvent.setup();
    render(<ModulesApp />);

    await table();
    await user.click(
      screen.getByRole('checkbox', { name: /hide modules nothing holds a reference to/i }),
    );

    expect(within(await table()).getAllByRole('row')).toHaveLength(18 + 1);
    expect(within(await table()).queryByText('usbhid')).not.toBeInTheDocument();
  });

  it('flags a module that is not Live', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'tainted-vbox' }));
    render(<ModulesApp />);

    const row = await rowFor('rtl8812au');
    expect(within(row).getByText('Unloading')).toBeInTheDocument();
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('rtl8812au is unloading');
  });

  it('mentions hidden addresses when the kernel withheld them all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'server-minimal' }));
    render(<ModulesApp />);

    await table();
    expect(screen.getByText(/kptr_restrict/)).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<ModulesApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(modules('desktop-nvidia'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<ModulesApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('explains an empty file rather than showing nothing', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<ModulesApp />);

    expect(await screen.findByText(/everything built in has none to list/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<ModulesApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/modules (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — tainted or not, from a Pi to a workstation.
describe.each([
  { fixture: 'desktop-nvidia', rows: 20, memory: '58 MiB' },
  { fixture: 'server-minimal', rows: 10, memory: '4.0 MiB' },
  { fixture: 'container-host', rows: 12, memory: '1.1 MiB' },
  { fixture: 'tainted-vbox', rows: 10, memory: '15 MiB' },
  { fixture: 'arm-rpi', rows: 10, memory: '1.5 MiB' },
])('ModulesApp with whatever the server serves: $fixture', ({ fixture, rows, memory }) => {
  it(`renders ${rows} modules totalling ${memory}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<ModulesApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(rows + 1);
    expect(screen.getByText('memory').previousSibling).toHaveTextContent(memory);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
