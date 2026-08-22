import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RawApp } from './RawApp';
import { PATH_MAX } from './pages';

const KMSG = '<4>[  0.000000] Linux version 6.8.0-45-generic\n<6>[  0.000000] Command line: ro\n';

/** Stands in for the backend serving a file at its own path under /0/api/file. */
function mockServer(options: { path?: string; body?: string; failWith?: number } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== (options.path ?? '/0/api/file/kmsg')) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    return new Response(options.body ?? KMSG, { headers: { 'Content-Type': 'text/plain' } });
  });
}

/**
 * Opens the page at the URL that names the file. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(url = '/kmsg') {
  window.history.replaceState({}, '', url);
}

const raw = () => screen.findByTestId('raw-file');

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open('/');
});

describe('RawApp', () => {
  /** The URL is the path: `/kmsg` reads `/proc/kmsg` from `/0/api/file/kmsg`. */
  it('reads the file its own URL names', async () => {
    render(<RawApp />);

    await raw();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/kmsg',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/kmsg');
  });

  it('reads one nested any number of directories down', async () => {
    vi.stubGlobal('fetch', mockServer({ path: '/0/api/file/sys/kernel/osrelease' }));
    open('/sys/kernel/osrelease');
    render(<RawApp />);

    await raw();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/sys/kernel/osrelease', expect.anything());
  });

  /** The bytes as they came — no parsing, and so no view to switch to. */
  it('shows the file unchanged, and offers no view toggle', async () => {
    render(<RawApp />);

    expect(await raw()).toHaveTextContent('Linux version 6.8.0-45-generic');
    expect(screen.queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument();
  });

  /**
   * The bytes are the whole of what this page shows: nothing counts them, and
   * nothing is put beside them.
   */
  it('shows the file and nothing else', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'é\nsecond\n' }));
    render(<RawApp />);

    await raw();
    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.queryByText('bytes')).not.toBeInTheDocument();
    expect(screen.queryByText('lines')).not.toBeInTheDocument();
  });

  it('says it is reading before the answer arrives', () => {
    render(<RawApp />);

    expect(screen.getByRole('status')).toHaveTextContent('Reading /proc/kmsg');
  });

  /** Whether the file is there at all is the backend's answer to give. */
  it('reports a file the backend does not serve', async () => {
    open('/nosuchthing');
    render(<RawApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/nosuchthing (HTTP 404 Not Found)',
    );
  });

  /** Under /proc an empty file is often the answer rather than a failure. */
  it('says so when the file reads empty', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<RawApp />);

    expect(await screen.findByTestId('empty')).toBeInTheDocument();
    expect(screen.queryByTestId('raw-file')).not.toBeInTheDocument();
  });

  it('refuses a URL naming a path it will not read', () => {
    // A browser resolves `..` out of a URL before the page ever sees it; what
    // reaches here is a path that is simply longer than the app will ask for.
    open(`/${'x'.repeat(PATH_MAX)}`);
    render(<RawApp />);

    expect(screen.getByRole('alert')).toHaveTextContent('is not a path this app will read');
    expect(fetch).not.toHaveBeenCalled();
  });
});
