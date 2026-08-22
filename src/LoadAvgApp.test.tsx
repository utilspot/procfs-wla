import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readLoadAvgFixture as loadavg } from './test/fixtures';
import { LoadAvgApp } from './LoadAvgApp';

/** Stands in for the backend serving /proc/loadavg. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/loadavg') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? loadavg(options.fixture ?? 'idle-desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The three load figures, with the window each covers. */
const figures = async (): Promise<string[]> => {
  await screen.findByText('1 minute');
  return [...document.querySelectorAll('.load__figure')].map(
    (figure) => figure.textContent ?? '',
  );
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoadAvgApp', () => {
  it('requests /proc/loadavg from its own path', async () => {
    render(<LoadAvgApp />);

    await screen.findByText('1 minute');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/loadavg',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('shows the three averages against the windows they cover', async () => {
    render(<LoadAvgApp />);

    expect(await figures()).toEqual(['0.121 minute', '0.185 minutes', '0.2215 minutes']);
  });

  it('shows the counts the rest of the line holds', async () => {
    render(<LoadAvgApp />);

    await figures();
    expect(stat('runnable now')).toHaveTextContent('1');
    expect(stat('threads')).toHaveTextContent('1,043');
    expect(stat('not runnable')).toHaveTextContent('1,042');
    expect(stat('last PID')).toHaveTextContent('28,714');
  });

  /**
   * The figures are damped averages over different windows, so the short one
   * against the long one is the only direction the file can give.
   */
  it('reads a rising load off the short average against the long', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'busy-server' }));
    render(<LoadAvgApp />);

    expect(await screen.findByText('rising')).toHaveAttribute(
      'title',
      'The one-minute average is above the fifteen-minute one',
    );
  });

  it('reads a falling load the same way', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'recovering' }));
    render(<LoadAvgApp />);

    expect(await screen.findByText('falling')).toBeInTheDocument();
  });

  // A tenth of a load point on an idle machine is not a direction.
  it('calls a load that has barely moved steady', async () => {
    render(<LoadAvgApp />);

    expect(await screen.findByText('steady')).toBeInTheDocument();
  });

  /**
   * On Linux the load counts uninterruptible sleepers too, so a load of 8 with
   * one runnable thread is the case worth explaining.
   */
  it('explains a load standing well above the runnable count', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'io-stalled' }));
    render(<LoadAvgApp />);

    await figures();
    // The loading notice is a status too, but it is gone once content arrives.
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('7.02 above the 1 thread runnable');
    expect(notice).toHaveTextContent(/uninterruptible sleep/);
    // Said as a hint, since an average and an instant are being compared.
    expect(notice).toHaveTextContent(/Take it as a hint/);
  });

  it('says nothing of the sort when the load is under the runnable count', async () => {
    render(<LoadAvgApp />);

    await figures();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the two decimals the kernel prints, including a load of nothing', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'container' }));
    render(<LoadAvgApp />);

    expect(await figures()).toEqual(['0.001 minute', '0.015 minutes', '0.0515 minutes']);
    expect(stat('threads')).toHaveTextContent('12');
  });

  // The file says nothing about how many CPUs there are, so the page does not
  // call any load high.
  it('passes no judgement on whether the load is high', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'busy-server' }));
    render(<LoadAvgApp />);

    await figures();
    expect(screen.getByText(/how many CPUs there are/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says an unreadable file has no load rather than showing zeroes', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'nonsense\n' }));
    render(<LoadAvgApp />);

    expect(await screen.findByText(/no load average found/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.load__figure')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<LoadAvgApp />);
    await figures();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(document.querySelectorAll('.load__figure')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(loadavg('idle-desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<LoadAvgApp />);

    await figures();
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
    render(<LoadAvgApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/loadavg (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'idle-desktop', one: '0.12' },
  { fixture: 'busy-server', one: '12.44' },
  { fixture: 'io-stalled', one: '8.02' },
  { fixture: 'recovering', one: '0.84' },
  { fixture: 'container', one: '0.00' },
])('LoadAvgApp with whatever the server serves: $fixture', ({ fixture, one }) => {
  it(`renders a one-minute average of ${one}`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<LoadAvgApp />);

    expect((await figures())[0]).toBe(`${one}1 minute`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
