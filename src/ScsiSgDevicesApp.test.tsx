import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSgDevicesFixture as sg } from './test/fixtures';
import { ScsiSgDevicesApp } from './ScsiSgDevicesApp';

/** Stands in for the backend serving /proc/scsi/sg/devices. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/scsi/sg/devices') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? sg(options.fixture ?? 'stock'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Generic SCSI devices' });

const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row for a node, matched on the first cell — which is the line's position. */
const rowFor = async (node: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelector('td')?.textContent === node)!;

beforeEach(() => {
  window.history.pushState({}, '', '/scsi/sg/devices');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ScsiSgDevicesApp', () => {
  it('requests /proc/scsi/sg/devices from its own path', async () => {
    render(<ScsiSgDevicesApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/scsi/sg/devices',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  /** No column names the node: the line's position is what does. */
  it('names each line by its position, which is the node', async () => {
    render(<ScsiSgDevicesApp />);

    expect(await rows()).toHaveLength(2);
    expect((await rows())[0]).toHaveTextContent('/dev/sg0');
    expect((await rows())[1]).toHaveTextContent('/dev/sg1');
    expect(within(await rowFor('/dev/sg0')).getByTitle(/position is the node/)).toBeInTheDocument();
  });

  it('shows the address the other SCSI pages print in words', async () => {
    render(<ScsiSgDevicesApp />);

    expect(await rowFor('/dev/sg0')).toHaveTextContent('0:0:0:0');
    expect(await rowFor('/dev/sg1')).toHaveTextContent('2:0:0:0');
  });

  /** This file gives the type as a number; the page carries the name back. */
  it('names the type number, which is the same table read from the other end', async () => {
    render(<ScsiSgDevicesApp />);

    expect(await rowFor('/dev/sg0')).toHaveTextContent('CD-ROM');
    expect(await rowFor('/dev/sg1')).toHaveTextContent('Direct-Access');
  });

  it('shows what is in flight against the queue each device was given', async () => {
    render(<ScsiSgDevicesApp />);

    expect(await rowFor('/dev/sg0')).toHaveTextContent('0 / 1');
    expect(await rowFor('/dev/sg1')).toHaveTextContent('0 / 32');
  });

  /** The column promises a count and the driver prints a literal. */
  it('says the opens column is a constant rather than a count', async () => {
    render(<ScsiSgDevicesApp />);

    expect(within(await rowFor('/dev/sg0')).getByTitle(/literal 1/)).toHaveTextContent('1');
  });

  it('says nothing about gone or offline devices where there are none', async () => {
    render(<ScsiSgDevicesApp />);

    await table();
    expect(screen.queryByTestId('gone')).not.toBeInTheDocument();
    expect(screen.queryByTestId('offline')).not.toBeInTheDocument();
  });

  describe('the RAID machine', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'server' }));
    });

    /** Every device the midlayer attached gets one, block driver or not. */
    it('gives a node to the enclosure and the controller too', async () => {
      render(<ScsiSgDevicesApp />);

      expect(await rows()).toHaveLength(7);
      expect(await rowFor('/dev/sg4')).toHaveTextContent('Enclosure');
      expect(await rowFor('/dev/sg5')).toHaveTextContent('RAID');
    });

    it('shows what was in flight for each of them when the file was read', async () => {
      render(<ScsiSgDevicesApp />);

      expect(await rowFor('/dev/sg0')).toHaveTextContent('2 / 64');
      expect(await rowFor('/dev/sg2')).toHaveTextContent('5 / 64');
      expect(await rowFor('/dev/sg1')).toHaveTextContent('0 / 64');
    });
  });

  describe('a device that has gone', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'detaching' }));
    });

    /** The line stays so that nothing under it is renumbered. */
    it('reads the nine -1s as a number held open', async () => {
      render(<ScsiSgDevicesApp />);

      const notice = await screen.findByTestId('gone');
      expect(notice).toHaveTextContent('a device that has gone');
      expect(notice).toHaveTextContent('/dev/sg1');

      const row = await rowFor('/dev/sg1');
      expect(within(row).getByText('gone')).toBeInTheDocument();

      // Said once, in words — not laid out as nine columns of -1.
      const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent);
      expect(cells.filter((text) => text === '-1')).toEqual([]);
    });

    it('keeps the numbering of the devices under it', async () => {
      render(<ScsiSgDevicesApp />);

      // Three lines for two devices: the gone one still holds its number.
      expect(await rows()).toHaveLength(3);
      expect(await rowFor('/dev/sg2')).toHaveTextContent('0:0:2:0');
    });
  });

  describe('a device the midlayer has stopped talking to', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'offline' }));
    });

    /** Offline is not gone, and the page says which of the two this is. */
    it('marks it offline and keeps everything else about it', async () => {
      render(<ScsiSgDevicesApp />);

      expect(await screen.findByTestId('offline')).toHaveTextContent('A device is');
      const row = await rowFor('/dev/sg0');
      expect(within(row).getByText('offline')).toBeInTheDocument();
      expect(row).toHaveTextContent('0:0:0:0');
      expect(screen.queryByTestId('gone')).not.toBeInTheDocument();
    });
  });

  describe('a machine with the driver and no devices', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ body: '' }));
    });

    /** A line per device and nothing else, so none is an answer rather than a failure. */
    it('reads an empty file as the driver having nothing to print', async () => {
      render(<ScsiSgDevicesApp />);

      const notice = await screen.findByTestId('no-devices');
      expect(notice).toHaveTextContent('which here is an answer');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('a machine with no sg driver', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    });

    it('reports the 404 rather than an empty table', async () => {
      render(<ScsiSgDevicesApp />);

      expect(await screen.findByRole('alert')).toHaveTextContent('/proc/scsi/sg/devices');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('the raw view', () => {
    it('shows the nine bare numbers the file is', async () => {
      render(<ScsiSgDevicesApp />);

      await table();
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file').textContent).toContain('0\t0\t0\t0\t5\t1\t1\t0\t1');
    });
  });
});
