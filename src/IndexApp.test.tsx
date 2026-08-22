import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { IndexApp } from './IndexApp';
import { DT_DIR, DT_REG, type Listing } from './lib/directory';

/**
 * Stands in for the backend listing `/proc`: a few of its own directories, a
 * file with a page and one without, and a handful of processes.
 */
const LISTING: Listing = {
  sys: DT_DIR,
  net: DT_DIR,
  cpuinfo: DT_REG,
  meminfo: DT_REG,
  'key-users': DT_REG,
  stat: DT_REG,
  cmdline: DT_REG,
  kmsg: DT_REG,
  'sysrq-trigger': DT_REG,
  self: DT_DIR,
  1: DT_DIR,
  12282: DT_DIR,
};

function mockServer(options: { listing?: Listing; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/dir/') {
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    if (options.body !== undefined) {
      return new Response(options.body, { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(options.listing ?? LISTING), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

/** The sections the listing is laid out in, each a labelled region. */
const files = () => screen.findByRole('region', { name: 'Files' });
const directories = () => screen.getByRole('region', { name: 'Directories' });
const processes = () => screen.getByRole('region', { name: 'Processes' });

/** A tile, wherever in the listing it is. */
const tileFor = (name: string): HTMLElement => screen.getByText(name).closest('li')!;

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IndexApp', () => {
  /**
   * `/proc` itself is the one thing this page reads, and it reads it from the
   * listing endpoint — `/0/api/dir/`, beside the bytes at `/0/api/file`. The
   * trailing slash is what asks for the root; without it the backend reads
   * past the end of the URL.
   */
  it('lists /proc from the listing endpoint', async () => {
    render(<IndexApp />);

    await files();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/dir/',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc');
  });

  it('says it is listing before the answer arrives', () => {
    render(<IndexApp />);

    expect(screen.getByRole('status')).toHaveTextContent('Listing /proc');
  });

  it('reports a failed listing', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<IndexApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to list /proc (HTTP 404 Not Found)',
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  /** An error page parses as JSON never, but an array would, and is not one. */
  it('refuses an answer that is not a directory listing', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '["cpuinfo","meminfo"]' }));
    render(<IndexApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent('not a directory listing');
  });

  it('says so when the answer is not JSON at all', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '<!doctype html><title>nope</title>' }));
    render(<IndexApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent('was not JSON');
  });

  /** A directory that reads empty is an answer, not a failure. */
  it('says so when the directory reads empty', async () => {
    vi.stubGlobal('fetch', mockServer({ listing: {} }));
    render(<IndexApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('/proc');
  });

  /**
   * The processes are hundreds of numbered directories on a real machine, and
   * the files anyone came to read would be lost among them.
   */
  it('puts the processes in a section of their own', async () => {
    render(<IndexApp />);

    await files();
    expect(within(processes()).getByText('1')).toBeInTheDocument();
    expect(within(await files()).queryByText('1')).not.toBeInTheDocument();
    expect(within(processes()).queryByText('cpuinfo')).not.toBeInTheDocument();
  });

  it('counts each section beside its heading', async () => {
    render(<IndexApp />);

    // Counted off the listing rather than written out, so the two cannot drift.
    const kinds = Object.entries(LISTING);
    const shown = (n: number) => kinds.filter(([, type]) => type === n).length;
    const pids = kinds.filter(([name, type]) => type === DT_DIR && name !== 'sys' && name !== 'net');

    expect(within(await files()).getByRole('heading')).toHaveTextContent(`Files${shown(DT_REG)}`);
    expect(within(directories()).getByRole('heading')).toHaveTextContent('Directories2');
    expect(within(processes()).getByRole('heading')).toHaveTextContent(`Processes${pids.length}`);
  });

  /**
   * Every entry links at its own name, the way the directory names it. A file
   * this app parses lands on its page because that page is served at the same
   * URL — the listing does not know or care which files those are.
   */
  it('links a file at its own name', async () => {
    render(<IndexApp />);

    await files();
    expect(within(tileFor('cpuinfo')).getByRole('link')).toHaveAttribute('href', 'cpuinfo');
    expect(within(tileFor('meminfo')).getByRole('link')).toHaveAttribute('href', 'meminfo');
    expect(within(tileFor('key-users')).getByRole('link')).toHaveAttribute('href', 'key-users');
  });

  /**
   * Including one no page here parses. There is nothing behind that URL yet,
   * and the server says so — a link that named some other viewer instead would
   * be this app deciding what a name means.
   */
  it('links a file it has no page for at its own name too', async () => {
    render(<IndexApp />);

    await files();
    expect(within(tileFor('kmsg')).getByRole('link')).toHaveAttribute('href', 'kmsg');
    expect(within(tileFor('sysrq-trigger')).getByRole('link')).toHaveAttribute(
      'href',
      'sysrq-trigger',
    );
  });

  /**
   * A directory keeps its trailing slash, which is what makes the next
   * listing's links resolve inside it rather than beside it.
   */
  it('links a directory at its own name, with the slash', async () => {
    render(<IndexApp />);

    await files();
    expect(within(directories()).getByText('sys').closest('a')).toHaveAttribute('href', 'sys/');
    expect(within(directories()).getByText('net').closest('a')).toHaveAttribute('href', 'net/');
  });

  /** A tile is an icon and a name; what kind of entry it is, the icon says. */
  it('puts nothing on a tile but its icon and its name', async () => {
    render(<IndexApp />);

    await files();
    expect(tileFor('cpuinfo').textContent).toBe('cpuinfo');
    expect(within(directories()).getByText('sys').textContent).toBe('sys');
  });

  /**
   * `/proc/stat` and `/proc/<pid>/stat` are different files. The listing is of
   * `/proc`, so `stat` there is the machine's, not any process's.
   */
  it('links the machine’s file, not the process file beside it', async () => {
    render(<IndexApp />);

    await files();
    expect(within(tileFor('stat')).getByRole('link')).toHaveAttribute('href', 'stat');
    expect(within(tileFor('cmdline')).getByRole('link')).toHaveAttribute('href', 'cmdline');
  });

  /** A tile carries the whole path, since the name alone can be ambiguous. */
  it('names every tile by the path it stands for', async () => {
    render(<IndexApp />);

    await files();
    expect(screen.getByText('cpuinfo')).toHaveAttribute('title', '/proc/cpuinfo');
    expect(within(directories()).getByText('sys')).toHaveAttribute('title', '/proc/sys');
  });

  /**
   * A process is a directory, so it goes the same way as any other — to its
   * own listing. Nothing lists a process directory yet, so that URL 404s for
   * now; the rule is what matters and the exception would have to be unlearned.
   */
  it('links a process at its own name, like any other directory', async () => {
    render(<IndexApp />);

    await files();
    expect(within(tileFor('self')).getByRole('link')).toHaveAttribute('href', 'self/');
    expect(within(tileFor('1')).getByRole('link')).toHaveAttribute('href', '1/');
    expect(within(tileFor('12282')).getByRole('link')).toHaveAttribute('href', '12282/');
  });

  /** Everything is a link. What is behind it is the server's answer to give. */
  it('leaves nothing unlinked', async () => {
    render(<IndexApp />);
    await files();

    const names = Object.keys(LISTING);
    // Bar the footer's, which leads to the source rather than into the listing.
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));

    expect(links).toHaveLength(names.length);
    for (const link of links) {
      // Relative, so it resolves inside the directory being listed.
      expect(link.getAttribute('href')).not.toMatch(/^[/.]/);
    }
  });
});
