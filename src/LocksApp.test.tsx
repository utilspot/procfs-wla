import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readLocksFixture as locks } from './test/fixtures';
import { LocksApp } from './LocksApp';

/** Stands in for the backend serving /proc/locks. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/locks') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? locks(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'File locks' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The data rows, in the order the page put them. */
const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LocksApp', () => {
  it('requests /proc/locks from its own path', async () => {
    render(<LocksApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/locks',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per lock', async () => {
    render(<LocksApp />);

    expect(await rows()).toHaveLength(8);
    expect((await rows())[0]).toHaveTextContent('POSIX');
  });

  it('summarizes what is held and by how many processes', async () => {
    render(<LocksApp />);

    expect(await screen.findByText('locks held')).toBeInTheDocument();
    expect(stat('locks held')).toHaveTextContent('8');
    expect(stat('for writing')).toHaveTextContent('5');
    expect(stat('processes')).toHaveTextContent('6');
  });

  /**
   * The device numbers are printed in hex beside a decimal inode, so the page
   * shows them decoded rather than as written.
   */
  it('shows the device numbers decoded from hex', async () => {
    render(<LocksApp />);

    // `00:2f:32388` in the file is major 0, minor 47.
    const row = (await rows()).find((candidate) => candidate.textContent?.includes('32388'))!;
    expect(row).toHaveTextContent('0:47:32388');
  });

  /**
   * Both ends of a range are inclusive, so `128 128` is one byte — the page
   * says so rather than showing an empty-looking range.
   */
  it('reads an inclusive range as the bytes it covers', async () => {
    render(<LocksApp />);

    const row = (await rows())[0]!;
    expect(within(row).getByTitle('1 byte, both ends included')).toHaveTextContent('128–128');
  });

  it('calls a lock over the whole file what it is', async () => {
    render(<LocksApp />);

    const row = (await rows())[1]!;
    expect(
      within(row).getByTitle('From byte 0 to the end, however the file grows'),
    ).toHaveTextContent('whole file');
  });

  // An OFD lock belongs to the open file description, so no process owns it.
  it('shows an OFD lock as owned by no process', async () => {
    render(<LocksApp />);

    const row = (await rows())[7]!;
    expect(row).toHaveTextContent('OFDLCK');
    expect(
      within(row).getByTitle('No process owns it: the open file description does'),
    ).toHaveTextContent('none');
  });

  /**
   * A `->` line is a process queued behind the lock above it, not a lock the
   * machine holds.
   */
  it('marks the processes queued behind a lock', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'blocked-waiters' }));
    render(<LocksApp />);

    expect(await screen.findByText(/3 processes are queued behind locks/)).toBeInTheDocument();
    const waiter = (await rows())[1]!;
    expect(waiter).toHaveClass('locks__row--waiting');
    expect(within(waiter).getByTitle('Queued behind lock 1')).toBeInTheDocument();
    expect(stat('locks held')).toHaveTextContent('3');
    expect(stat('waiting')).toHaveTextContent('3');
  });

  it('says nothing of the sort when nothing is queued', async () => {
    render(<LocksApp />);

    await rows();
    expect(screen.queryByText(/queued behind/)).not.toBeInTheDocument();
  });

  /**
   * For a lease the second field is the lease's state rather than whether it
   * is advisory, so the page presents it differently.
   */
  it('shows a lease state as a state', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'leases' }));
    render(<LocksApp />);

    const breaking = (await rows())[1]!;
    expect(
      within(breaking).getByTitle('The state of the lease, not an enforcement'),
    ).toHaveTextContent('BREAKING');
    // A POSIX lock's ADVISORY is not a state, so it gets no such badge.
    const posix = (await rows())[4]!;
    expect(posix).toHaveTextContent('ADVISORY');
    expect(within(posix).queryByTitle('The state of the lease, not an enforcement')).toBeNull();
  });

  it('counts the kinds of lock', async () => {
    render(<LocksApp />);

    await table();
    const chips = screen.getByTestId('kinds').querySelectorAll('.chip');
    expect([...chips].map((chip) => chip.textContent)).toEqual(['POSIX 5', 'FLOCK 2', 'OFDLCK 1']);
  });

  /**
   * Nothing locked is an ordinary state for a machine, not an error and not an
   * empty table.
   */
  it('explains a machine with nothing locked', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-locks' }));
    render(<LocksApp />);

    expect(await screen.findByText(/no files are locked/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a database holding byte ranges', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'byte-ranges' }));
    render(<LocksApp />);

    const row = (await rows())[1]!;
    expect(within(row).getByTitle('64 bytes, both ends included')).toHaveTextContent(
      '1,073,741,824–1,073,741,887',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<LocksApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(locks('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<LocksApp />);

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
    render(<LocksApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/locks (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine with nothing locked.
describe.each([
  { fixture: 'desktop', held: '8' },
  { fixture: 'blocked-waiters', held: '3' },
  { fixture: 'byte-ranges', held: '5' },
  { fixture: 'leases', held: '5' },
])('LocksApp with whatever the server serves: $fixture', ({ fixture, held }) => {
  it(`renders ${held} locks held`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<LocksApp />);

    await table();
    expect(stat('locks held')).toHaveTextContent(held);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
