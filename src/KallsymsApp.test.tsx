import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readKallsymsFixture as kallsyms } from './test/fixtures';
import { KallsymsApp } from './KallsymsApp';

/** Stands in for the backend serving /proc/kallsyms. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/kallsyms') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? kallsyms(options.fixture ?? 'with-modules'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Kernel symbols' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a symbol, matched on the name in its third cell. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelectorAll('td')[2]?.textContent === name)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KallsymsApp', () => {
  it('requests /proc/kallsyms from its own path', async () => {
    render(<KallsymsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/kallsyms',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per symbol, with the address as written', async () => {
    render(<KallsymsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(15 + 1);
    expect(await rowFor('startup_64')).toHaveTextContent('ffffffff81000000');
  });

  it('summarizes what came from where', async () => {
    render(<KallsymsApp />);

    expect(await screen.findByText('symbols')).toBeInTheDocument();
    expect(stat('symbols')).toHaveTextContent('15');
    expect(stat('from modules')).toHaveTextContent('11');
    expect(stat('modules')).toHaveTextContent('3');
    expect(stat('exported')).toHaveTextContent('4');
  });

  /**
   * The case of the type letter says one thing for the kernel's own symbols
   * and another for a module's, which is the point worth making on this page.
   */
  it('reads the case as scope for a built-in symbol', async () => {
    render(<KallsymsApp />);

    const row = await rowFor('do_syscall_64');
    expect(within(row).getByTitle('Visible across the kernel')).toHaveTextContent('global');
  });

  it('reads the same case as exported for a module symbol', async () => {
    render(<KallsymsApp />);

    expect(
      within(await rowFor('nvme_complete_rq')).getByTitle(
        'Exported with EXPORT_SYMBOL, so another module can link against it',
      ),
    ).toHaveTextContent('exported');
    expect(
      within(await rowFor('nvme_probe')).getByTitle(
        'Not exported: nothing outside this module can use it',
      ),
    ).toHaveTextContent('internal');
  });

  it('names the module a symbol came from, and marks the ones with none', async () => {
    render(<KallsymsApp />);

    expect(await rowFor('ext4_bread')).toHaveTextContent('ext4');
    expect(within(await rowFor('init_task')).getByTitle('Built into the kernel')).toBeInTheDocument();
  });

  it('counts the type letters as a legend', async () => {
    render(<KallsymsApp />);

    await table();
    const chips = screen.getByTestId('types').querySelectorAll('.chip');
    expect([...chips].map((chip) => chip.textContent)).toEqual(['t 10', 'b 3', 'd 2']);
    expect(within(screen.getByTestId('types')).getByTitle(/text/)).toBeInTheDocument();
  });

  /**
   * Zeroed addresses are kptr_restrict hiding kernel pointers — everything
   * else in the file still arrives.
   */
  it('explains a file read under kptr_restrict', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'restricted' }));
    render(<KallsymsApp />);

    expect(await screen.findByText(/hiding kernel pointers/i)).toBeInTheDocument();
    expect(stat('symbols')).toHaveTextContent('8');
    // The names and modules are not hidden, so they are still shown.
    expect(await rowFor('nvme_probe')).toHaveTextContent('nvme');
  });

  // A letter with no case says nothing about scope, so nothing is claimed.
  it('claims no scope for a type letter it cannot read', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'mixed-types' }));
    render(<KallsymsApp />);

    const row = await rowFor('__unnamed_type');
    expect(
      within(row).getByTitle('This letter has no case to read a scope from'),
    ).toBeInTheDocument();
    expect(within(row).getByTitle('A type letter no tool names')).toHaveTextContent('?');
  });

  it('renders the narrower addresses of a 32-bit kernel', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'i386-32bit' }));
    render(<KallsymsApp />);

    expect(await rowFor('startup_32')).toHaveTextContent('c1000000');
    expect(stat('modules')).toHaveTextContent('1');
  });

  it('says an empty file has no symbols rather than showing an empty table', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<KallsymsApp />);

    expect(await screen.findByText(/no symbols found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<KallsymsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(kallsyms('with-modules'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<KallsymsApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<KallsymsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/kallsyms (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the one read with pointers hidden.
describe.each([
  { fixture: 'kernel-text', symbols: '17' },
  { fixture: 'with-modules', symbols: '15' },
  { fixture: 'restricted', symbols: '8' },
  { fixture: 'i386-32bit', symbols: '10' },
  { fixture: 'mixed-types', symbols: '13' },
])('KallsymsApp with whatever the server serves: $fixture', ({ fixture, symbols }) => {
  it(`renders ${symbols} symbols`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<KallsymsApp />);

    await table();
    expect(stat('symbols')).toHaveTextContent(symbols);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
