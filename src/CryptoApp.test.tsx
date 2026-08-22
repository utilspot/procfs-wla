import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readCryptoFixture as crypto } from './test/fixtures';
import { CryptoApp } from './CryptoApp';

/** Stands in for the backend serving /proc/crypto. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/crypto') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? crypto(options.fixture ?? 'x86-aesni'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CryptoApp', () => {
  it('requests /proc/crypto from its own path', async () => {
    render(<CryptoApp />);

    await screen.findByRole('table');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/crypto',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per registered implementation', async () => {
    render(<CryptoApp />);

    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(17 + 1); // + header
    expect(screen.getAllByText('cbc(aes)')).toHaveLength(2);
  });

  it('summarizes the registrations', async () => {
    render(<CryptoApp />);

    expect(await screen.findByText('implementations')).toBeInTheDocument();
    expect(screen.getByText('implementations').previousSibling).toHaveTextContent('17');
    expect(screen.getByText('algorithms').previousSibling).toHaveTextContent('13');
    expect(screen.getByText('with a choice of driver').previousSibling).toHaveTextContent('4');
  });

  it('marks the driver the kernel would use where there is a choice', async () => {
    render(<CryptoApp />);

    await screen.findByRole('table');
    const winner = screen.getByText('cbc-aes-aesni').closest('td')!;
    const loser = screen.getByText('cbc(aes-generic)').closest('td')!;

    expect(within(winner).getByText('in use')).toBeInTheDocument();
    expect(within(loser).queryByText('in use')).not.toBeInTheDocument();
  });

  it('does not mark anything in use when no name has a competing driver', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'minimal-embedded' }));
    render(<CryptoApp />);

    await screen.findByRole('table');
    expect(screen.queryByText('in use')).not.toBeInTheDocument();
    expect(screen.queryByText('with a choice of driver')).not.toBeInTheDocument();
  });

  it('flags the drivers that look hardware-accelerated', async () => {
    render(<CryptoApp />);

    await screen.findByRole('table');
    const accelerated = screen.getByText('aes-aesni').closest('td')!;
    const generic = screen.getByText('aes-generic').closest('td')!;

    expect(within(accelerated).getByText('accel')).toBeInTheDocument();
    expect(within(generic).queryByText('accel')).not.toBeInTheDocument();
  });

  it('shows the sizes each type carries and nothing it does not', async () => {
    render(<CryptoApp />);

    await screen.findByRole('table');
    const hash = screen.getByText('sha256-avx2').closest('tr')!;
    const cipher = screen.getByText('xts-aes-aesni').closest('tr')!;

    expect(within(hash).getByText('digest 32')).toBeInTheDocument();
    expect(within(hash).queryByText(/^key /)).not.toBeInTheDocument();
    expect(within(cipher).getByText('key 32–64')).toBeInTheDocument();
    expect(within(cipher).getByText('iv 16')).toBeInTheDocument();
  });

  it('hides the internal building blocks on request', async () => {
    const user = userEvent.setup();
    render(<CryptoApp />);

    await screen.findByRole('table');
    expect(screen.getByText('ghash-clmulni')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /hide internal building blocks/i }));

    expect(screen.queryByText('ghash-clmulni')).not.toBeInTheDocument();
    expect(screen.getByText('aes-aesni')).toBeInTheDocument();
  });

  it('warns about a driver whose self-test failed', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'arm-ce' }));
    render(<CryptoApp />);

    // Wait for the table: while loading, the "Reading…" notice is the status.
    await screen.findByRole('table');
    const warning = screen.getByRole('status');

    expect(warning).toHaveTextContent('1 of 13 implementations did not pass a self-test');
    expect(warning).toHaveTextContent('sha3-256-ce');
  });

  it('says nothing about self-tests when they all passed', async () => {
    render(<CryptoApp />);

    await screen.findByRole('table');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<CryptoApp />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent(crypto('x86-aesni'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<CryptoApp />);

    await screen.findByRole('table');
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file has no algorithms', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<CryptoApp />);

    expect(await screen.findByText(/no algorithms found/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<CryptoApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/crypto (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from a 3-algorithm board to a FIPS kernel.
describe.each([
  { fixture: 'x86-aesni', rows: 17, expected: 'xts-aes-aesni' },
  { fixture: 'arm-ce', rows: 13, expected: 'cbc-aes-neonbs' },
  { fixture: 'generic-vm', rows: 9, expected: 'lzo-generic' },
  { fixture: 'fips-mode', rows: 14, expected: 'drbg_pr_ctr_aes256' },
  { fixture: 'minimal-embedded', rows: 3, expected: 'sha1-generic' },
])('CryptoApp with whatever the server serves: $fixture', ({ fixture, rows, expected }) => {
  it(`renders ${rows} implementations`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<CryptoApp />);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(rows + 1);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
