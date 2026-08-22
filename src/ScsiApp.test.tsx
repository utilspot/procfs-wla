import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readScsiFixture as scsi } from './test/fixtures';
import { ScsiApp } from './ScsiApp';

/** Stands in for the backend serving /proc/scsi/scsi. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/scsi/scsi') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? scsi(options.fixture ?? 'server'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** One device's card, named by the address the file gives it. */
const cardFor = (address: string): Promise<HTMLElement> =>
  screen.findByRole('article', { name: `SCSI device ${address}` });

/** Every card, in the order the file listed the devices. */
const cards = async (): Promise<HTMLElement[]> => {
  await cardFor('0:0:0:0');
  return screen.getAllByRole('article');
};

/** One field of a card, by the label its row carries. */
const field = (card: HTMLElement, label: string): HTMLElement =>
  within(card).getByRole('rowheader', { name: label }).parentElement!;

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/scsi/scsi');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ScsiApp', () => {
  it('requests /proc/scsi/scsi from its own path', async () => {
    render(<ScsiApp />);

    await cardFor('0:0:0:0');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/scsi/scsi',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  /** The record is three lines, and one card is one device. */
  it('renders a card per device rather than per line', async () => {
    render(<ScsiApp />);

    expect(await cards()).toHaveLength(7);
    expect(stat('devices')).toHaveTextContent('7');
    expect(stat('hosts')).toHaveTextContent('2');
  });

  /** The file prints the devices of one controller port together. */
  it('groups the cards under the host each device is behind', async () => {
    render(<ScsiApp />);

    await cardFor('0:0:0:0');
    const first = screen.getByRole('region', { name: 'Host scsi0' });
    expect(within(first).getAllByRole('article')).toHaveLength(6);

    const second = screen.getByRole('region', { name: 'Host scsi6' });
    expect(within(second).getAllByRole('article')).toHaveLength(1);
    expect(within(second).getByRole('article')).toHaveTextContent('Virtual CDROM0');
  });

  /** Every fact carries its own label, so none of them reads as a blank cell. */
  it('labels each field of the INQUIRY response', async () => {
    const card = (render(<ScsiApp />), await cardFor('0:0:0:0'));

    expect(field(card, 'Vendor')).toHaveTextContent('SEAGATE');
    expect(field(card, 'Model')).toHaveTextContent('ST4000NM0035');
    expect(field(card, 'Firmware')).toHaveTextContent('TT31');
    expect(field(card, 'In sysfs')).toHaveTextContent('/sys/class/scsi_device/0:0:0:0');
  });

  /** The file prints the type's name; the page says which number that is. */
  it('names the type and carries back the code it stands for', async () => {
    render(<ScsiApp />);

    expect(field(await cardFor('0:0:8:0'), 'Type')).toHaveTextContent('Enclosure');
    expect(field(await cardFor('0:0:8:0'), 'Type')).toHaveTextContent('0x0d');
    expect(field(await cardFor('0:3:0:0'), 'Type')).toHaveTextContent('RAID');
    expect(field(await cardFor('0:3:0:0'), 'Type')).toHaveTextContent('0x0c');
  });

  /** Two of these are devices no block driver claims, which is not a fault. */
  it('says which devices a driver gives a node to', async () => {
    render(<ScsiApp />);

    expect(field(await cardFor('0:0:0:0'), 'Driver')).toHaveTextContent('/dev/sd*');
    expect(field(await cardFor('0:3:0:0'), 'Driver')).toHaveTextContent('sg only');
    expect(within(await cardFor('0:3:0:0')).getByText('sg only')).toHaveAttribute(
      'title',
      expect.stringContaining('No upper-level driver binds this type'),
    );
  });

  /** The revision is the ANSI version byte, and the page says which standard. */
  it('reads the ANSI revision as the standard it names', async () => {
    render(<ScsiApp />);

    expect(field(await cardFor('0:0:0:0'), 'ANSI')).toHaveTextContent('SPC-4');
    expect(field(await cardFor('6:0:0:0'), 'ANSI')).toHaveTextContent('no standard claimed');
    expect(stat('oldest standard')).toHaveTextContent('no standard claimed');
  });

  /** Four identical disks would otherwise carry four copies of the same prose. */
  it('explains each type and revision once for the page, not once per card', async () => {
    render(<ScsiApp />);

    await cardFor('0:0:0:0');
    const legend = screen.getByRole('region', { name: 'What the types and revisions here mean' });

    expect(within(legend).getAllByText('Direct-Access')).toHaveLength(1);
    expect(within(legend).getByText(/An SES device/)).toBeInTheDocument();
    expect(within(legend).getByText(/the ceiling of the three-bit field|Modern SAS and USB/)).toBeInTheDocument();
    expect(await cardFor('0:0:0:0')).not.toHaveTextContent('A disk. Almost everything here is one');
  });

  /** The meaning is still one hover away on the card itself. */
  it('keeps the meaning on the card, as the tooltip its label carries', async () => {
    render(<ScsiApp />);

    const card = await cardFor('0:0:0:0');
    expect(within(card).getByRole('rowheader', { name: 'Type' })).toHaveAttribute(
      'title',
      expect.stringContaining('peripheral device type 0x00'),
    );
  });

  it('says nothing about ATA translation or LUNs where there is none', async () => {
    render(<ScsiApp />);

    await cardFor('0:0:0:0');
    expect(screen.queryByTestId('ata')).not.toBeInTheDocument();
    expect(screen.queryByTestId('luns')).not.toBeInTheDocument();
  });

  describe('SATA disks behind libata', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'sata' }));
    });

    it('explains that the vendor is the translation rather than the drive', async () => {
      render(<ScsiApp />);

      const notice = await screen.findByTestId('ata');
      expect(notice).toHaveTextContent('2 devices answer');
      expect(notice).toHaveTextContent('libata is making the INQUIRY response up');
    });

    it('marks the translated disks, on the card and in the vendor field', async () => {
      render(<ScsiApp />);

      const card = await cardFor('0:0:0:0');
      expect(within(card).getByTitle(/Behind libata/)).toHaveTextContent('ATA');
      expect(field(card, 'Vendor')).toHaveTextContent("not the drive's");
    });

    it('marks a model that fills its field, and leaves one that does not', async () => {
      render(<ScsiApp />);

      expect(field(await cardFor('1:0:0:0'), 'Model')).toHaveTextContent(
        'fills the 16 bytes, so this may be the front of a longer name',
      );
      expect(field(await cardFor('0:0:0:0'), 'Model')).not.toHaveTextContent('fills the 16 bytes');
    });

    it('leaves the optical drive alone, which answered for itself', async () => {
      render(<ScsiApp />);

      const card = await cardFor('2:0:0:0');
      expect(field(card, 'Vendor')).toHaveTextContent('HL-DT-ST');
      expect(field(card, 'Type')).toHaveTextContent('CD-ROM');
      expect(field(card, 'Driver')).toHaveTextContent('/dev/sr*');
      expect(within(card).queryByTitle(/Behind libata/)).not.toBeInTheDocument();
    });
  });

  describe('one target holding four devices', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'usb' }));
    });

    it('explains the LUNs as one target answering as several', async () => {
      render(<ScsiApp />);

      const notice = await screen.findByTestId('luns');
      expect(notice).toHaveTextContent('3 devices sit');
      expect(notice).toHaveTextContent('one target answering as several');
    });

    it('marks each unit past the first, and says its target holds more', async () => {
      render(<ScsiApp />);

      expect(within(await cardFor('5:0:0:3')).getByText('lun 3')).toHaveAttribute(
        'title',
        expect.stringContaining('Another logical unit of the same target'),
      );
      expect(within(await cardFor('5:0:0:0')).queryByText(/^lun /)).not.toBeInTheDocument();
    });
  });

  describe('an old parallel bus', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'legacy' }));
    });

    it('shows the CCS suffix on the card and the revision it qualifies', async () => {
      render(<ScsiApp />);

      const card = await cardFor('0:0:2:0');
      expect(field(card, 'ANSI')).toHaveTextContent('01');
      expect(field(card, 'ANSI')).toHaveTextContent('SCSI-1');
      expect(within(card).getByText('CCS')).toHaveAttribute(
        'title',
        expect.stringContaining('Common Command Set'),
      );
    });

    it('names the types no modern machine has', async () => {
      render(<ScsiApp />);

      expect(field(await cardFor('0:0:4:0'), 'Type')).toHaveTextContent('Sequential-Access');
      expect(field(await cardFor('0:0:4:0'), 'Driver')).toHaveTextContent('/dev/st*');
      expect(field(await cardFor('0:0:5:0'), 'Type')).toHaveTextContent('Scanner');
      expect(stat('types')).toHaveTextContent('4');
    });
  });

  describe('a record whose lines could not be read', () => {
    /** A truncated read, or a shape this parser does not know. */
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        mockServer({
          body: ['Attached devices:', 'Host: scsi0 Channel: 00 Id: 00 Lun: 00', ''].join('\n'),
        }),
      );
    });

    it('says which fields were not printed rather than showing them blank', async () => {
      render(<ScsiApp />);

      const card = await cardFor('0:0:0:0');
      expect(within(card).getAllByText('not printed').length).toBeGreaterThan(2);
      expect(field(card, 'In sysfs')).toHaveTextContent('/sys/class/scsi_device/0:0:0:0');
    });

    it('shows the record as it came, since it is still the file talking', async () => {
      render(<ScsiApp />);

      const unread = await screen.findByTestId('unread-0:0:0:0');
      expect(unread).toHaveTextContent('Neither line under the address could be read');
      expect(unread).toHaveTextContent('Host: scsi0 Channel: 00 Id: 00 Lun: 00');
    });
  });

  describe('a machine with nothing attached', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'desktop' }));
    });

    /** The header alone is the kernel's answer, not a failed read. */
    it('reads the header alone as an answer, and says why NVMe is not here', async () => {
      render(<ScsiApp />);

      const notice = await screen.findByTestId('nothing-attached');
      expect(notice).toHaveTextContent('Attached devices:');
      expect(notice).toHaveTextContent('NVMe is not SCSI');
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
    });

    it('still offers the raw view of the one line', async () => {
      render(<ScsiApp />);

      await screen.findByTestId('nothing-attached');
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file')).toHaveTextContent('Attached devices:');
    });
  });

  describe('a file with nothing in it at all', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ body: '' }));
    });

    /** Which is the read failing, since the header is always printed. */
    it('tells an empty file from a machine with nothing attached', async () => {
      render(<ScsiApp />);

      const notice = await screen.findByText(/this is the read failing/);
      expect(notice).toHaveClass('notice--warn');
      expect(screen.queryByTestId('nothing-attached')).not.toBeInTheDocument();
    });
  });

  describe('a machine with no such file', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    });

    /** The file is there only with CONFIG_SCSI_PROC_FS, and the SCSI stack loaded. */
    it('reports the 404 rather than showing an empty page', async () => {
      render(<ScsiApp />);

      expect(await screen.findByRole('alert')).toHaveTextContent('/proc/scsi/scsi');
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
    });
  });

  describe('the raw view', () => {
    it('shows the file as it came, three lines to a device', async () => {
      render(<ScsiApp />);

      await cardFor('0:0:0:0');
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));

      const raw = screen.getByTestId('raw-file');
      expect(raw).toHaveTextContent('Host: scsi0 Channel: 00 Id: 00 Lun: 00');
      expect(raw.textContent).toContain('  Vendor: SEAGATE  Model: ST4000NM0035     Rev: TT31');
    });
  });
});
