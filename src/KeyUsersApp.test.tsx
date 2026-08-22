import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readKeyUsersFixture as keyUsers } from './test/fixtures';
import { KeyUsersApp } from './KeyUsersApp';

/** Stands in for the backend serving /proc/key-users. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/key-users') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? keyUsers(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Key quotas per user' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a uid, matched on the first cell. */
const rowFor = async (uid: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent?.startsWith(uid))!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KeyUsersApp', () => {
  it('requests /proc/key-users from its own path', async () => {
    render(<KeyUsersApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/key-users',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per user', async () => {
    render(<KeyUsersApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(2 + 1);
    expect(await rowFor('1000')).toHaveTextContent('9 / 200');
  });

  it('summarizes the users and the keys they hold', async () => {
    render(<KeyUsersApp />);

    expect(await screen.findByText('users')).toBeInTheDocument();
    expect(stat('users')).toHaveTextContent('2');
    expect(stat('keys held')).toHaveTextContent('13');
    expect(stat('closest to a quota')).toHaveTextContent('uid 1000');
  });

  /**
   * Root's limits are its own, so the share is what compares — 4 keys of a
   * million is nothing, where 4 of 200 would not be.
   */
  it('measures each user against the limits on their own line', async () => {
    render(<KeyUsersApp />);

    const root = await rowFor('0');
    expect(within(root).getByTitle('4 of 1,000,000 keys — 0%')).toBeInTheDocument();
    expect(within(root).getByText('root')).toBeInTheDocument();

    const user = await rowFor('1000');
    expect(within(user).getByTitle('9 of 200 keys — 5%')).toBeInTheDocument();
    expect(within(user).queryByText('root')).not.toBeInTheDocument();
  });

  /**
   * A key past the quota fails with EDQUOT rather than evicting anything, so
   * the page says something before that happens.
   */
  it('warns about a user close to a quota', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'near-quota' }));
    render(<KeyUsersApp />);

    expect(await screen.findByText(/uid 1000 is within 20% of a key quota/)).toBeInTheDocument();
    expect(await rowFor('1000')).toHaveClass('kusers__row--near');
    expect(await rowFor('1001')).not.toHaveClass('kusers__row--near');
  });

  it('says nothing of the sort when everyone has room', async () => {
    render(<KeyUsersApp />);

    await table();
    expect(screen.queryByText(/of a key quota/)).not.toBeInTheDocument();
  });

  /**
   * The first pair is not a quota: both numbers count the same keys, and the
   * gap is the ones with no payload yet.
   */
  it('shows the keys held without a payload', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'uninstantiated' }));
    render(<KeyUsersApp />);

    const row = await rowFor('1000');
    expect(
      within(row).getByTitle(
        'Held but not instantiated: still being constructed, or a cached lookup failure',
      ),
    ).toHaveTextContent('3');
    expect(stat('not instantiated')).toHaveTextContent('3');
  });

  it('marks a user whose keys all have payloads', async () => {
    render(<KeyUsersApp />);

    expect(within(await rowFor('1000')).getByTitle('Every key held has a payload')).toBeInTheDocument();
    expect(screen.queryByText('not instantiated')).not.toBeInTheDocument();
  });

  it('renders a server with a line per uid', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'many-users' }));
    render(<KeyUsersApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(6 + 1);
    expect(stat('keys held')).toHaveTextContent('50');
  });

  it('says an empty file has no users rather than showing an empty table', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<KeyUsersApp />);

    expect(await screen.findByText(/no users found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<KeyUsersApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(keyUsers('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<KeyUsersApp />);

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
    render(<KeyUsersApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/key-users (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', users: '2' },
  { fixture: 'many-users', users: '6' },
  { fixture: 'near-quota', users: '3' },
  { fixture: 'uninstantiated', users: '2' },
  { fixture: 'root-only', users: '1' },
])('KeyUsersApp with whatever the server serves: $fixture', ({ fixture, users }) => {
  it(`renders ${users} users`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<KeyUsersApp />);

    await table();
    expect(stat('users')).toHaveTextContent(users);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
