import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSgDebugFixture as debug } from './test/fixtures';
import { ScsiSgDebugApp } from './ScsiSgDebugApp';

/** Stands in for the backend serving /proc/scsi/sg/debug. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/scsi/sg/debug') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? debug(options.fixture ?? 'one-open'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const deviceFor = (name: string): Promise<HTMLElement> =>
  screen.findByRole('article', { name: `Device ${name}` });

const fdIn = (device: HTMLElement, index: number): HTMLElement =>
  within(device).getByRole('region', { name: `Descriptor ${index}` });

beforeEach(() => {
  window.history.pushState({}, '', '/scsi/sg/debug');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ScsiSgDebugApp', () => {
  it('requests /proc/scsi/sg/debug from its own path', async () => {
    render(<ScsiSgDebugApp />);

    await deviceFor('sg0');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/scsi/sg/debug',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('shows the header line as the two facts it holds', async () => {
    render(<ScsiSgDebugApp />);

    await deviceFor('sg0');
    // The names appear in the prose beside them too, so the rows are found by role.
    const header = within(screen.getByTestId('header'));
    expect(header.getByRole('rowheader', { name: 'max_active_device' }).parentElement)
      .toHaveTextContent('2');
    expect(header.getByRole('rowheader', { name: 'def_reserved_size' }).parentElement)
      .toHaveTextContent('32768');
  });

  /** Every number the device line holds, as a row with its own name on it. */
  it('puts the device’s values in a table, a row each', async () => {
    render(<ScsiSgDebugApp />);

    const device = within(await deviceFor('sg0'));
    const fields = within(device.getByRole('table', { name: 'Device sg0 fields' }));

    expect(fields.getByRole('rowheader', { name: 'address' }).parentElement)
      .toHaveTextContent('0:0:0:0');
    expect(fields.getByRole('rowheader', { name: 'sg_tablesize' }).parentElement)
      .toHaveTextContent('127');
    expect(fields.getByRole('rowheader', { name: 'open_cnt' }).parentElement)
      .toHaveTextContent('1');
    expect(fields.getByRole('rowheader', { name: 'excl' }).parentElement)
      .toHaveTextContent('shared');
  });

  /** `em` is about the host rather than the device, which is worth saying. */
  it('reads em as the host’s flag rather than the device’s', async () => {
    render(<ScsiSgDebugApp />);

    const fields = within(
      within(await deviceFor('sg0')).getByRole('table', { name: 'Device sg0 fields' }),
    );
    const row = fields.getByRole('rowheader', { name: 'em' });

    expect(row).toHaveAttribute('title', expect.stringContaining("host template's emulated flag"));
    expect(row.parentElement).toHaveTextContent('an emulated host');
    expect(row.parentElement).toHaveTextContent('the host and not this device');
  });

  it('puts the descriptor’s values in a table too', async () => {
    render(<ScsiSgDebugApp />);

    const fd = fdIn(await deviceFor('sg0'), 1);
    expect(fd).toHaveTextContent('FD(1)');

    const fields = within(within(fd).getByRole('table', { name: 'Descriptor 1 fields' }));
    expect(fields.getByRole('rowheader', { name: 'timeout' }).parentElement)
      .toHaveTextContent('60000 ms');
    expect(fields.getByRole('rowheader', { name: 'bufflen' }).parentElement)
      .toHaveTextContent('32768 bytes');
    expect(fields.getByRole('rowheader', { name: '(res)sgat' }).parentElement)
      .toHaveTextContent('1');
    expect(fields.getByRole('rowheader', { name: 'cmd_q' }).parentElement)
      .toHaveTextContent('one command at a time');
  });

  /** Two of those rows hold a value that cannot be anything else. */
  it('marks the two fields that are constants', async () => {
    const fd = (render(<ScsiSgDebugApp />), fdIn(await deviceFor('sg0'), 1));
    const fields = within(within(fd).getByRole('table', { name: 'Descriptor 1 fields' }));

    const lowDma = fields.getByRole('rowheader', { name: 'low_dma' });
    expect(lowDma).toHaveAttribute('title', expect.stringContaining('literal 0'));
    expect(lowDma.parentElement).toHaveTextContent('a literal, not a measurement');

    const closed = fields.getByRole('rowheader', { name: 'closed' });
    expect(closed).toHaveAttribute('title', expect.stringContaining('format string'));
    expect(closed.parentElement).toHaveTextContent('never anything else');
  });

  it('shows the driver’s own words for a descriptor with nothing in flight', async () => {
    render(<ScsiSgDebugApp />);

    expect(fdIn(await deviceFor('sg0'), 1)).toHaveTextContent('No requests active');
  });

  describe('descriptors with work in flight', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'busy' }));
    });

    it('shows a block per descriptor and a row per request', async () => {
      render(<ScsiSgDebugApp />);

      const device = await deviceFor('sg0');
      const requests = within(
        within(fdIn(device, 1)).getByRole('table', { name: 'Requests on descriptor 1' }),
      )
        .getAllByRole('row')
        .slice(1);

      expect(requests).toHaveLength(3);
      expect(requests[0]).toHaveTextContent('act');
      expect(requests[0]).toHaveTextContent('READ(16)');
      expect(requests[2]).toHaveTextContent('INQUIRY');
    });

    /** The prefix says where the data is going, which is the interesting part. */
    it('names the buffer each request is using', async () => {
      render(<ScsiSgDebugApp />);

      const fd = fdIn(await deviceFor('sg0'), 1);
      expect(within(fd).getAllByText('reserved')).toHaveLength(2);
      expect(within(fd).getByText('direct')).toHaveAttribute(
        'title',
        expect.stringContaining('direct I/O'),
      );
      expect(within(fdIn(await deviceFor('sg0'), 2)).getByText('ordinary')).toBeInTheDocument();
    });

    /** In flight shows what has gone of the timeout; done shows what it took. */
    it('shows the two shapes a request’s timing takes', async () => {
      render(<ScsiSgDebugApp />);

      const requests = within(
        within(fdIn(await deviceFor('sg0'), 1)).getByRole('table', {
          name: 'Requests on descriptor 1',
        }),
      )
        .getAllByRole('row')
        .slice(1);
      expect(requests[0]).toHaveTextContent('1240 / 60000 ms');
      expect(requests[2]).toHaveTextContent('3 ms');
    });

    /** A descriptor keeps the reserve it opened with, so it can differ. */
    it('says a reserve behind the default is a descriptor older than the change', async () => {
      render(<ScsiSgDebugApp />);

      const notice = await screen.findByTestId('old-reserve');
      expect(notice).toHaveTextContent('not the default this file names');
      expect(notice).toHaveTextContent('32768 B');
      expect(notice).toHaveTextContent('is not a disagreement');
    });

    it('counts what is in flight on each device', async () => {
      render(<ScsiSgDebugApp />);

      expect(within(await deviceFor('sg0')).getByText('2 in flight')).toBeInTheDocument();
      // Not the "nothing in flight" prose under an idle descriptor: the chip.
      expect(within(await deviceFor('sg4')).queryByText(/^\d+ in flight$/)).not.toBeInTheDocument();
    });
  });

  describe('a device going away', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'detaching' }));
    });

    /** The third spelling of an absence its neighbours spell in two others. */
    it('says what the other two files say about the same device', async () => {
      render(<ScsiSgDebugApp />);

      const notice = await screen.findByTestId('detaching');
      expect(notice).toHaveTextContent('detaching pending close');
      expect(notice).toHaveTextContent('nine');
      expect(notice).toHaveTextContent('<no active device>');
    });

    it('keeps the descriptor that is holding it, and what it is doing', async () => {
      render(<ScsiSgDebugApp />);

      const device = await deviceFor('sg1');
      expect(within(device).getByText('detaching pending close')).toBeInTheDocument();
      expect(fdIn(device, 1)).toHaveTextContent('INQUIRY');
    });
  });

  describe('an idle machine', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'idle' }));
    });

    /** A device nothing has open prints nothing, so this is the usual state. */
    it('says the header alone is the ordinary state, not a failure', async () => {
      render(<ScsiSgDebugApp />);

      const notice = await screen.findByTestId('header-only');
      expect(notice).toHaveTextContent('the ordinary state');
      expect(notice).toHaveTextContent('has a descriptor');
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
    });

    it('still shows the two numbers the header carries', async () => {
      render(<ScsiSgDebugApp />);

      await screen.findByTestId('header-only');
      const header = within(screen.getByTestId('header'));
      expect(header.getByRole('rowheader', { name: 'max_active_device' }).parentElement)
        .toHaveTextContent('2');
    });
  });

  describe('an empty file', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ body: '' }));
    });

    /** The header is printed whatever the machine is doing, so none is a failure. */
    it('reads nothing at all as the read failing', async () => {
      render(<ScsiSgDebugApp />);

      expect(await screen.findByText(/this is the read failing/)).toHaveClass('notice--warn');
    });
  });

  describe('a machine with no sg driver', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    });

    it('reports the 404 rather than an empty page', async () => {
      render(<ScsiSgDebugApp />);

      expect(await screen.findByRole('alert')).toHaveTextContent('/proc/scsi/sg/debug');
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
    });
  });

  describe('the raw view', () => {
    it('shows the nesting as the file wrote it', async () => {
      render(<ScsiSgDebugApp />);

      await deviceFor('sg0');
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file').textContent).toContain(
        ' >>> device=sg0 0:0:0:0   em=1 sg_tablesize=127 excl=0 open_cnt=1',
      );
    });
  });
});
