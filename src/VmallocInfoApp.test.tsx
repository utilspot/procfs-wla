import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readVmallocInfoFixture as vmallocinfo } from './test/fixtures';
import { VmallocInfoApp } from './VmallocInfoApp';

/** Stands in for the backend serving /proc/vmallocinfo. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/vmallocinfo') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? vmallocinfo(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const entries = () => screen.findByRole('table', { name: 'Mappings by address' });
const callers = () => screen.findByRole('table', { name: 'Mappings by caller' });

/** The row whose given cell starts with this text. */
const rowFor = async (table: HTMLElement, text: string, cell = 0): Promise<HTMLElement> => {
  const rows = within(table).getAllByRole('row');
  return rows.find((row) => row.querySelectorAll('td')[cell]?.textContent?.startsWith(text))!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VmallocInfoApp', () => {
  it('requests /proc/vmallocinfo from its own path', async () => {
    render(<VmallocInfoApp />);

    await entries();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/vmallocinfo',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per mapping', async () => {
    render(<VmallocInfoApp />);

    expect(within(await entries()).getAllByRole('row')).toHaveLength(21 + 1);
  });

  it('summarizes what the kernel has mapped', async () => {
    render(<VmallocInfoApp />);

    expect(await screen.findByText('mapped')).toBeInTheDocument();
    expect(stat('mapped')).toHaveTextContent('13 MiB');
    expect(stat('mappings')).toHaveTextContent('21');
    expect(stat('largest')).toHaveTextContent('8.0 MiB');
    expect(stat('in guard pages')).toHaveTextContent('KiB');
  });

  /** The table people actually come to this file for. */
  it('adds the mappings up by the caller that asked for them', async () => {
    render(<VmallocInfoApp />);

    const table = await callers();
    const loadModule = await rowFor(table, 'load_module');
    expect(loadModule).toHaveTextContent('3');
    expect(loadModule).toHaveTextContent('45');
    // Biggest holder first.
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('drm_fbdev_generic_setup');
  });

  /** The size is a page larger than the pages behind it. */
  it('says which mappings carry a guard page', async () => {
    render(<VmallocInfoApp />);

    const row = await rowFor(await entries(), '0xffffc9000000c000');
    expect(within(row).getByTitle('8,192 bytes, one page of it the guard')).toBeInTheDocument();
  });

  it('says when a mapping has no guard page', async () => {
    render(<VmallocInfoApp />);

    const row = await rowFor(await entries(), '0xffffc90000030000');
    expect(within(row).getByTitle('262,144 bytes, no guard page')).toBeInTheDocument();
  });

  it('shows the module a caller lives in', async () => {
    render(<VmallocInfoApp />);

    const row = await rowFor(await entries(), '0xffffc900004d5000');
    expect(within(row).getByText('nvidia_drm')).toBeInTheDocument();
  });

  it('shows a device mapping’s physical address and no page count', async () => {
    render(<VmallocInfoApp />);

    const row = await rowFor(await entries(), '0xffffc90000005000');
    expect(row).toHaveTextContent('0x00000000fed00000');
    expect(
      within(row).getByTitle('No pages behind it — a device mapping has none'),
    ).toBeInTheDocument();
  });

  it('explains the flags a mapping carries', async () => {
    render(<VmallocInfoApp />);

    await entries();
    const flags = screen.getByTestId('flags');
    expect(within(flags).getByTitle(/no RAM behind it/)).toHaveTextContent('ioremap');
    expect(within(flags).getByTitle(/too large to kmalloc/)).toHaveTextContent('vpages');
  });

  it('describes where the mappings sit and what is between them', async () => {
    render(<VmallocInfoApp />);

    const layout = await screen.findByTestId('layout');
    expect(layout).toHaveTextContent('0xffffc90000000000');
    expect(layout).toHaveTextContent('the biggest single hole being 4.0 MiB');
    expect(layout).toHaveTextContent('rather than how full anything is');
  });

  it('hides the device mappings when asked', async () => {
    const user = userEvent.setup();
    render(<VmallocInfoApp />);
    await entries();

    await user.click(screen.getByRole('checkbox'));

    expect(within(await entries()).getAllByRole('row')).toHaveLength(21 - 6 + 1);
  });

  it('shows which node a mapping’s pages came from', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'numa-2node' }));
    render(<VmallocInfoApp />);

    const row = await rowFor(await entries(), '0xffffc90000007000');
    expect(within(row).getByTitle('1024 of its pages came from node 0')).toBeInTheDocument();
    expect(screen.getByTestId('flags')).toHaveTextContent('nodes 0, 1');
  });

  /**
   * With the addresses zeroed there is no layout to describe, and saying so
   * beats describing a layout that is not there.
   */
  it('says what kptr_restrict took away, and drops the layout with it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'restricted' }));
    render(<VmallocInfoApp />);

    await entries();
    expect(screen.getByTestId('zeroed')).toHaveTextContent('came back as zeroes');
    expect(screen.queryByTestId('layout')).not.toBeInTheDocument();
    // The accounting is still there.
    expect(stat('mapped')).toHaveTextContent('4.2 MiB');
    expect(within(await callers()).getAllByRole('row')[1]).toHaveTextContent(
      'alloc_large_system_hash',
    );
  });

  it('says nothing of the sort when the addresses are real', async () => {
    render(<VmallocInfoApp />);

    await entries();
    expect(screen.queryByTestId('zeroed')).not.toBeInTheDocument();
  });

  it('renders a 32-bit kernel’s shorter addresses', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'i386-fragmented' }));
    render(<VmallocInfoApp />);

    expect(await screen.findByTestId('layout')).toHaveTextContent('0x00000000f8000000');
    expect(stat('mappings')).toHaveTextContent('11');
  });

  it('says an unreadable file has no mappings', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<VmallocInfoApp />);

    expect(await screen.findByText(/no mappings found/i)).toBeInTheDocument();
    expect(screen.getByText(/readable by root only/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<VmallocInfoApp />);
    await entries();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(vmallocinfo('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<VmallocInfoApp />);

    await entries();
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
    render(<VmallocInfoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/vmallocinfo (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', mappings: 21 },
  { fixture: 'numa-2node', mappings: 7 },
  { fixture: 'i386-fragmented', mappings: 11 },
  { fixture: 'vm-minimal', mappings: 6 },
  { fixture: 'restricted', mappings: 5 },
])('VmallocInfoApp with whatever the server serves: $fixture', ({ fixture, mappings }) => {
  it(`renders ${mappings} mappings`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<VmallocInfoApp />);

    const table = await screen.findByRole('table', { name: 'Mappings by address' });
    expect(within(table).getAllByRole('row')).toHaveLength(mappings + 1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
