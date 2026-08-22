import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readVersionSignatureFixture as signature } from './test/fixtures';
import { VersionSignatureApp } from './VersionSignatureApp';

/** Stands in for the backend serving /proc/version_signature. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/version_signature') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? signature(options.fixture ?? 'generic'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const table = () => screen.findByRole('table', { name: 'Version signature fields' });

/** The row for one field of the line. */
const rowFor = async (label: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === label)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VersionSignatureApp', () => {
  it('requests /proc/version_signature from its own path', async () => {
    render(<VersionSignatureApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/version_signature',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('leads with the release the machine is really running', async () => {
    render(<VersionSignatureApp />);

    expect(await screen.findByText('really running')).toBeInTheDocument();
    expect(stat('really running')).toHaveTextContent('5.15.131');
    expect(stat('uname -r says')).toHaveTextContent('5.15.0-91-generic');
    expect(stat('flavour')).toHaveTextContent('generic');
    expect(stat('ABI · upload')).toHaveTextContent('91 · 101');
  });

  /** Which is the whole reason the file exists. */
  it('spells out the gap between uname -r and the upstream release', async () => {
    render(<VersionSignatureApp />);

    const notice = await screen.findByTestId('hidden-upstream');
    expect(notice).toHaveTextContent('uname -r reports 5.15.0-91-generic');
    expect(notice).toHaveTextContent('really upstream 5.15.131');
  });

  it('takes the line apart a piece at a time', async () => {
    render(<VersionSignatureApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(6 + 1);
    expect(await rowFor('ABI number')).toHaveTextContent('91');
    expect(await rowFor('ABI number')).toHaveTextContent('uname -r shows');
    expect(await rowFor('upload number')).toHaveTextContent('101');
    expect(await rowFor('upload number')).toHaveTextContent('nowhere in uname -r');
    expect(await rowFor('upstream release')).toHaveTextContent('5.15.131');
  });

  it('says the file is an Ubuntu one', async () => {
    render(<VersionSignatureApp />);

    await table();
    expect(
      within(screen.getByTestId('flags')).getByTitle('Only Ubuntu kernels ship this file at all'),
    ).toHaveTextContent('Ubuntu');
  });

  /** The suffix is in the package version and never in uname -r. */
  it('flags a backported kernel and keeps the suffix out of uname', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'hwe-backport' }));
    render(<VersionSignatureApp />);

    await table();
    expect(screen.getByTestId('flags')).toHaveTextContent('backported to 24.04.1');
    expect(stat('uname -r says')).toHaveTextContent('7.0.0-28-generic');
    expect(stat('really running')).toHaveTextContent('7.0.12');
    expect(await rowFor('backported to')).toHaveTextContent('HWE');
  });

  it('says nothing about a backport on a kernel that is not one', async () => {
    render(<VersionSignatureApp />);

    await table();
    expect(screen.getByTestId('flags')).not.toHaveTextContent('backported');
  });

  /** Four digits is a derivative's own numbering, not a thousand ABI breaks. */
  it('reads a four-digit ABI as a derivative', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'cloud-azure' }));
    render(<VersionSignatureApp />);

    await table();
    expect(screen.getByTestId('flags')).toHaveTextContent('derivative ABI 1053');
    expect(
      within(screen.getByTestId('flags')).getByTitle(/number their ABI from 1000 upwards/),
    ).toBeInTheDocument();
  });

  it('says what a flavour is for', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'lowlatency' }));
    render(<VersionSignatureApp />);

    expect(await rowFor('flavour')).toHaveTextContent('faster tick and fuller preemption');
  });

  it('says nothing about a hidden release when the two versions agree', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raspi' }));
    render(<VersionSignatureApp />);

    await table();
    expect(screen.queryByTestId('hidden-upstream')).not.toBeInTheDocument();
    expect(stat('really running')).toHaveTextContent('6.8.0');
  });

  it('renders a kernel from the 2.6 days', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-lucid' }));
    render(<VersionSignatureApp />);

    expect(await rowFor('upstream release')).toHaveTextContent('2.6.32.11+drm33.2');
    expect(stat('uname -r says')).toHaveTextContent('2.6.32-21-generic');
  });

  /** A package is built from the tree it names, so this should never happen. */
  it('warns when the two version fields name different series', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'Ubuntu 5.15.0-91.101-generic 5.4.44\n' }));
    render(<VersionSignatureApp />);

    await table();
    expect(screen.getByRole('status')).toHaveTextContent('do not agree on the series');
    // That warning supersedes the ordinary note about the two numbers.
    expect(screen.queryByTestId('hidden-upstream')).not.toBeInTheDocument();
  });

  it('keeps what it can from a package version it cannot take apart', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'Ubuntu something-odd 5.15.131\n' }));
    render(<VersionSignatureApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(2 + 1);
    expect(stat('uname -r says')).toHaveTextContent('—');
    expect(stat('really running')).toHaveTextContent('5.15.131');
  });

  it('says a file that is not a signature is not this file', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'Ubuntu\n' }));
    render(<VersionSignatureApp />);

    expect(await screen.findByText(/no version signature found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<VersionSignatureApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(signature('generic'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<VersionSignatureApp />);

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
    render(<VersionSignatureApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/version_signature (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'generic', uname: '5.15.0-91-generic', upstream: '5.15.131' },
  { fixture: 'hwe-backport', uname: '7.0.0-28-generic', upstream: '7.0.12' },
  { fixture: 'cloud-azure', uname: '5.15.0-1053-azure', upstream: '5.15.131' },
  { fixture: 'lowlatency', uname: '6.8.0-31-lowlatency', upstream: '6.8.1' },
  { fixture: 'raspi', uname: '6.8.0-1008-raspi', upstream: '6.8.0' },
  { fixture: 'legacy-lucid', uname: '2.6.32-21-generic', upstream: '2.6.32.11+drm33.2' },
])('VersionSignatureApp with whatever the server serves: $fixture', (each) => {
  it(`reads ${each.uname} running ${each.upstream}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: each.fixture }));
    render(<VersionSignatureApp />);

    await screen.findByRole('table', { name: 'Version signature fields' });
    expect(stat('uname -r says')).toHaveTextContent(each.uname);
    expect(stat('really running')).toHaveTextContent(each.upstream);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
