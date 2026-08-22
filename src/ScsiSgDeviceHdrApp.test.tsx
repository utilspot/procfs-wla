import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSgDeviceHdrFixture as hdr } from './test/fixtures';
import { ScsiSgDeviceHdrApp } from './ScsiSgDeviceHdrApp';

/** Stands in for the backend serving /proc/scsi/sg/device_hdr. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/scsi/sg/device_hdr') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? hdr(options.fixture ?? 'stock'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'What the names mean' });

const rows = async (): Promise<HTMLElement[]> => within(await table()).getAllByRole('row');

/** The row for a name, matched on its own cell rather than on the prose beside it. */
const rowFor = async (name: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelector('th')?.textContent?.endsWith(name))!;

beforeEach(() => {
  window.history.pushState({}, '', '/scsi/sg/device_hdr');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ScsiSgDeviceHdrApp', () => {
  it('requests /proc/scsi/sg/device_hdr from its own path', async () => {
    render(<ScsiSgDeviceHdrApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/scsi/sg/device_hdr',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  /** The file is a header for another file, which is the whole of what it is. */
  it('says which file these are the columns of', async () => {
    render(<ScsiSgDeviceHdrApp />);

    const notice = await screen.findByTestId('what-it-is');
    expect(notice).toHaveTextContent('the header of another one');
    expect(notice).toHaveTextContent('/proc/scsi/sg/devices');
    expect(notice).toHaveTextContent('says nothing about this machine');
  });

  it('gives a row per name, numbered as the column it names', async () => {
    render(<ScsiSgDeviceHdrApp />);

    expect(await rows()).toHaveLength(9);
    expect(await rowFor('host')).toHaveTextContent('controller port');
    expect(await rowFor('qdepth')).toHaveTextContent('in flight');
    expect(within(await rowFor('lun')).getByTitle('Column 4 of 9 in /proc/scsi/sg/devices'))
      .toBeInTheDocument();
  });

  /** The three names a reader is likeliest to take at face value. */
  it('says where a name is not the whole truth', async () => {
    render(<ScsiSgDeviceHdrApp />);

    expect(await rowFor('opens')).toHaveTextContent('literal 1');
    expect(await rowFor('busy')).toHaveTextContent('two reads');
    expect(await rowFor('online')).toHaveTextContent('-1');
  });

  it('shows the line itself, which is all the file holds', async () => {
    render(<ScsiSgDeviceHdrApp />);

    await table();
    expect(screen.getByText(/host\s+chan\s+id\s+lun/)).toBeInTheDocument();
  });

  it('says nothing about a disagreement where the names are the expected ones', async () => {
    render(<ScsiSgDeviceHdrApp />);

    await table();
    expect(screen.queryByTestId('disagrees')).not.toBeInTheDocument();
    expect(screen.queryByTestId('extra')).not.toBeInTheDocument();
  });

  describe('a header naming a column this app does not know', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'unknown-column' }));
    });

    /** Which would mean the page for `devices` is naming columns wrongly. */
    it('says the devices page would be reading the wrong columns', async () => {
      render(<ScsiSgDeviceHdrApp />);

      const notice = await screen.findByTestId('disagrees');
      expect(notice).toHaveTextContent('not the columns this app reads that file in');
      expect(notice).toHaveTextContent('blocked');
    });

    it('still names the ones it knows, and marks the one it does not', async () => {
      render(<ScsiSgDeviceHdrApp />);

      expect(await rows()).toHaveLength(10);
      expect(await rowFor('host')).toHaveTextContent('controller port');
      expect(await rowFor('blocked')).toHaveTextContent('no meaning for');
    });
  });

  describe('a header whose name is spelled differently', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'renamed' }));
    });

    it('says which name it expected and did not find', async () => {
      render(<ScsiSgDeviceHdrApp />);

      const notice = await screen.findByTestId('disagrees');
      expect(notice).toHaveTextContent('channel');
      expect(notice).toHaveTextContent('chan');
    });
  });

  describe('a file that is not the header', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'odd' }));
    });

    it('reads the words it holds and says none of them are the columns', async () => {
      render(<ScsiSgDeviceHdrApp />);

      expect(await screen.findByTestId('disagrees')).toHaveTextContent('host');
      expect(await rowFor('unavailable')).toHaveTextContent('no meaning for');
    });
  });

  describe('an empty file', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ body: '' }));
    });

    /** A literal is printed by any driver that is there at all. */
    it('reads nothing at all as the read failing', async () => {
      render(<ScsiSgDeviceHdrApp />);

      // The match is the `code` inside the notice, so the class is on its parent.
      const notice = (await screen.findByText(/seq_puts/)).closest('p');
      expect(notice).toHaveClass('notice--warn');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('a machine with no sg driver', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    });

    it('reports the 404 rather than an empty page', async () => {
      render(<ScsiSgDeviceHdrApp />);

      expect(await screen.findByRole('alert')).toHaveTextContent('/proc/scsi/sg/device_hdr');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('the raw view', () => {
    it('shows the one line as it came, tabs and all', async () => {
      render(<ScsiSgDeviceHdrApp />);

      await table();
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file').textContent).toContain(
        'host\tchan\tid\tlun\ttype\topens\tqdepth\tbusy\tonline',
      );
    });
  });
});
