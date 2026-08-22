import { describe, expect, it } from 'vitest';
import { readTtyDriversFixture as fixture } from '../test/fixtures';
import {
  callouts,
  describeType,
  isUnnamed,
  kindOf,
  minorCount,
  minorRange,
  parseTtyDrivers,
  summarize,
} from './tty-drivers';

describe('parseTtyDrivers — an ordinary laptop', () => {
  const drivers = parseTtyDrivers(fixture('desktop'));
  const find = (device: string) => drivers.find((driver) => driver.device === device);

  it('reads the name, device, numbers and type', () => {
    expect(drivers.find((driver) => driver.name === 'usbserial')).toEqual({
      name: 'usbserial',
      device: '/dev/ttyUSB',
      major: 188,
      minors: { first: 0, last: 511 },
      type: 'serial',
      pseudo: false,
    });
  });

  /**
   * The kernel prints a single minor as one number and several as a range, so
   * the two spellings have to come out as the same shape.
   */
  it('reads a driver claiming one minor as a range of one', () => {
    const printk = drivers.find((driver) => driver.name === 'ttyprintk')!;

    expect(printk.minors).toEqual({ first: 3, last: 3 });
    expect(minorCount(printk)).toBe(1);
    expect(minorRange(printk)).toBe('3');
  });

  it('counts the numbers a range reserves', () => {
    expect(minorCount(find('/dev/ttyS')!)).toBe(32);
    expect(minorRange(find('/dev/ttyS')!)).toBe('64-95');
    expect(minorCount(find('/dev/pts')!)).toBe(1048576);
  });

  /**
   * The four the kernel hard-codes ahead of the list are devices, not drivers.
   * Counting the lines counts them as drivers, which is the mistake this page
   * exists to head off.
   */
  it('tells the four pseudo-devices from the drivers', () => {
    const summary = summarize(drivers);

    expect(summary.total).toBe(12);
    expect(summary.pseudo.map((driver) => driver.name)).toEqual([
      '/dev/tty',
      '/dev/console',
      '/dev/ptmx',
      '/dev/vc/0',
    ]);
    expect(summary.drivers).toHaveLength(8);
    expect(summary.drivers.every((driver) => !driver.pseudo)).toBe(true);
  });

  it('reads the VT driver the kernel never named', () => {
    const vt = drivers.find(isUnnamed)!;

    expect(vt.name).toBe('unknown');
    expect(vt.device).toBe('/dev/tty');
    expect(vt.type).toBe('console');
    // A name it shares with the first pseudo-device, which it is not.
    expect(vt.pseudo).toBe(false);
    expect(summarize(drivers).unnamed).toEqual([vt]);
  });

  it('groups the drivers by the part of the type before the colon', () => {
    expect(summarize(drivers).kinds).toEqual([
      { kind: 'serial', count: 4 },
      { kind: 'console', count: 2 },
      { kind: 'pty', count: 2 },
    ]);
    expect(kindOf(find('/dev/pts')!)).toBe('pty');
    expect(kindOf(find('/dev/ttyS')!)).toBe('serial');
  });

  it('adds up the device numbers reserved, and the majors in use', () => {
    const summary = summarize(drivers);

    // The two pty drivers are all but 1124 of it.
    expect(summary.minors).toBe(2098276);
    expect(summary.majors).toEqual([4, 5, 128, 136, 166, 188, 216]);
  });

  it('finds no callout device on a kernel of this century', () => {
    expect(callouts(drivers)).toEqual([]);
  });
});

describe('parseTtyDrivers — the other machines', () => {
  it('reads two serial drivers on a Raspberry Pi', () => {
    const summary = summarize(parseTtyDrivers(fixture('raspberry-pi')));
    const serial = summary.drivers.filter((driver) => kindOf(driver) === 'serial');

    expect(serial.map((driver) => driver.device)).toEqual(['/dev/ttyAMA', '/dev/ttyS']);
    expect(serial.map((driver) => driver.major)).toEqual([204, 4]);
  });

  /** A hypervisor console is typed `system`, not `serial`, though it is a line. */
  it('reads the hypervisor console on a virtio guest as a system driver', () => {
    const hvc = parseTtyDrivers(fixture('vm-guest')).find((driver) => driver.name === 'hvc')!;

    expect(hvc.type).toBe('system');
    expect(hvc.pseudo).toBe(false);
    expect(minorCount(hvc)).toBe(8);
  });

  it('reads a kernel with no virtual terminals at all', () => {
    const summary = summarize(parseTtyDrivers(fixture('minimal')));

    expect(summary.drivers).toHaveLength(3);
    expect(summary.kinds).toEqual([
      { kind: 'pty', count: 2 },
      { kind: 'serial', count: 1 },
    ]);
    // The four are printed whatever else the kernel has, so they are still here.
    expect(summary.pseudo).toHaveLength(4);
    expect(summary.unnamed).toEqual([]);
  });

  it('finds the callout device an old kernel still registers', () => {
    const drivers = parseTtyDrivers(fixture('legacy-callout'));
    const [cua] = callouts(drivers);

    expect(cua?.device).toBe('/dev/cua');
    expect(cua?.type).toBe('serial:callout');
    expect(kindOf(cua!)).toBe('serial');
    // Two lines, same driver name, different device — so neither shadows the other.
    expect(drivers.filter((driver) => driver.name === 'serial')).toHaveLength(2);
  });
});

describe('describeType', () => {
  it('reads the whole field rather than the part before the colon', () => {
    expect(describeType('system:console')).toMatch(/\/dev\/console/);
    expect(describeType('system:vtmaster')).toMatch(/virtual console/);
    // `system` alone is /dev/ptmx, which is not what either of those is.
    expect(describeType('system')).toMatch(/ptmx/);
  });

  it('tells the two halves of a pty pair apart', () => {
    expect(describeType('pty:master')).toMatch(/master/);
    expect(describeType('pty:slave')).toMatch(/slave/);
  });

  it('says so for the numbers the kernel falls back to', () => {
    expect(describeType('type:9.0')).toMatch(/no name for/);
  });

  it('says so for a field it does not know', () => {
    expect(describeType('teletype')).toBe('an unknown driver type');
  });
});

describe('parseTtyDrivers — lines it cannot read', () => {
  it('keeps a driver whose type the kernel had no name for', () => {
    const drivers = parseTtyDrivers(
      'nine                 /dev/ttyNINE    9      12 type:9.0\n',
    );

    expect(drivers).toHaveLength(1);
    expect(drivers[0]!.type).toBe('type:9.0');
    expect(kindOf(drivers[0]!)).toBe('type');
  });

  it('skips a line that is not five columns', () => {
    expect(parseTtyDrivers('serial /dev/ttyS 4 64-95\n\n  \n')).toEqual([]);
  });

  it('reads a file served with CRLF line endings', () => {
    const drivers = parseTtyDrivers('serial               /dev/ttyS       4 64-95 serial\r\n');

    expect(drivers).toHaveLength(1);
    expect(drivers[0]!.type).toBe('serial');
  });

  it('summarizes an empty file without dividing by anything', () => {
    expect(summarize([])).toEqual({
      total: 0,
      drivers: [],
      pseudo: [],
      minors: 0,
      majors: [],
      unnamed: [],
      callouts: [],
      kinds: [],
    });
  });
});
