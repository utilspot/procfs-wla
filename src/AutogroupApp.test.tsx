import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readAutogroupFixture as autogroup } from './test/fixtures';
import { AutogroupApp } from './AutogroupApp';

/**
 * Stands in for the backend serving /proc/<pid>/autogroup, answering for
 * whichever process the URL names — which is what this page is about.
 */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/autogroup$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    if (options.body !== undefined) {
      return new Response(options.body, { headers: { 'Content-Type': 'text/plain' } });
    }

    try {
      return new Response(autogroup(options.fixture ?? 'desktop', match[1]!), {
        headers: { 'Content-Type': 'text/plain' },
      });
    } catch {
      // No such process in this fixture, which is what the real thing answers.
      return new Response('no such file', { status: 404, statusText: 'Not Found' });
    }
  });
}

const summary = () => screen.findByTestId('summary');

/** The tile under this label, whose value is the line above it. */
const statFor = async (label: string): Promise<HTMLElement> => {
  const tiles = within(await summary()).getAllByText(label);
  return tiles[0]!.parentElement!;
};

/** Opens the page at the URL naming one process, which is where it reads from. */
const openFor = (pid: string) => window.history.pushState({}, '', `/${pid}/autogroup`);

beforeEach(() => {
  openFor('self');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('AutogroupApp', () => {
  it('reads the process its own URL names', async () => {
    openFor('12282');
    render(<AutogroupApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/12282/autogroup',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('shows the group and its nice', async () => {
    render(<AutogroupApp />);

    expect(await statFor('autogroup')).toHaveTextContent('42');
    expect(await statFor('group nice')).toHaveTextContent('0');
    expect(await screen.findByTestId('line')).toHaveTextContent('/autogroup-42');
  });

  /** The number is what a reader compares against another process's page. */
  it('says what sharing the number means', async () => {
    render(<AutogroupApp />);

    const line = await screen.findByTestId('line');

    expect(line).toHaveTextContent('Everything in this task’s session is in group 42 with it');
    expect(line).toHaveTextContent('is in that session');
  });

  it('reads a different session through a different process', async () => {
    openFor('12282');
    render(<AutogroupApp />);

    expect(await statFor('autogroup')).toHaveTextContent('31');
  });

  it('reads one group through two processes of the same session', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'same-session' }));
    render(<AutogroupApp />);
    expect(await statFor('autogroup')).toHaveTextContent('57');

    openFor('5150');
    render(<AutogroupApp />);
    const both = await screen.findAllByTestId('summary');
    expect(both.at(-1)).toHaveTextContent('57');
  });

  /**
   * Not a failure: pid 1 is put in the default group at boot and cannot leave,
   * because `setsid()` is the only thing that moves a task and it already leads
   * its session.
   */
  it('explains an empty file rather than calling it broken', async () => {
    openFor('1');
    render(<AutogroupApp />);

    const empty = await screen.findByTestId('default-group');

    expect(empty).toHaveTextContent('autogroup_default');
    expect(empty).toHaveTextContent('never called setsid()');
    expect(empty).toHaveTextContent('not a fault and not a permission problem');
    expect(await statFor('autogroup')).toHaveTextContent('default');
    // Nothing to say about a weight that is not there.
    expect(screen.queryByTestId('line')).not.toBeInTheDocument();
  });

  it('turns the nice into the weight it is', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'reniced' }));
    render(<AutogroupApp />);

    expect(await statFor('group nice')).toHaveTextContent('10');
    expect(await statFor('scheduler weight')).toHaveTextContent('110');
    expect(await statFor('against a default group')).toHaveTextContent('a ninth of a default group');

    const reniced = await screen.findByTestId('reniced');
    expect(reniced).toHaveTextContent('Something has written to this file');
    expect(reniced).toHaveTextContent('against 1024 for a group nobody has touched');
    expect(reniced).toHaveTextContent('pushing a whole build session into the background');
  });

  it('reads a group given priority the other way', async () => {
    openFor('12282');
    vi.stubGlobal('fetch', mockServer({ fixture: 'long-uptime' }));
    render(<AutogroupApp />);

    expect(await statFor('scheduler weight')).toHaveTextContent('3121');
    expect(await screen.findByTestId('reniced')).toHaveTextContent(
      'a whole session given priority over the rest of the machine',
    );
  });

  it('says when nothing has written to the file', async () => {
    render(<AutogroupApp />);

    expect(await screen.findByTestId('untouched')).toHaveTextContent(
      'Nothing has written to this file',
    );
    expect(screen.queryByTestId('reniced')).not.toBeInTheDocument();
  });

  /** The one thing the file cannot tell you, on every page that shows a group. */
  it('warns that a group named here may not be the one scheduling the task', async () => {
    render(<AutogroupApp />);

    const caveat = await screen.findByTestId('caveat');

    expect(caveat).toHaveTextContent('never which one is deciding its CPU time');
    expect(caveat).toHaveTextContent('sched_autogroup_enabled');
    expect(caveat).toHaveTextContent('non-root CPU cgroup');
  });

  it('says the nice here is the group’s and not the process’s', async () => {
    render(<AutogroupApp />);

    await summary();
    expect(screen.getByText(/field 19 of/)).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<AutogroupApp />);
    await summary();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent(autogroup('desktop', 'self'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<AutogroupApp />);

    await summary();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file holds something else', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'autogroup-42\n' }));
    render(<AutogroupApp />);

    expect(await screen.findByTestId('unreadable')).toHaveTextContent(
      'does not hold an autogroup line',
    );
  });

  it('flags a line with the kernel’s newline trimmed off', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '/autogroup-42 nice 0' }));
    render(<AutogroupApp />);

    expect(await screen.findByTestId('unterminated')).toHaveTextContent(
      'does not end with a newline',
    );
  });

  it('reports a process that is not there', async () => {
    openFor('4242');
    render(<AutogroupApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/autogroup (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from an ordinary session to a task that never left the default.
describe.each([
  { fixture: 'desktop', pid: 'self', shows: '42' },
  { fixture: 'same-session', pid: '5150', shows: '57' },
  { fixture: 'reniced', pid: 'self', shows: '88' },
  { fixture: 'long-uptime', pid: 'self', shows: '284915' },
  { fixture: 'kernel-threads', pid: '74', shows: 'default' },
])('AutogroupApp with whatever the server serves: $fixture', ({ fixture, pid, shows }) => {
  it(`shows ${shows} for pid ${pid}`, async () => {
    openFor(pid);
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<AutogroupApp />);

    expect(await statFor('autogroup')).toHaveTextContent(shows);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
