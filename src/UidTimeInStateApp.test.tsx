import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readUidTimeInStateFixture as uidTimeInState } from './test/fixtures';
import { UidTimeInStateApp } from './UidTimeInStateApp';

/** Stands in for the backend serving /proc/uid_time_in_state. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/uid_time_in_state') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? uidTimeInState(options.fixture ?? 'big-little'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'CPU time per uid at each frequency' });

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The row for a uid, matched on the first cell. */
const rowFor = async (uid: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent?.startsWith(uid))!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UidTimeInStateApp', () => {
  it('requests /proc/uid_time_in_state from its own path', async () => {
    render(<UidTimeInStateApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/uid_time_in_state',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per uid, busiest first', async () => {
    render(<UidTimeInStateApp />);

    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(9 + 1);
    expect(rows[1]).toHaveTextContent('1000');
    expect(rows[1]).toHaveTextContent('system');
  });

  it('summarizes the uids, the clusters and the CPU time between them', async () => {
    render(<UidTimeInStateApp />);

    await table();
    expect(stat('uids')).toHaveTextContent('9');
    expect(stat('clusters')).toHaveTextContent('2');
    expect(stat('most CPU')).toHaveTextContent('system');
    expect(stat('apps')).toHaveTextContent('2');
  });

  /** The header is the policies' tables one after another, and nothing says so. */
  it('names each cluster and the steps it covers', async () => {
    render(<UidTimeInStateApp />);

    await table();
    expect(screen.getByText('cluster 0')).toHaveTextContent('300 MHz – 1.79 GHz');
    expect(screen.getByText('cluster 1')).toHaveTextContent('710 MHz – 2.42 GHz');
  });

  /** Android's name for a uid is the readable half of a number like 10123. */
  it('names a uid the way Android does', async () => {
    render(<UidTimeInStateApp />);

    expect(within(await rowFor('10123')).getByText('u0_a123')).toBeInTheDocument();
    expect(within(await rowFor('90012')).getByText('u0_i12')).toBeInTheDocument();
    expect(within(await rowFor('1047')).getByText('cameraserver')).toBeInTheDocument();
  });

  /** A mean across two clusters' steps would describe neither, so there is one each. */
  it('shows the time and mean frequency a uid had on each cluster', async () => {
    render(<UidTimeInStateApp />);
    const row = await rowFor('1047');

    // 6011+902+1204+2011+1802+1420+980+640 ticks on the little cluster.
    expect(row).toHaveTextContent('2m 29s');
    // and 3011+2402+2810+3620+4210+3011+1802+1204 on the big one.
    expect(row).toHaveTextContent('3m 40s');
  });

  it('says which frequency each segment of a bar is', async () => {
    render(<UidTimeInStateApp />);
    const row = await rowFor('10123');

    expect(within(row).getByTitle(/^300 MHz — /)).toBeInTheDocument();
    expect(within(row).getByTitle(/^2\.42 GHz — 31% /)).toBeInTheDocument();
  });

  /**
   * Power rises faster than clock does, so a uid sitting at the top step is the
   * one the file is usually opened to find.
   */
  it('warns about a uid sitting at a cluster’s top step', async () => {
    render(<UidTimeInStateApp />);

    expect(
      await screen.findByText(/u0_a123 spends 31% of its cluster 1 time at 2\.42 GHz/),
    ).toBeInTheDocument();
  });

  it('says nothing of the sort where nobody is up there', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'single-cluster' }));
    render(<UidTimeInStateApp />);

    await table();
    expect(screen.queryByText(/of its cluster/)).not.toBeInTheDocument();
  });

  /** One policy: every column is the one cluster, and there is one bar per row. */
  it('renders a machine with a single cpufreq policy', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'single-cluster' }));
    render(<UidTimeInStateApp />);

    await table();
    expect(stat('clusters')).toHaveTextContent('1');
    expect(within(await table()).getAllByRole('columnheader')).toHaveLength(4);
  });

  /** A second Android user multiplies the whole uid layout by 100000. */
  it('reads a uid belonging to a second user', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'many-uids' }));
    render(<UidTimeInStateApp />);

    expect(within(await rowFor('1010045')).getByText('u10_a45')).toBeInTheDocument();
    // A uid outside every Android range is shown as the number it is.
    expect(await rowFor('5678')).toHaveTextContent('5678');
    expect(within(await rowFor('5678')).queryByRole('note')).not.toBeInTheDocument();
  });

  /**
   * The kernel prints as many counts as that uid's table had entries, and the
   * columns it never printed are time that was never accounted.
   */
  it('marks a row shorter than the header and leaves its missing cluster empty', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'short-rows' }));
    render(<UidTimeInStateApp />);

    const short = await rowFor('1000');
    expect(within(short).getByTitle('Fewer counts than the header has frequencies')).toHaveTextContent(
      '8/16',
    );
    expect(
      within(short).getByTitle('The kernel printed no columns for this cluster'),
    ).toBeInTheDocument();
    expect(
      within(await rowFor('10123')).queryByTitle('Fewer counts than the header has frequencies'),
    ).not.toBeInTheDocument();
  });

  /**
   * A line of nothing but zeros is a uid that was seen and never ran, which is
   * not the same as a row the kernel cut short.
   */
  it('shows a uid with no time at all as having run nowhere', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'never-ran' }));
    render(<UidTimeInStateApp />);

    const idle = await rowFor('65534');
    expect(within(idle).getByTitle('This uid has never run on this cluster')).toBeInTheDocument();
    expect(idle).toHaveTextContent('0.00 s');
    expect(
      within(idle).queryByTitle('Fewer counts than the header has frequencies'),
    ).not.toBeInTheDocument();

    // Nothing to rank it by, so it sorts below every uid that has run.
    const rows = within(await table()).getAllByRole('row');
    expect(rows[rows.length - 1]).toBe(idle);
  });

  /** A share of half a second is noise, whatever the share works out at. */
  it('leads the top-step finding with the uid that means it', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'never-ran' }));
    render(<UidTimeInStateApp />);

    expect(
      await screen.findByText(/uid 999 spends 30% of its cluster 0 time at 1\.40 GHz/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/uid 993/)).not.toBeInTheDocument();
  });

  it('reads a header with no uid under it as a table that was reset', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'just-reset' }));
    render(<UidTimeInStateApp />);

    expect(await screen.findByText(/no uid has any time against them/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByText('cluster 1')).toBeInTheDocument();
  });

  it('says a file with no header has no frequencies to read the counts against', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '' }));
    render(<UidTimeInStateApp />);

    expect(await screen.findByText(/no.*header in this file/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<UidTimeInStateApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(uidTimeInState('big-little'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<UidTimeInStateApp />);

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
   * The file is only there on a kernel built with CONFIG_CPU_FREQ_TIMES, so a
   * 404 is the ordinary answer rather than a broken server.
   */
  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<UidTimeInStateApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/uid_time_in_state (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all.
describe.each([
  { fixture: 'big-little', uids: '9' },
  { fixture: 'single-cluster', uids: '5' },
  { fixture: 'many-uids', uids: '14' },
  { fixture: 'short-rows', uids: '3' },
  { fixture: 'raspberry-pi', uids: '4' },
  { fixture: 'never-ran', uids: '5' },
])('UidTimeInStateApp with whatever the server serves: $fixture', ({ fixture, uids }) => {
  it(`renders ${uids} uids`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<UidTimeInStateApp />);

    await table();
    expect(stat('uids')).toHaveTextContent(uids);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
