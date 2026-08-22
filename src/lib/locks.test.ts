import { describe, expect, it } from 'vitest';
import { readLocksFixture as fixture } from '../test/fixtures';
import {
  countKinds,
  describeKind,
  fileOf,
  isLease,
  isOwnedByProcess,
  isWholeFile,
  lengthOf,
  parseLocks,
  summarize,
  waitersOf,
} from './locks';

describe('parseLocks — an ordinary desktop', () => {
  const info = parseLocks(fixture('desktop'));

  it('reads every field of a line', () => {
    expect(info.locks[0]).toEqual({
      id: 1,
      waiting: false,
      kind: 'POSIX',
      enforcement: 'ADVISORY',
      access: 'READ',
      pid: 5433,
      major: 8,
      minor: 1,
      inode: 7864448,
      start: 128,
      end: 128,
    });
  });

  /**
   * The device numbers are printed in hex and the inode beside them in
   * decimal, which is the trap in this file.
   */
  it('decodes the device numbers from hex', () => {
    const dm = info.locks.find((lock) => lock.inode === 32388)!;

    // `00:2f` is minor 47, not 2f and not 29.
    expect(dm.major).toBe(0);
    expect(dm.minor).toBe(47);
    expect(fileOf(dm)).toBe('0:47:32388');
    expect(fileOf(info.locks[0]!)).toBe('8:1:7864448');
  });

  /**
   * Both ends are inclusive, so `128 128` is one byte rather than none, and
   * `0 EOF` is the whole file however it grows.
   */
  it('reads an inclusive range', () => {
    expect(lengthOf(info.locks[0]!)).toBe(1);
    expect(lengthOf(info.locks.find((lock) => lock.start === 1826)!)).toBe(510);
    // `0 0` is the first byte alone, which is how a whole-file lock is faked.
    expect(lengthOf(info.locks.find((lock) => lock.pid === 764)!)).toBe(1);
  });

  it('reads a lock running to the end of the file', () => {
    const flock = info.locks[1]!;

    expect(flock.end).toBeNull();
    expect(lengthOf(flock)).toBeNull();
    expect(isWholeFile(flock)).toBe(true);
    expect(isWholeFile(info.locks[0]!)).toBe(false);
  });

  /**
   * An OFD lock belongs to an open file description, so there is no process to
   * name and the kernel writes -1.
   */
  it('reads an OFD lock as owned by no process', () => {
    const ofd = info.locks.find((lock) => lock.kind === 'OFDLCK')!;

    expect(ofd.pid).toBe(-1);
    expect(isOwnedByProcess(ofd)).toBe(false);
    expect(isOwnedByProcess(info.locks[0]!)).toBe(true);
  });

  it('counts the kinds and the processes holding locks', () => {
    const summary = summarize(info);

    expect(summary).toMatchObject({ total: 8, held: 8, writes: 5 });
    // 5433, 2001, 1568, 699, 764, 3548 — the OFD lock has no process.
    expect(summary.processes).toBe(6);
    expect(countKinds(info)).toEqual([
      { kind: 'POSIX', count: 5 },
      { kind: 'FLOCK', count: 2 },
      { kind: 'OFDLCK', count: 1 },
    ]);
  });
});

describe('parseLocks — processes queued behind a lock', () => {
  const info = parseLocks(fixture('blocked-waiters'));

  // A waiter is a `->` line carrying the number of the lock it waits on.
  it('reads a waiter as waiting on the lock above it', () => {
    expect(info.locks[1]).toMatchObject({ id: 1, waiting: true, pid: 3811 });
    expect(info.locks[0]?.waiting).toBe(false);
  });

  it('gathers the waiters queued behind one lock', () => {
    expect(waitersOf(info, info.locks[0]!).map((lock) => lock.pid)).toEqual([3811, 3902]);
    expect(waitersOf(info, info.locks[3]!).map((lock) => lock.pid)).toEqual([1902]);
    expect(waitersOf(info, info.locks[5]!)).toEqual([]);
  });

  // The held locks are what the machine has; the waiters are queued for them.
  it('counts what is held apart from what is waiting', () => {
    const summary = summarize(info);

    expect(summary).toMatchObject({ total: 6, held: 3 });
    expect(summary.waiting.map((lock) => lock.pid)).toEqual([3811, 3902, 1902]);
  });

  it('decodes a device-mapper major printed in hex', () => {
    // `fd` is 253, the device-mapper major.
    expect(info.locks[0]?.major).toBe(253);
    expect(info.locks[0]?.minor).toBe(0);
  });
});

describe('parseLocks — a database holding byte ranges', () => {
  const info = parseLocks(fixture('byte-ranges'));

  it('reads a range far past where a 32-bit offset would reach', () => {
    const high = info.locks[1]!;

    expect(high.start).toBe(1073741824);
    expect(lengthOf(high)).toBe(64);
  });

  it('reads a page-sized range', () => {
    expect(lengthOf(info.locks[2]!)).toBe(4096);
    expect(lengthOf(info.locks[4]!)).toBe(100);
  });

  it('counts only the whole-file locks as whole-file', () => {
    expect(info.locks.filter((lock) => isWholeFile(lock))).toHaveLength(1);
  });
});

describe('parseLocks — leases and a delegation', () => {
  const info = parseLocks(fixture('leases'));

  /**
   * For a lease the second field is the lease's state, not whether it is
   * advisory — a lease cannot be either.
   */
  it('reads the second field as a lease state', () => {
    expect(info.locks[0]).toMatchObject({ kind: 'LEASE', enforcement: 'ACTIVE' });
    expect(info.locks[1]).toMatchObject({ kind: 'LEASE', enforcement: 'BREAKING' });
    expect(info.locks[2]).toMatchObject({ kind: 'LEASE', enforcement: 'BREAKER' });
    expect(info.locks[3]).toMatchObject({ kind: 'DELEG', enforcement: 'ACTIVE' });

    for (const lock of info.locks.slice(0, 4)) expect(isLease(lock)).toBe(true);
    expect(isLease(info.locks[4]!)).toBe(false);
    expect(info.locks[4]?.enforcement).toBe('ADVISORY');
  });

  it('describes the kinds it knows', () => {
    expect(describeKind('DELEG')).toMatch(/delegation/);
    expect(describeKind('OFDLCK')).toMatch(/open file description/);
    expect(describeKind('WHAT')).toBeNull();
  });
});

describe('parseLocks — nothing locked', () => {
  const info = parseLocks(fixture('no-locks'));

  it('reads an empty file as no locks', () => {
    expect(info.locks).toEqual([]);
    expect(summarize(info)).toMatchObject({ total: 0, held: 0, writes: 0, processes: 0 });
    expect(summarize(info).kinds).toEqual([]);
  });
});

describe('parseLocks — every fixture', () => {
  const names = ['desktop', 'blocked-waiters', 'byte-ranges', 'leases', 'no-locks'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseLocks(fixture(name));
    const summary = summarize(info);

    for (const lock of info.locks) {
      expect(lock.kind).not.toBe('');
      expect(['READ', 'WRITE', 'UNLCK']).toContain(lock.access);
      expect(lock.id).toBeGreaterThan(0);
      expect(lock.start).toBeGreaterThanOrEqual(0);
      if (lock.end !== null) expect(lock.end).toBeGreaterThanOrEqual(lock.start);

      // A lock either names a process or is one nothing owns.
      expect(lock.pid === -1 || lock.pid > 0).toBe(true);
      // The device numbers came out of hex, the inode did not.
      expect(lock.major).not.toBeNull();
      expect(lock.minor).not.toBeNull();
      expect(fileOf(lock)).toBe(`${lock.major}:${lock.minor}:${lock.inode}`);

      // A waiter waits on a lock that is actually in the file.
      if (lock.waiting) {
        expect(info.locks.some((held) => !held.waiting && held.id === lock.id)).toBe(true);
      }
    }

    expect(summary.held + summary.waiting.length).toBe(summary.total);
    expect(summary.kinds.reduce((total, entry) => total + entry.count, 0)).toBe(summary.total);
  });
});

describe('parseLocks — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseLocks('').locks).toEqual([]);
  });

  it('returns nothing for a file that is not /proc/locks', () => {
    expect(parseLocks('processor\t: 0\n').locks).toEqual([]);
  });

  /**
   * Some kernels write a waiter without repeating the number, so it is taken
   * from the lock above rather than left at nothing.
   */
  it('takes a numberless waiter as waiting on the lock above', () => {
    const info = parseLocks(
      '4: POSIX  ADVISORY  WRITE 100 08:01:99 0 EOF\n-> POSIX  ADVISORY  WRITE 200 08:01:99 0 EOF\n',
    );

    expect(info.locks[1]).toMatchObject({ id: 4, waiting: true, pid: 200 });
    expect(waitersOf(info, info.locks[0]!)).toHaveLength(1);
  });

  it('reads a lock with no file behind it', () => {
    const info = parseLocks('1: POSIX  *NOINODE* WRITE 100 <none>:0 0 EOF\n');

    expect(info.locks[0]).toMatchObject({ major: null, minor: null, inode: null });
    expect(fileOf(info.locks[0]!)).toBeNull();
  });

  it('skips a line with a field missing', () => {
    expect(parseLocks('1: POSIX  ADVISORY  WRITE 100 08:01:99 0\n').locks).toEqual([]);
  });

  it('skips a line that is not a lock at all', () => {
    expect(parseLocks('locks: 4\n').locks).toEqual([]);
  });

  // Hex digits that also read as decimal are the ones that catch people out.
  it('reads a device number that looks decimal but is not', () => {
    const info = parseLocks('1: POSIX  ADVISORY  WRITE 100 20:10:99 0 EOF\n');

    expect(info.locks[0]?.major).toBe(32);
    expect(info.locks[0]?.minor).toBe(16);
    expect(info.locks[0]?.inode).toBe(99);
  });

  it('gives a length of nothing for a range that runs backwards', () => {
    const info = parseLocks('1: POSIX  ADVISORY  WRITE 100 08:01:99 500 100\n');

    expect(lengthOf(info.locks[0]!)).toBe(0);
  });

  it('reads an UNLCK access, which a lock being released shows', () => {
    const info = parseLocks('1: POSIX  ADVISORY  UNLCK 100 08:01:99 0 EOF\n');

    expect(info.locks[0]?.access).toBe('UNLCK');
    expect(summarize(info).writes).toBe(0);
  });
});
