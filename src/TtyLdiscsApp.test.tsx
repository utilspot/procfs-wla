import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readTtyLdiscsFixture as ldiscs } from './test/fixtures';
import { TtyLdiscsApp } from './TtyLdiscsApp';

/** Stands in for the backend serving /proc/tty/ldiscs. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/tty/ldiscs') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? ldiscs(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Registered line disciplines' });

/** The row for a discipline, matched on the name's own text node. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelectorAll('td')[1]?.childNodes[0]?.textContent === name)!;
};

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/tty/ldiscs');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('TtyLdiscsApp', () => {
  it('requests /proc/tty/ldiscs from its own path', async () => {
    render(<TtyLdiscsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/tty/ldiscs',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per registered discipline', async () => {
    render(<TtyLdiscsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(2 + 1);
    expect(await rowFor('n_null')).toBeInTheDocument();
  });

  it('shows the number and the constant beside the name', async () => {
    render(<TtyLdiscsApp />);

    const nullDisc = await rowFor('n_null');
    expect(nullDisc).toHaveTextContent('27');
    expect(nullDisc).toHaveTextContent('N_NULL');
    expect(nullDisc).toHaveTextContent(/discards everything/);
  });

  /** Nothing else in the file is on any terminal unless a program put it there. */
  it('marks the one every tty starts on', async () => {
    render(<TtyLdiscsApp />);

    const tty = await rowFor('n_tty');
    expect(within(tty).getByText('default')).toBeInTheDocument();
    expect(tty).toHaveClass('ldisc__row--default');

    const nullDisc = await rowFor('n_null');
    expect(within(nullDisc).queryByText('default')).not.toBeInTheDocument();
  });

  it('says nothing about deleted disciplines on a current kernel', async () => {
    render(<TtyLdiscsApp />);

    await table();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  /** The numbers stay allocated, so this dates the kernel rather than faulting it. */
  it('warns about disciplines current Linux no longer has a driver for', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    render(<TtyLdiscsApp />);

    await table();
    const warning = screen.getByRole('status');

    expect(warning).toHaveTextContent('n_strip, n_irda are disciplines');
    expect(warning).toHaveTextContent('the last went in 4.17');
    expect(warning).toHaveTextContent('older than that rather than that anything is wrong');
  });

  it('marks the release that deleted a discipline on its own row', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    render(<TtyLdiscsApp />);

    const irda = await rowFor('n_irda');
    expect(within(irda).getByText('gone in 4.17')).toBeInTheDocument();
    expect(within(irda).getByTitle('Linux deleted the driver in 4.17')).toBeInTheDocument();

    // Registered on the same old kernel, but this one is still in Linux.
    const ppp = await rowFor('n_ppp');
    expect(within(ppp).queryByText(/gone in/)).not.toBeInTheDocument();
  });

  it('marks a discipline registered under a number it does not know', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'out-of-tree' }));
    render(<TtyLdiscsApp />);

    const vendor = await rowFor('n_vendor');
    expect(within(vendor).getByText('not known here')).toBeInTheDocument();
    expect(vendor).toHaveTextContent('Nothing here knows this number.');
    // No constant to show for it either, so the column says so rather than guessing.
    expect(within(vendor).getAllByText('—')).toHaveLength(1);
  });

  it('reads several disciplines registered at once', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'packet-radio' }));
    render(<TtyLdiscsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(6 + 1);
    expect(await rowFor('n_ax25')).toHaveTextContent('N_AX25');
    expect(await rowFor('n_6pack')).toHaveTextContent('packet-radio TNCs');
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<TtyLdiscsApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(ldiscs('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<TtyLdiscsApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no disciplines', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<TtyLdiscsApp />);

    expect(await screen.findByText(/no line disciplines found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<TtyLdiscsApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/tty/ldiscs (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from the plain pair to a kernel old enough to date itself.
describe.each([
  { fixture: 'desktop', rows: 2 },
  { fixture: 'bluetooth-serial', rows: 3 },
  { fixture: 'packet-radio', rows: 6 },
  { fixture: 'legacy-2.6', rows: 11 },
  { fixture: 'out-of-tree', rows: 3 },
])('TtyLdiscsApp with whatever the server serves: $fixture', ({ fixture, rows }) => {
  it(`renders ${rows} disciplines, n_tty the default among them`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<TtyLdiscsApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(rows + 1);
    expect(await rowFor('n_tty')).toHaveClass('ldisc__row--default');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
