import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readVersionFixture as version } from './test/fixtures';
import { VersionApp } from './VersionApp';

/** Stands in for the backend serving /proc/version. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/version') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? version(options.fixture ?? 'ubuntu-desktop'), {
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

describe('VersionApp', () => {
  it('requests /proc/version from its own path', async () => {
    render(<VersionApp />);

    await screen.findByRole('table');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/version',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('summarizes the kernel', async () => {
    render(<VersionApp />);

    expect(await screen.findByText('kernel')).toBeInTheDocument();
    expect(screen.getByText('kernel').previousSibling).toHaveTextContent('6.8.0');
    expect(screen.getByText('series').previousSibling).toHaveTextContent('6.8');
    expect(screen.getByText('flavour').previousSibling).toHaveTextContent('45-generic');
    expect(screen.getByText('preemption').previousSibling).toHaveTextContent('dynamic');
  });

  it('shows the build flags as chips', async () => {
    render(<VersionApp />);

    await screen.findByRole('table');
    expect(screen.getByText('Linux')).toBeInTheDocument();
    expect(screen.getByText('SMP')).toBeInTheDocument();
    expect(screen.getByText('PREEMPT_DYNAMIC')).toBeInTheDocument();
  });

  it('lays out the build in a field table', async () => {
    render(<VersionApp />);

    const table = await screen.findByRole('table');
    const field = (label: string) =>
      within(table).getByRole('rowheader', { name: label }).closest('tr')!;

    expect(within(field('Release')).getByText('6.8.0-45-generic')).toBeInTheDocument();
    expect(field('Build')).toHaveTextContent('#45 (Ubuntu)');
    expect(field('Built by')).toHaveTextContent('buildd on lcy02-amd64-098');
    expect(field('Built')).toHaveTextContent('Fri Aug 30 12:02:04 UTC 2024');
  });

  it('lists every compiler the banner names', async () => {
    render(<VersionApp />);

    const table = await screen.findByRole('table');
    const toolchain = within(table).getByRole('rowheader', { name: 'Toolchain' }).closest('tr')!;

    expect(within(toolchain).getAllByRole('listitem')).toHaveLength(2);
    expect(within(toolchain).getByText(/GNU ld/)).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<VersionApp />);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent(version('ubuntu-desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<VersionApp />);

    await screen.findByRole('table');
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file is not a version banner', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<VersionApp />);

    expect(await screen.findByText(/not a kernel version banner/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<VersionApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/version (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including a 2.6 kernel that names no PREEMPT flag at all.
describe.each([
  { fixture: 'ubuntu-desktop', kernel: '6.8.0', preemption: 'dynamic' },
  { fixture: 'debian-server', kernel: '6.1.0', preemption: 'dynamic' },
  { fixture: 'rpi-arm64', kernel: '6.6.31', preemption: 'voluntary' },
  { fixture: 'legacy-centos', kernel: '2.6.32', preemption: 'none' },
  { fixture: 'rt-preempt', kernel: '6.1.59', preemption: 'realtime' },
])('VersionApp with whatever the server serves: $fixture', ({ fixture, kernel, preemption }) => {
  it(`renders ${kernel}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<VersionApp />);

    await screen.findByRole('table');
    expect(screen.getByText('kernel').previousSibling).toHaveTextContent(kernel);
    expect(screen.getByText('preemption').previousSibling).toHaveTextContent(preemption);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
