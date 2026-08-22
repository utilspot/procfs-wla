import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readExecDomainsFixture as execdomains } from './test/fixtures';
import { ExecDomainsApp } from './ExecDomainsApp';

/** Stands in for the backend serving /proc/execdomains. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/execdomains') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? execdomains(options.fixture ?? 'linux-abi'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Registered exec domains' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a personality range, matched on its first cell. */
const rowFor = async (personality: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === personality)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExecDomainsApp', () => {
  it('requests /proc/execdomains from its own path', async () => {
    render(<ExecDomainsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/execdomains',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per registered domain', async () => {
    render(<ExecDomainsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(7 + 1);
    expect(await rowFor('0')).toHaveTextContent('Linux');
    expect(await rowFor('13')).toHaveTextContent('Solaris');
  });

  it('summarizes the domains and where they came from', async () => {
    render(<ExecDomainsApp />);

    expect(await screen.findByText('domains')).toBeInTheDocument();
    expect(stat('domains')).toHaveTextContent('7');
    expect(stat('personalities')).toHaveTextContent('7');
    expect(stat('from modules')).toHaveTextContent('6');
  });

  // The bracketed name is the only thing separating a loaded ABI module from
  // a domain compiled into the kernel.
  it('shows which domains came from a module and which are built in', async () => {
    render(<ExecDomainsApp />);

    expect(
      within(await rowFor('0')).getByTitle('Compiled into the kernel, not loaded as a module'),
    ).toBeInTheDocument();
    expect(await rowFor('1')).toHaveTextContent('abi_svr4');
  });

  // The chips are the kernel's own name for the number, which is not always
  // what the domain called itself.
  it('names the ABI a personality number stands for', async () => {
    render(<ExecDomainsApp />);

    const cell = (await rowFor('14')).querySelector('.execdom__abis') as HTMLElement;
    expect(within(cell).getByText('UnixWare 7')).toBeInTheDocument();
  });

  /**
   * A domain claims a range, not a number, and the ABI column has to name
   * every personality inside it.
   */
  it('shows a domain that claims a range of personalities', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'ibcs-range' }));
    render(<ExecDomainsApp />);

    const row = await rowFor('1–5');
    expect(row).toHaveTextContent('iBCS2');
    expect(within(row).getByText('SVR3')).toBeInTheDocument();
    expect(within(row).getByText('Interactive UNIX')).toBeInTheDocument();
    expect(stat('personalities')).toHaveTextContent('6');
  });

  // Only the PER_* constants have names; nothing is invented for the rest.
  it('names no ABI for a personality number the kernel does not know', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'custom-domain' }));
    render(<ExecDomainsApp />);

    const row = await rowFor('42');
    expect(row).toHaveTextContent('AcmeOS');
    expect(
      within(row).getByTitle("No ABI in the kernel's list uses this personality number"),
    ).toBeInTheDocument();
  });

  /**
   * The single fixed line says nothing about the machine, so the page says so
   * rather than presenting one row as a finding.
   */
  it('explains the fixed line a current kernel prints', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'modern-stub' }));
    render(<ExecDomainsApp />);

    expect(await screen.findByText(/fixed line every kernel since/i)).toBeInTheDocument();
    expect(within(await table()).getAllByRole('row')).toHaveLength(1 + 1);
    // Vestigial, not broken.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not call a file with modules loaded the fixed line', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'svr4-module' }));
    render(<ExecDomainsApp />);

    await table();
    expect(screen.queryByText(/fixed line every kernel since/i)).not.toBeInTheDocument();
  });

  // The kernel refused to register a domain over a claimed personality.
  it('calls out personalities claimed by two domains', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '0-0\tLinux\t[kernel]\n0-2\tOther\t[abi_other]\n' }));
    render(<ExecDomainsApp />);

    await table();
    expect(screen.getByText(/more than one domain claims personality/i)).toHaveTextContent('0');
  });

  it('says an empty file has no domains rather than showing an empty table', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<ExecDomainsApp />);

    expect(await screen.findByText(/no exec domains found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<ExecDomainsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(execdomains('linux-abi'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<ExecDomainsApp />);

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
    render(<ExecDomainsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/execdomains (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the one-line file a current kernel prints.
describe.each([
  { fixture: 'modern-stub', domains: '1' },
  { fixture: 'svr4-module', domains: '2' },
  { fixture: 'linux-abi', domains: '7' },
  { fixture: 'ibcs-range', domains: '2' },
  { fixture: 'custom-domain', domains: '2' },
])('ExecDomainsApp with whatever the server serves: $fixture', ({ fixture, domains }) => {
  it(`renders ${domains} domains`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<ExecDomainsApp />);

    await table();
    expect(stat('domains')).toHaveTextContent(domains);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
