import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readKeysFixture as keys } from './test/fixtures';
import { KeysApp } from './KeysApp';

/** Stands in for the backend serving /proc/keys. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/keys') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? keys(options.fixture ?? 'desktop-session'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Keys in the kernel keyring' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a serial, matched on its first cell. */
const rowFor = async (serial: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === serial)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KeysApp', () => {
  it('requests /proc/keys from its own path', async () => {
    render(<KeysApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/keys',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per key', async () => {
    render(<KeysApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(5 + 1);
    expect(await rowFor('30ab8c66')).toHaveTextContent('wifi_psk');
  });

  it('summarizes the keys and the keyrings among them', async () => {
    render(<KeysApp />);

    expect(await screen.findByText('keys')).toBeInTheDocument();
    expect(stat('keys')).toHaveTextContent('5');
    expect(stat('keyrings')).toHaveTextContent('4');
    expect(stat('with an expiry')).toHaveTextContent('0');
  });

  /**
   * The mask is four bytes — possessor, user, group, other — written the way
   * keyctl writes them, which is the page's main job.
   */
  it('decodes the permission mask into its four subjects', async () => {
    render(<KeysApp />);

    const row = await rowFor('0083c4a2');
    // Scoped to the permissions cell: the flags in the same row are a list too.
    const perms = within(row.querySelector('.keys__perms') as HTMLElement).getAllByRole('listitem');

    expect(perms.map((chip) => chip.textContent)).toEqual([
      '--alswrv',
      '------rv',
      '--------',
      '--------',
    ]);
    expect(perms[0]).toHaveAttribute(
      'title',
      'possessor: view, read, write, search, link, setattr',
    );
    expect(perms[2]).toHaveAttribute('title', 'group: nothing');
  });

  // The flags are positional in the file; the page spells them out.
  it('names the flags rather than showing their letters', async () => {
    render(<KeysApp />);

    const row = await rowFor('0083c4a2');
    expect(within(row).getByText('instantiated')).toBeInTheDocument();
    expect(within(row).getByText('quota')).toBeInTheDocument();
    expect(within(row).queryByText('revoked')).not.toBeInTheDocument();
  });

  it('splits the detail a type appended from the description', async () => {
    render(<KeysApp />);

    const row = await rowFor('0083c4a2');
    expect(row).toHaveTextContent('_ses');
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('says plainly when a key never expires', async () => {
    render(<KeysApp />);

    expect(within(await rowFor('0083c4a2')).getByTitle('Never expires')).toHaveTextContent('never');
  });

  it('shows the time left on a key that will expire', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'kerberos-user' }));
    render(<KeysApp />);

    expect(await rowFor('1244aa02')).toHaveTextContent('43m');
    expect(stat('with an expiry')).toHaveTextContent('5');
  });

  /**
   * Expired, revoked and invalidated keys stay listed until the kernel
   * collects them, so the page says so rather than treating it as a fault.
   */
  it('calls out the keys that can no longer be used', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'expired-and-revoked' }));
    render(<KeysApp />);

    expect(await screen.findByText(/3 keys can no longer be used/)).toBeInTheDocument();
    expect(await rowFor('51aa1000')).toHaveClass('keys__row--expired');
    expect(within(await rowFor('51aa1001')).getByText('revoked')).toBeInTheDocument();
    expect(stat('expired')).toHaveTextContent('1');
  });

  // A negative key is a cached lookup failure, never instantiated.
  it('shows a negative key as one that was never instantiated', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'expired-and-revoked' }));
    render(<KeysApp />);

    const row = await rowFor('51aa1002');
    expect(within(row).getByText('negative')).toBeInTheDocument();
    expect(within(row).queryByText('instantiated')).not.toBeInTheDocument();
  });

  // The kernel prints the type in nine characters, so a longer name is cut.
  it('marks a type name that may have been cut short', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'root-view' }));
    render(<KeysApp />);

    const row = await rowFor('0000000a');
    expect(row).toHaveTextContent('asymmetri');
    expect(
      within(row).getByTitle(
        'The kernel prints the type in 9 characters, so this name may be cut short',
      ),
    ).toBeInTheDocument();
    expect(within(await rowFor('00c0ffee')).queryByText('cut?')).not.toBeInTheDocument();
  });

  /**
   * The file lists what the reader may see, so an empty one says something
   * about the reader rather than about the machine.
   */
  it('explains an empty file as nothing the reader may see', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-keys' }));
    render(<KeysApp />);

    expect(await screen.findByText(/no keys are visible/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('counts the key types', async () => {
    render(<KeysApp />);

    await table();
    const chips = screen.getByTestId('types').querySelectorAll('.chip');
    expect([...chips].map((chip) => chip.textContent)).toEqual(['keyring 4', 'user 1']);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<KeysApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(keys('desktop-session'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<KeysApp />);

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
    render(<KeysApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/keys (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the reader who may see nothing.
describe.each([
  { fixture: 'desktop-session', total: '5' },
  { fixture: 'kerberos-user', total: '6' },
  { fixture: 'expired-and-revoked', total: '6' },
  { fixture: 'root-view', total: '6' },
])('KeysApp with whatever the server serves: $fixture', ({ fixture, total }) => {
  it(`renders ${total} keys`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<KeysApp />);

    await table();
    expect(stat('keys')).toHaveTextContent(total);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
