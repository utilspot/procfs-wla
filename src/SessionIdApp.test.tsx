import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSessionIdFixture as sessionid } from './test/fixtures';
import { SessionIdApp } from './SessionIdApp';

/**
 * Stands in for the backend serving /proc/<pid>/sessionid. A fixture is a
 * machine with a few processes in it, so this answers per pid and 404s for one
 * it does not have — the same as the mock server.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: string; only?: string[] } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/sessionid$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    const pid = match[1]!;
    if (options.only !== undefined && !options.only.includes(pid)) {
      return new Response(`no such file: ${url.pathname}`, { status: 404, statusText: 'Not Found' });
    }

    return new Response(options.body ?? sessionid(options.fixture ?? 'desktop', pid), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** Opens the page at the URL that names a process, which is what it reads. */
function open(process = 'self') {
  window.history.replaceState({}, '', `/${process}/sessionid`);
}

const summary = () => screen.findByTestId('summary');
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  open();
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  open();
});

describe('SessionIdApp', () => {
  it('reads /proc/self/sessionid when no process is named', async () => {
    render(<SessionIdApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/self/sessionid',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/self/sessionid');
  });

  it('reads the process its own URL names', async () => {
    open('12282');
    render(<SessionIdApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith('/0/api/file/12282/sessionid', expect.anything());
  });

  it('shows the session a login was given', async () => {
    render(<SessionIdApp />);

    await summary();
    expect(stat('audit session')).toHaveTextContent('2');
    expect(screen.queryByTestId('unset')).not.toBeInTheDocument();
  });

  /** The whole point of the file: one login, one number, across the tree. */
  it('shows the same session for two processes of one login', async () => {
    render(<SessionIdApp />);
    await summary();
    expect(stat('audit session')).toHaveTextContent('2');

    open('12282');
    vi.stubGlobal('fetch', mockServer());
    render(<SessionIdApp />);

    await screen.findAllByTestId('summary');
    expect(screen.getAllByText('audit session')).toHaveLength(2);
  });

  /**
   * `4294967295` is `(unsigned int)-1`, which is the kernel saying no login
   * session owns this process — not session zero.
   */
  it('says an unset id means no login session, rather than session zero', async () => {
    open('1');
    render(<SessionIdApp />);

    await summary();
    expect(await screen.findByTestId('unset')).toHaveTextContent('no login session owns');
    expect(stat('no login session')).toHaveTextContent('—');
    expect(stat('raw value')).toHaveTextContent('4294967295');
  });

  it('does not take session zero for an unset one', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '0' }));
    render(<SessionIdApp />);

    await summary();
    expect(stat('audit session')).toHaveTextContent('0');
    expect(screen.queryByTestId('unset')).not.toBeInTheDocument();
  });

  it('reads a machine with two logins on it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'two-logins' }));
    open('5150');
    render(<SessionIdApp />);

    await summary();
    expect(stat('audit session')).toHaveTextContent('3');
  });

  /**
   * Two files carry the word "session" and describe unrelated things, one of
   * which is a pid. The page has to say which of them this is not.
   */
  it('says it is not the session setsid makes', async () => {
    render(<SessionIdApp />);

    await summary();
    const note = screen.getByText(/setsid/).closest('p')!;

    expect(note).toHaveTextContent('audit');
    expect(note).toHaveTextContent('field 6 of /proc/<pid>/stat');
    expect(note).toHaveTextContent('survives su and sudo');
  });

  it('says so when the file holds no number', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'none' }));
    render(<SessionIdApp />);

    expect(await screen.findByTestId('unreadable')).toHaveTextContent('does not hold a number');
  });

  it('says so when the file is empty', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<SessionIdApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('nothing in this file');
  });

  /** The kernel writes no newline, so one that turns up is worth reporting. */
  it('notices a trailing newline the kernel would not have written', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '2\n' }));
    render(<SessionIdApp />);

    expect(await screen.findByTestId('terminated')).toHaveTextContent('ends with a newline');
  });

  /** Which processes exist is the backend's answer to give, not this page's. */
  it.each(['root', '0', '12345678'])('asks for %o, and reports the 404', async (pid) => {
    vi.stubGlobal('fetch', mockServer({ only: ['self'] }));
    open(pid);
    render(<SessionIdApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Failed to read /proc/${pid}/sessionid (HTTP 404 Not Found)`,
    );
  });

  it('offers the raw view like every other page', async () => {
    render(<SessionIdApp />);

    await summary();
    await userEvent.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByTestId('raw-file')).toHaveTextContent('2');
  });
});
