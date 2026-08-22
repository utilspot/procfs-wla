import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readDriverRtcFixture as rtc } from './test/fixtures';
import { DriverRtcApp } from './DriverRtcApp';

/** Stands in for the backend serving /proc/driver/rtc. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/driver/rtc') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? rtc(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const summary = () => screen.findByTestId('summary');
const table = (name: string) => screen.findByRole('table', { name });

/** The row for a key, matched on the key cell's own text. */
const rowFor = async (group: string, key: string): Promise<HTMLElement> => {
  const rows = within(await table(group)).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === key)!;
};

/** The tile under this label, whose value is the line above it. */
const statFor = async (label: string | RegExp): Promise<HTMLElement> => {
  const tiles = within(await summary()).getAllByText(label);
  return tiles[0]!.parentElement!;
};

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/driver/rtc');
  // The page compares the clock against now, so now is pinned: seven seconds
  // behind the desktop fixture's reading.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-03-15T14:32:00Z'));
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DriverRtcApp', () => {
  it('requests /proc/driver/rtc from its own path', async () => {
    render(<DriverRtcApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/driver/rtc',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('shows the clock the chip is holding', async () => {
    render(<DriverRtcApp />);

    expect(await statFor('hardware clock, 2026-03-15')).toHaveTextContent('14:32:07');
    expect(await statFor('battery')).toHaveTextContent('okay');
    expect(await statFor('alarm')).toHaveTextContent('off');
  });

  /** Three of these keys hold spaces, so the tab is the separator. */
  it('reads a key with spaces in it as one key', async () => {
    render(<DriverRtcApp />);

    const row = await rowFor('Interrupts', 'periodic IRQ frequency');

    expect(row).toHaveTextContent('1024');
    expect(row).toHaveTextContent(/in Hz/);
  });

  /** And splitting on the first colon would leave `14` here. */
  it('keeps a value that holds colons whole', async () => {
    render(<DriverRtcApp />);

    expect(await rowFor('The clock', 'rtc_time')).toHaveTextContent('14:32:07');
  });

  it('groups the fields by what they are about', async () => {
    render(<DriverRtcApp />);

    await summary();
    expect(screen.getByTestId('group-clock')).toHaveTextContent('The clock');
    expect(screen.getByTestId('group-alarm')).toHaveTextContent('The alarm');
    expect(screen.getByTestId('group-driver')).toHaveTextContent('What the driver adds');
    // No key here is unknown, so that group is not drawn at all.
    expect(screen.queryByTestId('group-other')).not.toBeInTheDocument();
  });

  it('marks an alarm field the clock does not compare on', async () => {
    render(<DriverRtcApp />);

    const row = await rowFor('The alarm', 'alrm_date');

    expect(row).toHaveTextContent('****-**-**');
    expect(within(row).getByText('any')).toBeInTheDocument();
  });

  it('measures the clock against the one in the browser', async () => {
    render(<DriverRtcApp />);

    const drift = await screen.findByTestId('drift');

    expect(drift).toHaveTextContent('This clock agrees with the one in this browser');
    expect(drift).toHaveTextContent('reading it as UTC');
    expect(drift).toHaveTextContent('/etc/adjtime');
  });

  /** A gap of whole hours is the UTC assumption being wrong, not a bad clock. */
  it('says a clock reading ahead of the browser is ahead', async () => {
    vi.setSystemTime(new Date('2026-03-15T12:32:07Z'));
    render(<DriverRtcApp />);

    expect(await screen.findByTestId('drift')).toHaveTextContent(
      'This clock is 2 hours ahead of the one in this browser',
    );
  });

  it('says a clock reading behind it is behind', async () => {
    vi.setSystemTime(new Date('2026-03-15T14:37:07Z'));
    render(<DriverRtcApp />);

    expect(await screen.findByTestId('drift')).toHaveTextContent(
      'This clock is 5 minutes behind the one in this browser',
    );
  });

  it('warns about a failed backup battery', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'dead-battery' }));
    render(<DriverRtcApp />);

    const battery = await screen.findByTestId('battery');

    expect(battery).toHaveTextContent('the backup battery has failed');
    expect(battery).toHaveTextContent('every boot starts from whatever the chip powers on to');
    expect(await statFor('battery')).toHaveTextContent('dead');
  });

  it('says what an armed alarm was set for', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'alarm-set' }));
    render(<DriverRtcApp />);

    const armed = await screen.findByTestId('armed');

    expect(armed).toHaveTextContent('The alarm is armed');
    expect(armed).toHaveTextContent('06:30:00');
    expect(armed).toHaveTextContent('on 2026-03-16');
    expect(await statFor('alarm')).toHaveTextContent('armed');
  });

  /** The whole block comes from one read, so it goes as one. */
  it('explains a clock with no alarm block rather than showing it empty', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-alarm' }));
    render(<DriverRtcApp />);

    expect(await screen.findByTestId('no-alarm')).toHaveTextContent(
      'This clock has no alarm to read',
    );
    expect(screen.queryByTestId('group-alarm')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-irq')).not.toBeInTheDocument();
    expect(await statFor('alarm')).toHaveTextContent('none');
  });

  it('reads the 2.6-era format, epoch and all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-2.6' }));
    render(<DriverRtcApp />);

    expect(await rowFor('The clock', 'rtc_epoch')).toHaveTextContent('1900');
    const alarm = await rowFor('The alarm', 'alarm');
    expect(alarm).toHaveTextContent('**:30:00');
    expect(within(alarm).getByText('any')).toBeInTheDocument();
  });

  it('marks a key it has no entry for', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'rtc_time\t: 14:32:07\nvendor_trim\t: 0x1f\n' }));
    render(<DriverRtcApp />);

    const row = await rowFor('Not known here', 'vendor_trim');

    expect(within(row).getByText('not known here')).toBeInTheDocument();
    expect(row).toHaveTextContent('Nothing here knows this key.');
  });

  it('says when a line is not a field at all', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'rtc_time\t: 14:32:07\nnot a field\n' }));
    render(<DriverRtcApp />);

    expect(await screen.findByTestId('unread')).toHaveTextContent('1 line here is not');
  });

  it('says this is one clock rather than the machine’s clocks', async () => {
    render(<DriverRtcApp />);

    await summary();
    expect(screen.getByText(/CONFIG_RTC_HCTOSYS_DEVICE/)).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DriverRtcApp />);
    await summary();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toHaveTextContent(rtc('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<DriverRtcApp />);

    await summary();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('says so when the file holds no fields', async () => {
    vi.stubGlobal('fetch', mockServer({ body: 'processor\t: 0\n' }));
    render(<DriverRtcApp />);

    // A key with a tab is a field, so this one needs a file with none at all.
    expect(await screen.findByTestId('group-other')).toBeInTheDocument();

    vi.stubGlobal('fetch', mockServer({ body: '\n' }));
    render(<DriverRtcApp />);

    expect(await screen.findByTestId('empty')).toHaveTextContent('No clock fields found');
  });

  /**
   * A machine with no RTC has no file — a Raspberry Pi 4 is one, which is why
   * that capture has none.
   */
  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<DriverRtcApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/driver/rtc (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from a PC's CMOS clock to a board with no alarm to read.
describe.each([
  { fixture: 'desktop', fields: 18 },
  { fixture: 'alarm-set', fields: 18 },
  { fixture: 'dead-battery', fields: 18 },
  { fixture: 'legacy-2.6', fields: 13 },
  { fixture: 'no-alarm', fields: 3 },
])('DriverRtcApp with whatever the server serves: $fixture', ({ fixture, fields }) => {
  it(`renders ${fields} fields with the clock among them`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<DriverRtcApp />);

    expect(await statFor('fields')).toHaveTextContent(String(fields));
    expect(await rowFor('The clock', 'rtc_time')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
