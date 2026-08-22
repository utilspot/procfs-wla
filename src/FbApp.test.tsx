import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFbFixture as fb } from './test/fixtures';
import { FbApp } from './FbApp';

/** Stands in for the backend serving /proc/fb. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/fb') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? fb(options.fixture ?? 'dual-gpu'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Registered framebuffers' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a device path, matched on its first cell. */
const rowFor = async (device: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === device)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FbApp', () => {
  it('requests /proc/fb from its own path', async () => {
    render(<FbApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/fb',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per registered framebuffer', async () => {
    render(<FbApp />);

    expect(within(await table()).getAllByRole('row')).toHaveLength(2 + 1);
    expect(await rowFor('/dev/fb0')).toHaveTextContent('inteldrmfb');
    expect(await rowFor('/dev/fb1')).toHaveTextContent('nouveaufb');
  });

  it('summarizes the framebuffers and where they came from', async () => {
    render(<FbApp />);

    expect(await screen.findByText('framebuffers')).toBeInTheDocument();
    expect(stat('framebuffers')).toHaveTextContent('2');
    expect(stat('DRM')).toHaveTextContent('2');
    expect(stat('firmware')).toHaveTextContent('0');
  });

  // The `drmfb` suffix is the only thing separating DRM's fbdev emulation
  // from a native fbdev driver.
  it('marks a DRM framebuffer as such', async () => {
    render(<FbApp />);

    expect(
      within(await rowFor('/dev/fb0')).getByTitle(
        "A modern DRM driver's fbdev emulation, not a native fbdev driver",
      ),
    ).toBeInTheDocument();
  });

  it('names the driver behind a firmware framebuffer', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'efi-firmware' }));
    render(<FbApp />);

    const row = await rowFor('/dev/fb0');
    expect(within(row).getByTitle('Set up by efifb')).toBeInTheDocument();
    expect(within(row).getByText('firmware')).toBeInTheDocument();
  });

  /**
   * A firmware framebuffer paints into the buffer the firmware left running,
   * so seeing nothing else means no driver has taken over the hardware.
   */
  it('says when nothing has taken over from the firmware', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'efi-firmware' }));
    render(<FbApp />);

    expect(await screen.findByText(/no driver has taken over the hardware/i)).toBeInTheDocument();
  });

  it('says nothing of the sort once a real driver is registered', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '0 EFI VGA\n1 inteldrmfb\n' }));
    render(<FbApp />);

    await table();
    expect(screen.queryByText(/no driver has taken over the hardware/i)).not.toBeInTheDocument();
    expect(stat('firmware')).toHaveTextContent('1');
  });

  it('marks a native fbdev driver as neither DRM nor firmware', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-matrox' }));
    render(<FbApp />);

    const row = await rowFor('/dev/fb0');
    expect(row).toHaveTextContent('MATROX MGA-G400');
    expect(within(row).getByTitle('A native fbdev driver, of which few remain')).toBeInTheDocument();
  });

  /**
   * An empty file is a machine that registered no framebuffer, which is
   * normal on a server — not an error and not an empty table.
   */
  it('explains a machine with no framebuffer at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'headless-server' }));
    render(<FbApp />);

    expect(await screen.findByText(/no framebuffer is registered/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The number is the node, so a gap is a framebuffer that was unregistered.
  it('names the device from the node rather than the row', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '1 radeondrmfb\n' }));
    render(<FbApp />);

    expect(await rowFor('/dev/fb1')).toHaveTextContent('radeondrmfb');
    expect(within(await table()).getAllByRole('row')).toHaveLength(1 + 1);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<FbApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(fb('dual-gpu'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<FbApp />);

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
    render(<FbApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/fb (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine with no framebuffer at all.
describe.each([
  { fixture: 'intel-laptop', total: '1' },
  { fixture: 'efi-firmware', total: '1' },
  { fixture: 'dual-gpu', total: '2' },
  { fixture: 'legacy-matrox', total: '1' },
])('FbApp with whatever the server serves: $fixture', ({ fixture, total }) => {
  it(`renders ${total} framebuffers`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<FbApp />);

    await table();
    expect(stat('framebuffers')).toHaveTextContent(total);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
