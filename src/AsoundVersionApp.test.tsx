import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readAsoundVersionFixture as asound } from './test/fixtures';
import { AsoundVersionApp } from './AsoundVersionApp';

/** Stands in for the backend serving /proc/asound/version. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/asound/version') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? asound(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'ALSA version fields' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for one piece of the line. */
const rowFor = async (label: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === label)!;
};

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/asound/version');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('AsoundVersionApp', () => {
  it('requests /proc/asound/version from its own path', async () => {
    render(<AsoundVersionApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/asound/version',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('leads with what the file says and what that turns out to be', async () => {
    render(<AsoundVersionApp />);

    await table();
    expect(stat('file says')).toHaveTextContent('k6.8.0-45-generic');
    expect(stat('which is')).toHaveTextContent('the kernel release');
    expect(stat('series')).toHaveTextContent('6.8');
    expect(stat('local version')).toHaveTextContent('45-generic');
  });

  /** Which is the whole reason this file is read wrong. */
  it('says the version is the kernel release rather than an ALSA one', async () => {
    render(<AsoundVersionApp />);

    const notice = await screen.findByTestId('kernel-release');
    expect(notice).toHaveTextContent('This is the kernel release, not an ALSA version');
    expect(notice).toHaveTextContent('6.8.0-45-generic');
    expect(notice).toHaveTextContent('alsa-lib carries its own version');
  });

  it('takes the line apart a piece at a time, the literal k among them', async () => {
    render(<AsoundVersionApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(6 + 1);
    expect(await rowFor('k')).toHaveTextContent('literal in the format string');
    expect(await rowFor('kernel release')).toHaveTextContent('6.8.0-45-generic');
    expect(await rowFor('local version')).toHaveTextContent('45-generic');
  });

  it('says nothing about a build outside the tree on a kernel that printed none', async () => {
    render(<AsoundVersionApp />);

    await table();
    expect(screen.getByTestId('flags')).not.toHaveTextContent('out-of-tree');
    expect(screen.queryByTestId('alsa-release')).not.toBeInTheDocument();
  });

  it('reads a vendor release whose local version starts with a +', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raspberry-pi' }));
    render(<AsoundVersionApp />);

    await table();
    expect(stat('series')).toHaveTextContent('6.6');
    expect(stat('local version')).toHaveTextContent('rpt-rpi-v8');
  });

  it('leaves out the local version tile for a release with nothing appended', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'mainline' }));
    render(<AsoundVersionApp />);

    await table();
    expect(stat('series')).toHaveTextContent('6.10');
    expect(within(screen.getByTestId('summary')).queryByText('local version')).toBeNull();
  });

  describe('a kernel from before the version was the kernel’s', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'alsa-1.0' }));
    });

    it('reads the number as ALSA’s own and dates the kernel by it', async () => {
      render(<AsoundVersionApp />);

      const notice = await screen.findByTestId('alsa-release');
      expect(notice).toHaveTextContent('This kernel is older than 3.7');
      expect(notice).toHaveTextContent('1.0.25');
      expect(stat('which is')).toHaveTextContent("ALSA's own release");
    });

    it('shows no series it was never given', async () => {
      render(<AsoundVersionApp />);

      await table();
      expect(within(screen.getByTestId('summary')).queryByText('series')).toBeNull();
      expect(screen.queryByTestId('kernel-release')).not.toBeInTheDocument();
    });
  });

  it('shows the date CONFIG_SND_DATE carried', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'dated-build' }));
    render(<AsoundVersionApp />);

    await table();
    expect(screen.getByTestId('flags')).toHaveTextContent('dated Thu Apr 30 09:34:12 2009 UTC');
    expect(await rowFor('build date')).toHaveTextContent('empty in the kernel tree');
  });

  describe('the packaged alsa-driver build', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'out-of-tree' }));
    });

    it('reads the compile line under the banner', async () => {
      render(<AsoundVersionApp />);

      await table();
      expect(stat('built for')).toHaveTextContent('2.6.32-24-generic');
      expect(await rowFor('compiled on')).toHaveTextContent('Aug 11 2010');
      expect(await rowFor('SMP')).toHaveTextContent('CONFIG_SMP');
    });

    it('marks it as built outside the kernel tree', async () => {
      render(<AsoundVersionApp />);

      await table();
      const flags = screen.getByTestId('flags');
      expect(within(flags).getByText('out-of-tree build')).toBeInTheDocument();
      expect(within(flags).getByText('SMP')).toBeInTheDocument();
    });
  });

  /** The compile line is fixed at build time; the release above it is read now. */
  it('warns when the module was built against another kernel', async () => {
    vi.stubGlobal(
      'fetch',
      mockServer({
        body:
          'Advanced Linux Sound Architecture Driver Version k6.8.0-45-generic.\n' +
          'Compiled on Aug 11 2010 for kernel 2.6.32-24-generic (SMP).\n',
      }),
    );
    render(<AsoundVersionApp />);

    expect(await screen.findByTestId('built-elsewhere')).toHaveTextContent(
      'built against one kernel and loaded into another',
    );
  });

  it('says a version of neither shape is neither', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'Advanced Linux Sound Architecture Driver Version vendor-audio-2024.3.\n' }));
    render(<AsoundVersionApp />);

    expect(await screen.findByTestId('unknown-form')).toHaveTextContent(
      'neither shape this file has ever had',
    );
    expect(stat('which is')).toHaveTextContent('neither');
  });

  it('flags a line the kernel did not end with a full stop', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'Advanced Linux Sound Architecture Driver Version k6.8.0-45-generic\n' }));
    render(<AsoundVersionApp />);

    await table();
    expect(screen.getByTestId('flags')).toHaveTextContent('no trailing full stop');
  });

  it('says a file that is not this file is not this file', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'Linux version 6.8.0-45-generic\n' }));
    render(<AsoundVersionApp />);

    expect(await screen.findByText(/No ALSA banner in this file/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<AsoundVersionApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(asound('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<AsoundVersionApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /**
   * A machine that has never loaded `snd` has neither this file nor the
   * directory around it, which is what three of the five captures here are.
   */
  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<AsoundVersionApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/asound/version (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'desktop', says: 'k6.8.0-45-generic', is: 'the kernel release' },
  { fixture: 'raspberry-pi', says: 'k6.6.31+rpt-rpi-v8', is: 'the kernel release' },
  { fixture: 'mainline', says: 'k6.10.0', is: 'the kernel release' },
  { fixture: 'alsa-1.0', says: '1.0.25', is: "ALSA's own release" },
  { fixture: 'dated-build', says: '1.0.20', is: "ALSA's own release" },
  { fixture: 'out-of-tree', says: '1.0.23', is: "ALSA's own release" },
])('AsoundVersionApp with whatever the server serves: $fixture', (each) => {
  beforeEach(() => {
    window.history.pushState({}, '', '/asound/version');
    vi.stubGlobal('fetch', mockServer({ fixture: each.fixture }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it(`reads ${each.says} as ${each.is}`, async () => {
    render(<AsoundVersionApp />);

    await table();
    expect(stat('file says')).toHaveTextContent(each.says);
    expect(stat('which is')).toHaveTextContent(each.is);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
