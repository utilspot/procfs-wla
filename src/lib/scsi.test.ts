import { describe, expect, it } from 'vitest';
import { readScsiFixture as fixture } from '../test/fixtures';
import {
  addressOf,
  ATA_VENDOR,
  devicesOfHost,
  fillsField,
  hasNode,
  HEADER,
  hostsOf,
  isAtaBridge,
  isModelCut,
  isVendorCut,
  missingLines,
  MODEL_WIDTH,
  parseScsi,
  REV_WIDTH,
  sharesTarget,
  standardOf,
  summarize,
  sysfsPathOf,
  typeOf,
  VENDOR_WIDTH,
} from './scsi';

describe('parseScsi — a controller in HBA mode', () => {
  const table = parseScsi(fixture('server'));

  /** The record is three lines: the address, the INQUIRY, and the type. */
  it('reads three lines as one device', () => {
    expect(table.devices).toHaveLength(7);
    expect(table.devices[0]).toMatchObject({
      host: 0,
      channel: 0,
      id: 0,
      lun: 0,
      vendor: 'SEAGATE',
      model: 'ST4000NM0035',
      rev: 'TT31',
      type: 'Direct-Access',
      revision: 6,
      ccs: false,
    });
  });

  it('keeps all three lines in the raw record', () => {
    expect(table.devices[0]!.raw.split('\n')).toHaveLength(3);
    expect(table.devices[0]!.raw).toContain('Host: scsi0');
    expect(table.devices[0]!.raw).toContain('ANSI  SCSI revision: 06');
  });

  /** The four numbers are one address, which is what sysfs and lsscsi use. */
  it('reads the four numbers as the address they are', () => {
    expect(table.devices.map(addressOf)).toEqual([
      '0:0:0:0',
      '0:0:1:0',
      '0:0:2:0',
      '0:0:3:0',
      '0:0:8:0',
      '0:3:0:0',
      '6:0:0:0',
    ]);
    expect(sysfsPathOf(table.devices[0]!)).toBe('/sys/class/scsi_device/0:0:0:0');
  });

  /** One host is one controller port, and the BMC's CD-ROM is on its own. */
  it('groups the devices by the host each is behind', () => {
    expect(hostsOf(table)).toEqual([0, 6]);
    expect(devicesOfHost(table, 0)).toHaveLength(6);
    expect(devicesOfHost(table, 6).map((device) => device.model)).toEqual(['Virtual CDROM0']);
  });

  /** The file prints the type's name; the number behind it is what SPC talks in. */
  it('reads the type name back to the code it stands for', () => {
    expect(typeOf(table.devices[4]!)).toMatchObject({ name: 'Enclosure', code: 0x0d });
    expect(typeOf(table.devices[5]!)).toMatchObject({ name: 'RAID', code: 0x0c });
    expect(typeOf(table.devices[0]!)).toMatchObject({ code: 0x00, driver: 'sd' });
  });

  /** Two of these are devices with no node: the backplane and the controller. */
  it('says which of them a driver gives a node to', () => {
    expect(hasNode(table.devices[0]!)).toBe(true);
    expect(hasNode(table.devices[4]!)).toBe(false);
    expect(hasNode(table.devices[5]!)).toBe(false);
  });

  /** The virtual CD-ROM claims no standard at all, which is the oldest here. */
  it('summarizes the bus, down to the oldest standard on it', () => {
    expect(summarize(table)).toMatchObject({
      devices: 7,
      hosts: [0, 6],
      types: ['Direct-Access', 'Enclosure', 'RAID', 'CD-ROM'],
      ata: [],
      luns: [],
      header: true,
    });
    expect(summarize(table).oldest).toMatchObject({ revision: 0, name: 'no standard claimed' });
  });
});

describe('parseScsi — SATA disks behind libata', () => {
  const table = parseScsi(fixture('sata'));

  /** Every translated disk answers `ATA`, so the vendor says the bridge. */
  it('reads the vendor libata makes up for a disk that has none', () => {
    expect(table.devices.slice(0, 2).map((device) => device.vendor)).toEqual([
      ATA_VENDOR,
      ATA_VENDOR,
    ]);
    expect(table.devices.map(isAtaBridge)).toEqual([true, true, false]);
    expect(summarize(table).ata).toHaveLength(2);
  });

  /** A drive whose name is longer than 16 bytes arrives cut, not wrapped. */
  it('reads a model that fills its field as one that may be the front of a name', () => {
    expect(table.devices[1]!.model).toBe('ST1000LM035-1RK1');
    expect(table.devices[1]!.model).toHaveLength(MODEL_WIDTH);
    expect(isModelCut(table.devices[1]!)).toBe(true);
    expect(summarize(table).cut).toHaveLength(1);
  });

  /**
   * And one cut at a space is cut invisibly: `Samsung SSD 860 EVO 1TB` loses
   * everything past the sixteenth byte, and the sixteenth is a space, so what
   * is left looks like a whole name that did not fill the field.
   */
  it('cannot tell a model cut at a space from one that fits', () => {
    expect(table.devices[0]!.model).toBe('Samsung SSD 860');
    expect(table.devices[0]!.fields.model).toBe('Samsung SSD 860 ');
    expect(isModelCut(table.devices[0]!)).toBe(false);
  });

  /** The optical drive's vendor fills its eight, where the disks' `ATA` does not. */
  it('reads a vendor that fills its field', () => {
    expect(table.devices[2]!.vendor).toBe('HL-DT-ST');
    expect(isVendorCut(table.devices[2]!)).toBe(true);
    expect(isVendorCut(table.devices[0]!)).toBe(false);
    expect(fillsField('HL-DT-ST', VENDOR_WIDTH)).toBe(true);
  });
});

describe('parseScsi — one target holding four devices', () => {
  const table = parseScsi(fixture('usb'));

  /** A card reader's slots are LUNs, which is what the fourth number is for. */
  it('reads four logical units of one target', () => {
    const reader = table.devices.filter((device) => device.host === 5);
    expect(reader.map(addressOf)).toEqual(['5:0:0:0', '5:0:0:1', '5:0:0:2', '5:0:0:3']);
    expect(summarize(table).luns).toHaveLength(3);
    expect(reader.every((device) => sharesTarget(table, device))).toBe(true);
  });

  /** The stick is one target of its own, so nothing shares it. */
  it('tells a target holding several from one holding itself', () => {
    expect(sharesTarget(table, table.devices[0]!)).toBe(false);
    expect(table.devices[0]!.model).toBe('Cruzer Blade');
  });
});

describe('parseScsi — an old parallel bus', () => {
  const table = parseScsi(fixture('legacy'));

  /** Ids on one channel, which is what a real SCSI bus was. */
  it('reads several ids on the one host and channel', () => {
    expect(hostsOf(table)).toEqual([0]);
    expect(table.devices.map((device) => device.id)).toEqual([0, 2, 4, 5, 6]);
  });

  /** The one suffix the kernel ever appends, and only for `scsi_level == 2`. */
  it('reads the CCS a SCSI-1 device gets, against the revision it prints', () => {
    expect(table.devices[1]).toMatchObject({ revision: 1, ccs: true });
    expect(standardOf(table.devices[1]!.revision)).toMatchObject({ name: 'SCSI-1' });
    expect(table.devices.filter((device) => device.ccs)).toHaveLength(1);
  });

  /** Types no modern machine has, and the drivers that would take them. */
  it('names the types beside the disks', () => {
    expect(typeOf(table.devices[2]!)).toMatchObject({
      name: 'Sequential-Access',
      code: 0x01,
      driver: 'st',
    });
    expect(typeOf(table.devices[3]!)).toMatchObject({ name: 'Scanner', code: 0x06, driver: null });
    expect(typeOf(table.devices[4]!)).toMatchObject({ name: 'Processor', code: 0x03 });
  });
});

describe('parseScsi — a hypervisor’s own devices', () => {
  const table = parseScsi(fixture('virtio'));

  /** Four bytes of firmware revision, which is a string and often not a number. */
  it('reads a revision that is not a version number', () => {
    expect(table.devices.map((device) => device.rev)).toEqual(['2.5+', '2.5+']);
    expect(table.devices[0]!.rev).toHaveLength(REV_WIDTH);
  });

  it('reads two targets on the one host', () => {
    expect(table.devices.map(addressOf)).toEqual(['0:0:0:0', '0:0:1:0']);
    expect(summarize(table).types).toEqual(['Direct-Access', 'CD-ROM']);
  });
});

describe('parseScsi — nothing attached', () => {
  /** The header is printed whether or not anything is under it. */
  it('reads the header alone as an answer rather than as a failure', () => {
    const table = parseScsi(fixture('desktop'));

    expect(table.header).toBe(true);
    expect(table.devices).toEqual([]);
    expect(summarize(table)).toMatchObject({ devices: 0, hosts: [], types: [], oldest: null });
  });

  /** Which is what tells that answer from a read that produced nothing. */
  it('tells an empty file from a machine with nothing attached', () => {
    expect(parseScsi('')).toEqual({ devices: [], header: false });
    expect(parseScsi(`${HEADER}\n`).header).toBe(true);
  });
});

describe('parseScsi — the INQUIRY line', () => {
  /**
   * The fields are columns rather than labelled values: a model is sixteen
   * bytes of whatever the device answered with, and one holding ` Rev: ` would
   * split a label reading in the wrong place.
   */
  it('reads the fields by column, so a model holding a label survives', () => {
    const device = parseScsi(
      [
        HEADER,
        'Host: scsi0 Channel: 00 Id: 00 Lun: 00',
        '  Vendor: ACME     Model: AB Rev: CDEFGHIJ Rev: 1.00',
        '  Type:   Direct-Access                    ANSI  SCSI revision: 05',
      ].join('\n'),
    ).devices[0]!;

    expect(device.model).toBe('AB Rev: CDEFGHIJ');
    expect(device.rev).toBe('1.00');
  });

  /** And by label where the columns are gone, which is the honest fallback. */
  it('falls back to the labels when the padding has been stripped', () => {
    const device = parseScsi(
      [
        HEADER,
        'Host: scsi0 Channel: 00 Id: 00 Lun: 00',
        '  Vendor: ATA Model: VBOX HARDDISK Rev: 1.0',
        '  Type:   Direct-Access ANSI  SCSI revision: 05',
      ].join('\n'),
    ).devices[0]!;

    expect(device).toMatchObject({ vendor: 'ATA', model: 'VBOX HARDDISK', rev: '1.0' });
    expect(isModelCut(device)).toBe(false);
  });

  /**
   * A record can arrive with the address and nothing else — a truncated read,
   * or a shape this parser does not know. The device is still a device, and
   * which of its lines went missing is what the page shows the raw record for.
   */
  it('says which lines of a record it could not read', () => {
    const table = parseScsi([HEADER, 'Host: scsi0 Channel: 00 Id: 00 Lun: 00'].join('\n'));

    expect(table.devices).toHaveLength(1);
    expect(missingLines(table.devices[0]!)).toEqual(['inquiry', 'type']);
    expect(addressOf(table.devices[0]!)).toBe('0:0:0:0');
  });

  it('says nothing is missing from a record that has all three lines', () => {
    expect(missingLines(parseScsi(fixture('virtio')).devices[0]!)).toEqual([]);
  });

  /** A line belonging to no address is not a record, and starts nothing. */
  it('ignores lines with no address above them', () => {
    expect(parseScsi(`${HEADER}\n  Vendor: ACME     Model: X                Rev: 1\n`)).toEqual({
      devices: [],
      header: true,
    });
  });
});

describe('standardOf', () => {
  /** The printed number is the ANSI version, three bits of it. */
  it('names the standard each revision is', () => {
    expect(standardOf(2)).toMatchObject({ name: 'SCSI-2' });
    expect(standardOf(5)).toMatchObject({ name: 'SPC-3' });
    expect(standardOf(6)).toMatchObject({ name: 'SPC-4' });
  });

  /** Seven is the ceiling of the field, so it is where newer devices stop. */
  it('reads 7 as the ceiling rather than as SPC-5 exactly', () => {
    expect(standardOf(7)!.name).toBe('SPC-5 or later');
    expect(standardOf(8)).toBeNull();
    expect(standardOf(null)).toBeNull();
  });
});
