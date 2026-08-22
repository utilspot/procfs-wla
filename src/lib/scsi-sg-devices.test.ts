import { describe, expect, it } from 'vitest';
import { readSgDevicesFixture as fixture } from '../test/fixtures';
import {
  addressOf,
  COLUMNS,
  isBusy,
  isOffline,
  isPlaceholder,
  nodeOf,
  parseSgDevices,
  PLACEHOLDER,
  queueUse,
  summarize,
  typeOf,
} from './scsi-sg-devices';

describe('parseSgDevices — a small machine', () => {
  const table = parseSgDevices(fixture('stock'));

  it('reads the nine numbers device_hdr names', () => {
    expect(COLUMNS).toEqual([
      'host',
      'chan',
      'id',
      'lun',
      'type',
      'opens',
      'qdepth',
      'busy',
      'online',
    ]);
    expect(table.devices[0]).toMatchObject({
      host: 0,
      channel: 0,
      id: 0,
      lun: 0,
      type: 5,
      opens: 1,
      qdepth: 1,
      busy: 0,
      online: 1,
    });
  });

  /** No column names the sg device: the line's position is what does. */
  it('takes the node from the position rather than from a field', () => {
    expect(table.devices.map(nodeOf)).toEqual(['/dev/sg0', '/dev/sg1']);
    expect(table.devices.map((device) => device.index)).toEqual([0, 1]);
  });

  /** The first four numbers are the address /proc/scsi/scsi prints in words. */
  it('reads the four numbers as the address the other pages use', () => {
    expect(table.devices.map(addressOf)).toEqual(['0:0:0:0', '2:0:0:0']);
  });

  /** And the type as a number, where that file gives the name. */
  it('reads the type number back to the name the other file prints', () => {
    expect(typeOf(table.devices[0]!)).toMatchObject({ name: 'CD-ROM', code: 5 });
    expect(typeOf(table.devices[1]!)).toMatchObject({ name: 'Direct-Access', code: 0 });
  });

  /** An optical drive takes one command at a time; the disk takes thirty-two. */
  it('reads the queue each device is given', () => {
    expect(table.devices.map((device) => device.qdepth)).toEqual([1, 32]);
    expect(queueUse(table.devices[1]!)).toBe(0);
    expect(summarize(table).deepestQueue).toBe(32);
  });

  it('summarizes a machine with nothing in flight', () => {
    expect(summarize(table)).toMatchObject({
      lines: 2,
      placeholders: [],
      offline: [],
      busy: [],
      inFlight: 0,
      unread: [],
    });
  });
});

describe('parseSgDevices — the RAID machine', () => {
  const table = parseSgDevices(fixture('server'));

  /** One line per device the midlayer attached, in the same order. */
  it('gives a node to every device, the ones with no block driver included', () => {
    expect(table.devices).toHaveLength(7);
    expect(nodeOf(table.devices[4]!)).toBe('/dev/sg4');
    expect(typeOf(table.devices[4]!)).toMatchObject({ name: 'Enclosure' });
    expect(typeOf(table.devices[5]!)).toMatchObject({ name: 'RAID' });
  });

  /** `busy` is the one number here that changes between two reads. */
  it('reads what was in flight when the file was read', () => {
    const summary = summarize(table);

    expect(summary.busy.map(nodeOf)).toEqual(['/dev/sg0', '/dev/sg2']);
    expect(summary.inFlight).toBe(7);
    expect(isBusy(table.devices[1]!)).toBe(false);
  });

  it('reads a queue against what is in it', () => {
    expect(queueUse(table.devices[2]!)).toBeCloseTo(5 / 64);
    expect(queueUse(table.devices[4]!)).toBe(0);
  });
});

describe('parseSgDevices — a device that has gone', () => {
  const table = parseSgDevices(fixture('detaching'));

  /**
   * The line stays as nine -1s: dropping it would renumber every device under
   * it, and the numbering is the only thing naming them.
   */
  it('keeps the placeholder line, and the numbering it holds open', () => {
    expect(table.devices).toHaveLength(3);
    expect(isPlaceholder(table.devices[1]!)).toBe(true);
    expect(PLACEHOLDER).toBe(-1);
    expect(table.devices.map(nodeOf)).toEqual(['/dev/sg0', '/dev/sg1', '/dev/sg2']);
  });

  /** Nothing is read out of a line that says the device is not there. */
  it('reads no address, type or state out of a placeholder', () => {
    const gone = table.devices[1]!;

    expect(addressOf(gone)).toBeNull();
    expect(typeOf(gone)).toBeNull();
    expect(isOffline(gone)).toBe(false);
    expect(isBusy(gone)).toBe(false);
    expect(queueUse(gone)).toBeNull();
  });

  it('counts the lines and the devices apart', () => {
    const summary = summarize(table);

    expect(summary.lines).toBe(3);
    expect(summary.present).toHaveLength(2);
    expect(summary.placeholders).toHaveLength(1);
  });
});

describe('parseSgDevices — a device the midlayer has stopped talking to', () => {
  const table = parseSgDevices(fixture('offline'));

  /** Offline is not gone: the device is there and its line is real. */
  it('tells an offline device from a placeholder', () => {
    expect(isOffline(table.devices[0]!)).toBe(true);
    expect(isPlaceholder(table.devices[0]!)).toBe(false);
    expect(addressOf(table.devices[0]!)).toBe('0:0:0:0');
    expect(summarize(table).offline).toHaveLength(1);
  });

  it('still reads the queue of the one that is online', () => {
    expect(isOffline(table.devices[1]!)).toBe(false);
    expect(summarize(table).inFlight).toBe(3);
  });
});

describe('parseSgDevices — files with no devices in them', () => {
  /** The driver prints a line per device and nothing else, so none is none. */
  it('reads an empty file as a driver with no device', () => {
    expect(parseSgDevices('')).toEqual({ devices: [], unread: [] });
    expect(summarize(parseSgDevices('\n'))).toMatchObject({ lines: 0, deepestQueue: null });
  });

  it('keeps a line that is not nine numbers rather than reading one into it', () => {
    const table = parseSgDevices('0\t0\t0\t0\t0\t1\t64\t0\t1\nsomething else\n');

    expect(table.devices).toHaveLength(1);
    expect(table.unread).toEqual(['something else']);
  });

  /** A short line is not a device either: nine columns or nothing. */
  it('refuses a line with the wrong number of columns', () => {
    expect(parseSgDevices('0\t0\t0\t0\t5\t1\t1\t0\n').devices).toEqual([]);
    expect(parseSgDevices('0\t0\t0\t0\t5\t1\t1\t0\t1\t9\n').devices).toEqual([]);
  });
});
