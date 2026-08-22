import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readPidStatFixture as pidStat } from './test/fixtures';
import { PidStatApp } from './PidStatApp';

/**
 * Stands in for the backend serving /proc/<pid>/stat. A fixture is a machine
 * with a few processes in it, so this answers per pid and 404s for one it does
 * not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/stat$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? pidStat(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/**
 * Opens the page at the URL that names a process. The page reads the path its
 * URL spells, so this is the whole of what decides which file is read.
 */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/stat`);
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const table = () => screen.findByRole('table', { name: 'Fields' });

/** One row of the field table, by the field it is for. */
const row = (name: string): HTMLElement =>
  within(screen.getByRole('table', { name: 'Fields' }))
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryAllByRole('cell')[1]?.textContent === name)!;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('PidStatApp', () => {
  /** No pid given reads `self`, which is a real path rather than a guess. */
  it('reads /proc/self/stat when no process is named', async () => {
    render(<PidStatApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/stat',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    // Which process was read is said once, in the page's heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/stat');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<PidStatApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/stat', expect.anything());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/12282/stat');
  });

  /**
   * Which processes exist is the backend's answer to give, not this page's to
   * guess: a URL naming one that is not there is asked for and the 404 shown.
   */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<PidStatApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`HTTP 404`);
    expect(fetch).toHaveBeenCalledWith(`/0/api/file/${pid}/stat`, expect.anything());
  });

  it('accepts the kernel’s own symbolic names', async () => {
    // No fixture has a thread-self directory, so serve one body for any pid:
    // what matters here is that the value is accepted and reaches the path.
    vi.stubGlobal('fetch', mockServer({ body: pidStat('desktop', 'self') }));
    open('thread-self');
    render(<PidStatApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/thread-self/stat', expect.anything());
  });

  it('summarizes the process in the four things usually wanted', async () => {
    render(<PidStatApp />);

    await table();
    expect(stat('name')).toHaveTextContent('bash');
    expect(stat('state')).toHaveTextContent('sleeping');
    expect(stat('CPU used')).toHaveTextContent('0.21 s');
    expect(stat('resident')).toHaveTextContent('6.1 MiB');
  });

  it('gives a row per field, numbered as proc(5) numbers them', async () => {
    render(<PidStatApp />);

    await table();
    expect(within(row('pid')).getAllByRole('cell')[0]).toHaveTextContent('1');
    expect(within(row('state')).getAllByRole('cell')[0]).toHaveTextContent('3');
    expect(within(row('rss')).getAllByRole('cell')[0]).toHaveTextContent('24');
    expect(within(row('exit_code')).getAllByRole('cell')[0]).toHaveTextContent('52');
  });

  /** Two units in one line, and neither is named in it. */
  it('reads rss as the pages it is and vsize as the bytes it is', async () => {
    render(<PidStatApp />);

    await table();
    expect(within(row('rss')).getAllByRole('cell')[2]).toHaveTextContent('1568');
    expect(within(row('rss')).getAllByRole('cell')[3]).toHaveTextContent('6.1 MiB');
    expect(within(row('vsize')).getAllByRole('cell')[3]).toHaveTextContent('12 MiB');
  });

  it('reads the times as the clock ticks they are', async () => {
    open('12282');
    render(<PidStatApp />);

    await table();
    expect(within(row('utime')).getAllByRole('cell')[2]).toHaveTextContent('4213');
    expect(within(row('utime')).getAllByRole('cell')[3]).toHaveTextContent('42.1 s');
  });

  it('keeps the raw value beside what it is taken to mean', async () => {
    render(<PidStatApp />);

    await table();
    expect(within(row('starttime')).getAllByRole('cell')[2]).toHaveTextContent('8127');
  });

  /** `priority` is not `nice`, and says different things per policy. */
  it('reads the priority field on the kernel’s own scale', async () => {
    render(<PidStatApp />);

    await table();
    expect(screen.getByTestId('flags')).toHaveTextContent('nice 0 on the kernel’s 0–39 scale');
    expect(screen.getByTestId('flags')).toHaveTextContent('SCHED_OTHER');
  });

  it('reads a real-time task’s priority as the negated one it is', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'realtime' }));
    render(<PidStatApp />);

    await table();
    expect(screen.getByTestId('flags')).toHaveTextContent('real-time priority 50');
    expect(screen.getByTestId('flags')).toHaveTextContent('SCHED_FIFO');
  });

  it('explains the state letter rather than only printing it', async () => {
    render(<PidStatApp />);

    await table();
    expect(screen.getByTestId('state')).toHaveTextContent('interruptible');
  });

  /** The state a process cannot be killed out of. */
  it('calls out a process in uninterruptible sleep, and what it waits on', async () => {
    open('3117');
    render(<PidStatApp />);

    await table();
    expect(screen.getByTestId('uninterruptible')).toHaveTextContent('cannot be killed');
    expect(screen.getByTestId('uninterruptible')).toHaveTextContent('44.7 s');
  });

  it('calls out a zombie, and why its memory reads as zero', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'zombie' }));
    open('4242');
    render(<PidStatApp />);

    await table();
    expect(screen.getByTestId('zombie')).toHaveTextContent('exited and not been reaped');
    expect(stat('resident')).toHaveTextContent('0 B');
  });

  /**
   * The name is the only free-form field, so it is what breaks a parser that
   * splits on whitespace — and the page says so where it would have.
   */
  it('reads a name with parentheses in it, and says why that matters', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'awkward-name' }));
    render(<PidStatApp />);

    await table();
    expect(stat('name')).toHaveTextContent('(sd-pam)');
    expect(screen.getByTestId('awkward')).toHaveTextContent('parentheses');
    expect(screen.getByTestId('awkward')).toHaveTextContent('reads every field after it wrong');
    expect(within(row('ppid')).getAllByRole('cell')[2]).toHaveTextContent('1788');
  });

  it('is not fooled by a name shaped like the rest of the line', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'awkward-name' }));
    open('5150');
    render(<PidStatApp />);

    await table();
    // A naive split would have shown state R and parent 1.
    expect(stat('state')).toHaveTextContent('sleeping');
    expect(within(row('ppid')).getAllByRole('cell')[2]).toHaveTextContent('4021');
    expect(within(row('processor')).getAllByRole('cell')[2]).toHaveTextContent('2');
  });

  it('says which characters in a name would have broken such a parser', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'awkward-name' }));
    open('5150');
    render(<PidStatApp />);

    await table();
    // This one holds both, and both are named rather than only the first.
    expect(screen.getByTestId('awkward')).toHaveTextContent('parentheses and spaces');
  });

  it('warns where the name is at the length the kernel truncates to', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'awkward-name' }));
    open('901');
    render(<PidStatApp />);

    await table();
    expect(screen.getByTestId('flags')).toHaveTextContent('name may be cut short');
  });

  it('says nothing of the sort about an ordinary name', async () => {
    render(<PidStatApp />);

    await table();
    expect(screen.queryByTestId('awkward')).not.toBeInTheDocument();
    expect(screen.getByTestId('flags')).not.toHaveTextContent('name may be cut short');
  });

  /** Ten of the fields are printed and kept up to date by nothing. */
  it('marks the fields nothing maintains, and can fold them away', async () => {
    const user = userEvent.setup();
    render(<PidStatApp />);

    await table();
    expect(within(row('nswap')).getByText('not maintained')).toHaveAttribute(
      'title',
      expect.stringContaining('Never maintained'),
    );
    expect(within(row('wchan')).getByText('not maintained')).toHaveAttribute(
      'title',
      expect.stringContaining('4.9'),
    );

    await user.click(screen.getByRole('checkbox', { name: /Hide the fields nothing maintains/ }));

    expect(screen.queryAllByText('not maintained')).toHaveLength(0);
    expect(within(screen.getByRole('table', { name: 'Fields' })).getAllByRole('row')).toHaveLength(
      // 52 fields less the 10 dead ones, plus the header row.
      52 - 10 + 1,
    );
  });

  /** The last eight fields arrived in 3.3 and 3.5. */
  it('reads an older kernel’s file without inventing the fields it lacks', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    render(<PidStatApp />);

    await table();
    expect(screen.getByRole('checkbox', { name: /10 of 44/ })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'exit_code' })).not.toBeInTheDocument();
    expect(within(row('cguest_time')).getAllByRole('cell')[0]).toHaveTextContent('44');
  });

  it('reports a process the backend does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open('4242');
    render(<PidStatApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/stat (HTTP 404 Not Found)',
    );
  });

  it('reports a line it cannot read rather than inventing one', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<PidStatApp />);

    expect(await screen.findByTestId('unreadable')).toHaveTextContent('It holds one line');
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<PidStatApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(pidStat('desktop', 'self').trim());
  });

  it('links nowhere but back up its own path', async () => {
    render(<PidStatApp />);

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
    render(<PidStatApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/self/stat (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, and every one of them has a
// `self` for the page opened without a pid.
describe.each([
  { fixture: 'desktop', fields: 52 },
  { fixture: 'awkward-name', fields: 52 },
  { fixture: 'zombie', fields: 52 },
  { fixture: 'realtime', fields: 52 },
  { fixture: 'legacy-2.6', fields: 44 },
])('PidStatApp with whatever the server serves: $fixture', ({ fixture, fields }) => {
  it(`reads ${fields} fields from self`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<PidStatApp />);

    const rows = within(await screen.findByRole('table', { name: 'Fields' })).getAllByRole('row');
    // One row per field, plus the header.
    expect(rows).toHaveLength(fields + 1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
