import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SysVmParameterApp } from './SysVmParameterApp';
import { TUNABLES } from './lib/sys-vm';

/** Stands in for the backend serving one file of /proc/sys/vm. */
function mockServer(name: string, options: { body?: string; failWith?: number } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== `/0/api/file/sys/vm/${name}`) {
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? '60\n', { headers: { 'Content-Type': 'text/plain' } });
  });
}

/**
 * Opens the one page at the URL naming one of the fifty, as the server would:
 * the name is in the URL and nowhere else, which is where the page reads it.
 */
function open(name: string, options: Parameters<typeof mockServer>[1] = {}) {
  window.history.pushState({}, '', `/sys/vm/${name}`);
  vi.stubGlobal('fetch', mockServer(name, options));
  render(<SysVmParameterApp />);
}

/** The page, once the read has come back. */
const loaded = () => screen.findByTestId('summary');

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('SysVmParameterApp', () => {
  it('requests the file its own URL names, two directories down', async () => {
    open('swappiness');

    await loaded();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/sys/vm/swappiness',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/sys/vm/swappiness');
  });

  it('leads with the value, its unit and the mechanism it belongs to', async () => {
    open('swappiness');

    await loaded();
    expect(stat('value')).toHaveTextContent('60');
    expect(stat('set in')).toHaveTextContent('number');
    expect(stat('part of')).toHaveTextContent('Reclaim and watermarks');
    expect(screen.getByTestId('sets')).toHaveTextContent('prefers evicting anonymous pages');
  });

  /** The figure the kernel prints is not the figure a reader wants. */
  it('reads a threshold in the unit it is counted in', async () => {
    open('dirty_expire_centisecs', { body: '3000\n' });

    await loaded();
    expect(stat('value')).toHaveTextContent('30 s');
    expect(stat('as written')).toHaveTextContent('3000');
  });

  it('turns kilobytes into a size', async () => {
    open('min_free_kbytes', { body: '67584\n' });

    await loaded();
    expect(stat('value')).toHaveTextContent('66 MiB');
    expect(stat('as written')).toHaveTextContent('67584');
  });

  it('shows a percentage as one', async () => {
    open('dirty_ratio', { body: '20\n' });

    await loaded();
    expect(stat('value')).toHaveTextContent('20%');
    // Nothing is added where the reading and the figure are the same.
    expect(within(screen.getByTestId('summary')).queryByText('as written')).toBeNull();
  });

  it('says on or off for a toggle', async () => {
    open('defrag_mode', { body: '0\n' });

    await loaded();
    expect(stat('value')).toHaveTextContent('off');
    expect(stat('as written')).toHaveTextContent('0');
  });

  /** A mode is a number that means something rather than measures something. */
  it('says what the value means where the values are a set', async () => {
    open('overcommit_memory', { body: '0\n' });

    await loaded();
    expect(screen.getByTestId('meaning')).toHaveTextContent('heuristic');
    expect(screen.getByTestId('meaning')).toHaveTextContent('0 here means');
  });

  it('says nothing about a meaning for a value that is a scale', async () => {
    open('swappiness');

    await loaded();
    expect(screen.queryByTestId('meaning')).toBeNull();
  });

  /**
   * The trap this page exists to close: a 0 in one spelling of a paired
   * threshold does not mean the threshold is off.
   */
  it('warns that a paired file’s 0 means the other spelling is in force', async () => {
    open('dirty_ratio', { body: '0\n' });

    const notice = await screen.findByTestId('deferred');
    expect(notice).toHaveTextContent('does not mean the setting is off');
    expect(notice).toHaveTextContent('dirty_bytes');
  });

  it('says nothing of the kind for a paired file that is in force', async () => {
    open('dirty_ratio', { body: '20\n' });

    await loaded();
    expect(screen.queryByTestId('deferred')).toBeNull();
  });

  it('says a write-only file is written rather than read', async () => {
    open('drop_caches', { body: '0\n' });

    expect(await screen.findByTestId('trigger')).toHaveTextContent('written, not read');
    expect(stat('value')).toHaveTextContent('0');
  });

  /** One field per zone, which is a line rather than a number. */
  it('explains a file that holds a field per zone', async () => {
    open('lowmem_reserve_ratio', { body: '256\t256\t32\t0\t0\n' });

    await loaded();
    expect(stat('value')).toHaveTextContent('256 256 32 0 0');
    expect(screen.getByTestId('fields')).toHaveTextContent('5 fields');
  });

  it('shows the word the one text file holds', async () => {
    open('numa_zonelist_order', { body: 'Node\n' });

    await loaded();
    expect(stat('value')).toHaveTextContent('Node');
    expect(screen.getByTestId('meaning')).toHaveTextContent('only order there is');
  });

  it('says so when the file has nothing in it', async () => {
    open('swappiness', { body: '' });

    expect(await screen.findByTestId('unreadable')).toHaveTextContent('Nothing in this file');
  });

  it('reports a failed read', async () => {
    open('swappiness', { failWith: 404 });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/sys/vm/swappiness (HTTP 404 Not Found)',
    );
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    open('swappiness', { body: '60\n' });
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByTestId('raw-file')).toHaveTextContent('60', { normalizeWhitespace: false });
    expect(screen.queryByTestId('summary')).toBeNull();
  });

  it('links nowhere but back up its own path', async () => {
    open('swappiness');

    await loaded();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(1);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /**
   * One document answers for the fifty, so a name this app has no facts for is
   * something a reader can type — and it is answered rather than thrown.
   */
  it('refuses a URL naming a file it has no facts for', () => {
    window.history.pushState({}, '', '/sys/vm/nr_pdflush_threads');
    vi.stubGlobal('fetch', vi.fn());
    render(<SysVmParameterApp />);

    expect(screen.getByRole('alert')).toHaveTextContent('reads the one its own URL names');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/sys/vm');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses the document URL itself, which names no parameter', () => {
    window.history.pushState({}, '', '/sys/vm/parameter');
    render(<SysVmParameterApp />);

    expect(screen.getByRole('alert')).toHaveTextContent('reads the one its own URL names');
  });
});

// Every one of the tunables is answered by this one page, and each has to render
// the facts of its own file.
describe.each(TUNABLES.map((tunable) => ({ name: tunable.name, group: tunable.group })))(
  'SysVmParameterApp on $name',
  ({ name, group }) => {
    afterEach(() => {
      vi.unstubAllGlobals();
      window.history.pushState({}, '', '/');
    });

    it(`reads it and reports ${group}`, async () => {
      open(name, { body: '0\n' });

      await loaded();
      expect(stat('part of')).toHaveTextContent(group);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  },
);
