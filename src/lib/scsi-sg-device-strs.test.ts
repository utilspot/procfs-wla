import { describe, expect, it } from 'vitest';
import { readSgDeviceStrsFixture as fixture } from '../test/fixtures';
import {
  describe as describeDevice,
  fillsField,
  isAbsent,
  isAtaBridge,
  isModelCut,
  isUnscanned,
  isVendorCut,
  MODEL_WIDTH,
  nodeOf,
  NULL_STRS,
  parseDeviceStrs,
  PLACEHOLDER,
  REV_WIDTH,
  summarize,
  VENDOR_WIDTH,
} from './scsi-sg-device-strs';

describe('parseDeviceStrs — a small machine', () => {
  const table = parseDeviceStrs(fixture('stock'));

  it('reads the three INQUIRY strings of a line', () => {
    expect(table.devices[0]).toMatchObject({
      vendor: 'VBOX',
      model: 'CD-ROM',
      rev: '1.0',
      present: true,
    });
    expect(describeDevice(table.devices[1]!)).toBe('ATA VBOX HARDDISK 1.0');
  });

  /** The padding is the field's, and the page needs it to read a cut name. */
  it('keeps the printed field beside the value it trims', () => {
    expect(table.devices[0]!.fields.vendor).toBe('VBOX    ');
    expect(table.devices[0]!.fields.model).toBe('CD-ROM          ');
    expect(table.devices[0]!.fields.vendor).toHaveLength(VENDOR_WIDTH);
    expect(table.devices[0]!.fields.model).toHaveLength(MODEL_WIDTH);
  });

  /** No column names the device: position does, and it is the same line next door. */
  it('takes the node from the line’s position', () => {
    expect(table.devices.map(nodeOf)).toEqual(['/dev/sg0', '/dev/sg1']);
  });

  /** The same `ATA` that is not a vendor on the page for /proc/scsi/scsi. */
  it('reads the vendor libata answers with', () => {
    expect(isAtaBridge(table.devices[1]!)).toBe(true);
    expect(isAtaBridge(table.devices[0]!)).toBe(false);
    expect(summarize(table).ata).toHaveLength(1);
  });

  it('summarizes the names as the list it is', () => {
    expect(summarize(table)).toMatchObject({
      lines: 2,
      absent: [],
      unscanned: [],
      cut: [],
      vendors: ['VBOX', 'ATA'],
      unread: [],
    });
  });
});

describe('parseDeviceStrs — the RAID machine', () => {
  const table = parseDeviceStrs(fixture('server'));

  /** The same seven devices its `devices` file counts, in the same positions. */
  it('names every device that file gives a number to', () => {
    expect(table.devices).toHaveLength(7);
    expect(describeDevice(table.devices[4]!)).toBe('LSI SMP2X36 0601');
    expect(nodeOf(table.devices[6]!)).toBe('/dev/sg6');
    expect(summarize(table).vendors).toEqual(['SEAGATE', 'LSI', 'AVAGO', 'AMI']);
  });
});

describe('parseDeviceStrs — a device that has gone', () => {
  const table = parseDeviceStrs(fixture('no-active-device'));

  /**
   * Where `devices` prints nine `-1`s this one prints words, and both hold the
   * position open for the same reason.
   */
  it('reads the placeholder as an absence rather than as a name', () => {
    expect(table.devices[1]).toMatchObject({ present: false, vendor: '', model: '', rev: '' });
    expect(isAbsent(table.devices[1]!)).toBe(true);
    expect(table.devices[1]!.raw).toBe(PLACEHOLDER);
    expect(describeDevice(table.devices[1]!)).toBeNull();
  });

  it('keeps the numbering of the devices under it', () => {
    expect(table.devices.map(nodeOf)).toEqual(['/dev/sg0', '/dev/sg1', '/dev/sg2']);
    expect(summarize(table)).toMatchObject({ lines: 3, absent: [table.devices[1]] });
    expect(summarize(table).present).toHaveLength(2);
  });

  /** Nothing else is read out of a line that says there is no device. */
  it('reads no cut field or bridge out of the placeholder', () => {
    expect(isModelCut(table.devices[1]!)).toBe(false);
    expect(isVendorCut(table.devices[1]!)).toBe(false);
    expect(isAtaBridge(table.devices[1]!)).toBe(false);
    expect(isUnscanned(table.devices[1]!)).toBe(false);
  });
});

describe('parseDeviceStrs — a device caught before its scan', () => {
  const table = parseDeviceStrs(fixture('unscanned'));

  /**
   * All three point at one static string until the INQUIRY is read, so the
   * fields are that word cut to 8, 16 and 4.
   */
  it('reads the placeholder strings the midlayer sets before scanning', () => {
    expect(table.devices[0]).toMatchObject({
      vendor: 'nullnull',
      model: NULL_STRS,
      rev: 'null',
      present: true,
    });
    expect(isUnscanned(table.devices[0]!)).toBe(true);
    expect(summarize(table).unscanned).toHaveLength(1);
  });

  /** It is a device, unlike the placeholder line: it is simply not read yet. */
  it('reads it as present, since there is a device behind it', () => {
    expect(isAbsent(table.devices[0]!)).toBe(false);
    expect(isUnscanned(table.devices[1]!)).toBe(false);
  });

  /** The model fills its sixteen here, which is what a cut name looks like. */
  it('reads a field that fills its width', () => {
    expect(isModelCut(table.devices[0]!)).toBe(true);
    expect(isVendorCut(table.devices[1]!)).toBe(true);
    expect(fillsField('LD00', REV_WIDTH)).toBe(true);
  });
});

describe('parseDeviceStrs — lines of other shapes', () => {
  /** The tabs are the separator, and the widths say where they should fall. */
  it('reads a field holding a tab by the columns rather than by the split', () => {
    const line = `AC\tME   \tmodel with a tab\t1.0 `;
    const table = parseDeviceStrs(`${line}\n`);

    expect(table.devices[0]).toMatchObject({
      vendor: 'AC\tME',
      model: 'model with a tab',
      rev: '1.0',
    });
  });

  it('keeps a line that is neither three fields nor the placeholder', () => {
    const table = parseDeviceStrs(`VBOX    \tCD-ROM          \t1.0 \nnonsense\n`);

    expect(table.devices).toHaveLength(1);
    expect(table.unread).toEqual(['nonsense']);
  });

  /** A line per device and nothing else, so an empty file is a driver with none. */
  it('reads an empty file as no devices at all', () => {
    expect(parseDeviceStrs('')).toEqual({ devices: [], unread: [] });
    expect(summarize(parseDeviceStrs('\n'))).toMatchObject({ lines: 0, vendors: [] });
  });
});
