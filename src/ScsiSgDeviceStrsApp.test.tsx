import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSgDeviceStrsFixture as strs } from './test/fixtures';
import { ScsiSgDeviceStrsApp } from './ScsiSgDeviceStrsApp';

/** Stands in for the backend serving /proc/scsi/sg/device_strs. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/scsi/sg/device_strs') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? strs(options.fixture ?? 'stock'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Generic SCSI device names' });

const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

const rowFor = async (node: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelector('td')?.textContent === node)!;

beforeEach(() => {
  window.history.pushState({}, '', '/scsi/sg/device_strs');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ScsiSgDeviceStrsApp', () => {
  it('requests /proc/scsi/sg/device_strs from its own path', async () => {
    render(<ScsiSgDeviceStrsApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/scsi/sg/device_strs',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('shows the three INQUIRY strings of each device', async () => {
    render(<ScsiSgDeviceStrsApp />);

    const row = await rowFor('/dev/sg0');
    expect(row).toHaveTextContent('VBOX');
    expect(row).toHaveTextContent('CD-ROM');
    expect(row).toHaveTextContent('1.0');
  });

  /** The same rule as the file beside it, and the reason they can be read together. */
  it('names each line by its position, as the devices file does', async () => {
    render(<ScsiSgDeviceStrsApp />);

    expect((await rows()).map((row) => row.querySelector('td')?.textContent)).toEqual([
      '/dev/sg0',
      '/dev/sg1',
    ]);
    expect(within(await rowFor('/dev/sg1')).getByTitle(/position is the node/)).toBeInTheDocument();
  });

  /** The same ATA that is not a vendor on the page for /proc/scsi/scsi. */
  it('marks the disk libata is answering for', async () => {
    render(<ScsiSgDeviceStrsApp />);

    // `ATA` is both the vendor and the chip beside it, so the chip is found by
    // what it says rather than by the word they share.
    expect(within(await rowFor('/dev/sg1')).getByTitle(/Behind libata/)).toHaveTextContent('ATA');
    expect(within(await rowFor('/dev/sg0')).queryByTitle(/Behind libata/)).not.toBeInTheDocument();
  });

  it('says nothing about absent or unscanned devices where there are none', async () => {
    render(<ScsiSgDeviceStrsApp />);

    await table();
    expect(screen.queryByTestId('absent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unscanned')).not.toBeInTheDocument();
  });

  describe('the RAID machine', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'server' }));
    });

    it('names all seven, in the positions the devices file counts them', async () => {
      render(<ScsiSgDeviceStrsApp />);

      expect(await rows()).toHaveLength(7);
      expect(await rowFor('/dev/sg4')).toHaveTextContent('SMP2X36');
      expect(await rowFor('/dev/sg6')).toHaveTextContent('Virtual CDROM0');
    });
  });

  describe('a device that has gone', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'no-active-device' }));
    });

    /** Words here, nine -1s next door — the same absence, spelled twice. */
    it('reads the placeholder, and says how the file beside it spells the same thing', async () => {
      render(<ScsiSgDeviceStrsApp />);

      const notice = await screen.findByTestId('absent');
      expect(notice).toHaveTextContent('<no active device>');
      expect(notice).toHaveTextContent('nine');

      expect(within(await rowFor('/dev/sg1')).getByText('<no active device>')).toBeInTheDocument();
    });

    it('keeps the numbering of the devices under it', async () => {
      render(<ScsiSgDeviceStrsApp />);

      // Three lines for two devices: the gone one still holds its number.
      expect(await rows()).toHaveLength(3);
      expect(await rowFor('/dev/sg2')).toHaveTextContent('ST4000NM0035');
    });
  });

  describe('a device caught before its scan', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'unscanned' }));
    });

    /** Three pointers at one static string, which is not a name. */
    it('says the fields are a placeholder string rather than a device name', async () => {
      render(<ScsiSgDeviceStrsApp />);

      const notice = await screen.findByTestId('unscanned');
      expect(notice).toHaveTextContent('nullnullnullnull');
      expect(notice).toHaveTextContent('pointers');

      expect(within(await rowFor('/dev/sg0')).getByText('not scanned')).toHaveAttribute(
        'title',
        expect.stringContaining('before the INQUIRY is read'),
      );
    });

    it('leaves the device beside it read as the name it is', async () => {
      render(<ScsiSgDeviceStrsApp />);

      const row = await rowFor('/dev/sg1');
      expect(row).toHaveTextContent('HL-DT-ST');
      expect(within(row).queryByText('not scanned')).not.toBeInTheDocument();
    });
  });

  describe('a machine with the driver and no devices', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ body: '' }));
    });

    it('reads an empty file as the driver having no names to print', async () => {
      render(<ScsiSgDeviceStrsApp />);

      expect(await screen.findByTestId('no-devices')).toHaveTextContent('which here is an answer');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('a machine with no sg driver', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    });

    it('reports the 404 rather than an empty table', async () => {
      render(<ScsiSgDeviceStrsApp />);

      expect(await screen.findByRole('alert')).toHaveTextContent('/proc/scsi/sg/device_strs');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('the raw view', () => {
    it('shows the fixed columns as they came, padding and all', async () => {
      render(<ScsiSgDeviceStrsApp />);

      await table();
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file').textContent).toContain(
        'VBOX    \tCD-ROM          \t1.0',
      );
    });
  });
});
