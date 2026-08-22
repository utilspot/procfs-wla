import { describe, expect, it } from 'vitest';
import {
  DT_DIR,
  DT_REG,
  holdsProcesses,
  isProcess,
  readDirectory,
  type Listing,
} from './directory';

/** A small `/proc`: two of its own directories, two files, three processes. */
const listing: Listing = {
  sys: DT_DIR,
  net: DT_DIR,
  cpuinfo: DT_REG,
  meminfo: DT_REG,
  1: DT_DIR,
  9: DT_DIR,
  12282: DT_DIR,
};

describe('isProcess', () => {
  it('takes a pid, or the kernel’s own names for one', () => {
    expect(isProcess('1')).toBe(true);
    expect(isProcess('12282')).toBe(true);
    expect(isProcess('self')).toBe(true);
    expect(isProcess('thread-self')).toBe(true);
  });

  /** `/proc`'s own directories sit beside the processes and are not them. */
  it('takes none of /proc’s own directories', () => {
    for (const name of ['sys', 'net', 'irq', 'bus', 'driver', 'fs', 'tty', 'acpi']) {
      expect(isProcess(name), name).toBe(false);
    }
  });
});

/**
 * A number naming a directory means something different at every depth, and
 * only at the top does it mean a process.
 */
describe('holdsProcesses', () => {
  it('is /proc itself, slash or no slash', () => {
    expect(holdsProcesses('/proc')).toBe(true);
    expect(holdsProcesses('/proc/')).toBe(true);
  });

  it('is nowhere below it', () => {
    for (const path of [
      '/proc/irq',
      '/proc/12282',
      '/proc/12282/task',
      '/proc/12282/net',
      '/proc/bus/pci/00',
      '/proc/sys',
    ]) {
      expect(holdsProcesses(path), path).toBe(false);
    }
  });

  it('is not a path that merely starts the same way', () => {
    expect(holdsProcesses('/procfs')).toBe(false);
    expect(holdsProcesses('/proc2')).toBe(false);
    expect(holdsProcesses('/')).toBe(false);
  });
});

describe('readDirectory', () => {
  it('reads a name and a kind out of each entry', () => {
    const directory = readDirectory(listing);
    const byName = new Map(directory.entries.map((entry) => [entry.name, entry]));

    expect(byName.get('cpuinfo')).toEqual({
      name: 'cpuinfo',
      kind: 'file',
      path: '/proc/cpuinfo',
      process: false,
    });
    expect(byName.get('sys')).toEqual({
      name: 'sys',
      kind: 'directory',
      path: '/proc/sys',
      process: false,
    });
    expect(byName.get('12282')).toEqual({
      name: '12282',
      kind: 'directory',
      path: '/proc/12282',
      process: true,
    });
  });

  /**
   * `/proc/irq` is full of numbered directories and not one of them is a
   * process: they are interrupt lines. The same goes for the threads under
   * `/proc/<pid>/task`. Only the top of `/proc` holds processes.
   */
  it('reads a number below /proc as the directory it is, not as a process', () => {
    const irq = readDirectory({ 0: DT_DIR, 7: DT_DIR, 16: DT_DIR }, '/proc/irq');

    expect(irq.entries.every((entry) => !entry.process)).toBe(true);
    expect(irq.entries[0]).toEqual({
      name: '0',
      kind: 'directory',
      path: '/proc/irq/0',
      process: false,
    });
    // Nothing ranks them apart from the other directories now, so they sort
    // numerically among them rather than into a group of their own.
    expect(irq.entries.map((entry) => entry.name)).toEqual(['0', '7', '16']);
  });

  it('reads the threads of a process as directories, not as processes', () => {
    const task = readDirectory({ 12282: DT_DIR, 12283: DT_DIR }, '/proc/12282/task');

    expect(task.entries.map((entry) => entry.process)).toEqual([false, false]);
  });

  /** `self` is a process at the top and a name like any other below it. */
  it('reads even the kernel’s own names as ordinary below /proc', () => {
    expect(readDirectory({ self: DT_DIR }, '/proc').entries[0]!.process).toBe(true);
    expect(readDirectory({ self: DT_DIR }, '/proc/12282/net').entries[0]!.process).toBe(false);
  });

  /**
   * The backend emits two `d_type` values and skips the rest, so anything else
   * arriving is something this cannot place — and guessing would put a wrong
   * kind beside a real name.
   */
  it('drops an entry whose type it cannot place', () => {
    const directory = readDirectory({ cpuinfo: DT_REG, self: 10, mystery: 0 });

    expect(directory.entries.map((entry) => entry.name)).toEqual(['cpuinfo']);
  });

  /**
   * Readdir order is no order to read `/proc` in. Directories first, then
   * files, then the processes — which on a real machine are most of the list
   * and the least likely thing to be scanning for by eye.
   */
  it('orders the entries by what they are, then by name', () => {
    expect(readDirectory(listing).entries.map((entry) => entry.name)).toEqual([
      'net',
      'sys',
      'cpuinfo',
      'meminfo',
      '1',
      '9',
      '12282',
    ]);
  });

  /** So `10` follows `9` rather than sorting between `1` and `2`. */
  it('sorts numbered names as numbers', () => {
    const directory = readDirectory({ 2: DT_DIR, 10: DT_DIR, 1: DT_DIR, 21: DT_DIR, 9: DT_DIR });

    expect(directory.entries.map((entry) => entry.name)).toEqual(['1', '2', '9', '10', '21']);
  });

  it('reads /proc unless told otherwise', () => {
    expect(readDirectory(listing).path).toBe('/proc');
    expect(readDirectory({ osrelease: DT_REG }, '/proc/sys/kernel').entries[0]?.path).toBe(
      '/proc/sys/kernel/osrelease',
    );
    // A trailing slash on the directory does not double up in the entry.
    expect(readDirectory({ cpuinfo: DT_REG }, '/proc/').entries[0]?.path).toBe('/proc/cpuinfo');
  });

  /** A directory that reads empty is an answer, not a failure. */
  it('reads an empty listing as an empty directory', () => {
    expect(readDirectory({}).entries).toEqual([]);
  });
});
