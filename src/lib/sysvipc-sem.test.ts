import { describe, expect, it } from 'vitest';
import { readSysvipcSemFixture as fixture } from '../test/fixtures';
import {
  formatPermissions,
  formatTime,
  isAtSemmsl,
  isOverflowId,
  isPrivate,
  isSingle,
  keyHex,
  ownerChanged,
  parseSem,
  permissionsOf,
  sequenceOf,
  slotOf,
  summarize,
  wasNeverUsed,
  wasSetAfterUse,
} from './sysvipc-sem';

describe('parseSem — a desktop session', () => {
  const info = parseSem(fixture('desktop'));

  it('reads every field of a line', () => {
    expect(info.sets[0]).toEqual({
      key: 1330400761,
      semid: 0,
      mode: 0o600,
      nsems: 1,
      uid: 1000,
      gid: 1000,
      cuid: 1000,
      cgid: 1000,
      otime: 1786700468,
      ctime: 1786689672,
    });
  });

  it('leaves the header out of the sets', () => {
    expect(info.sets).toHaveLength(4);
  });

  /** Ten columns, and `perms` the one that is octal. */
  it('reads perms as octal, and as permissions alone', () => {
    const set = info.sets[0]!;

    expect(set.mode).toBe(0o600);
    // Unlike a segment's, a set's mode carries no flags above the permissions.
    expect(permissionsOf(set)).toBe(set.mode);
    expect(formatPermissions(set)).toBe('rw-------');
    expect(formatPermissions(info.sets[1]!)).toBe('rw-rw-rw-');
  });

  /**
   * `nsems` is the size of the set. The values are not in this file at all, so
   * a set of 8 is eight semaphores of unknown worth.
   */
  it('reads nsems as the size of the set', () => {
    expect(info.sets.map((set) => set.nsems)).toEqual([1, 4, 2, 8]);
    expect(isSingle(info.sets[0]!)).toBe(true);
    expect(isSingle(info.sets[1]!)).toBe(false);
  });

  /** An otime of 0 is the file saying no semop has ever run on the set. */
  it('finds the set nothing has ever operated on', () => {
    const summary = summarize(info);

    expect(summary.neverUsed.map((set) => set.semid)).toEqual([32769]);
    expect(summary.neverUsedSemaphores).toBe(4);
    expect(wasNeverUsed(info.sets[0]!)).toBe(false);
  });

  /**
   * `ctime` moves for `SETVAL` and `SETALL` as well as `IPC_SET`, so a ctime
   * past the otime is somebody writing the values rather than waiting on them.
   */
  it('sees the values written after the last operation', () => {
    const written = info.sets.find((set) => set.semid === 98307)!;

    expect(wasSetAfterUse(written)).toBe(true);
    expect(written.ctime).toBeGreaterThan(written.otime);
    // A set nothing has operated on is not one of those: there is no operation
    // for the change to come after.
    expect(wasSetAfterUse(info.sets[1]!)).toBe(false);
    expect(wasSetAfterUse(info.sets[0]!)).toBe(false);
  });

  /** `semctl(IPC_SET)` moves the owner and leaves the creator alone. */
  it('sees ownership that has been handed on', () => {
    const given = info.sets.find((set) => set.semid === 2)!;

    expect(ownerChanged(given)).toBe(true);
    expect([given.uid, given.gid, given.cuid, given.cgid]).toEqual([1000, 44, 0, 0]);
    expect(ownerChanged(info.sets[0]!)).toBe(false);
  });

  it('tells a private set from a keyed one', () => {
    expect(isPrivate(info.sets.find((set) => set.semid === 98307)!)).toBe(true);
    expect(isPrivate(info.sets[0]!)).toBe(false);
    expect(keyHex(info.sets[0]!)).toBe('0x4f4c4df9');
  });

  /** The id is a sequence number above a slot, as it is for every IPC object. */
  it('reads the id as the slot and the sequence in it', () => {
    expect(slotOf(info.sets[0]!)).toBe(0);
    expect(sequenceOf(info.sets[0]!)).toBe(0);
    expect(slotOf(info.sets[1]!)).toBe(1);
    expect(sequenceOf(info.sets[1]!)).toBe(1);
    expect(slotOf(info.sets[3]!)).toBe(3);
    expect(sequenceOf(info.sets[3]!)).toBe(3);
  });

  it('summarizes the sets and the semaphores in them', () => {
    const summary = summarize(info);

    expect(summary.sets).toBe(4);
    expect(summary.semaphores).toBe(1 + 4 + 2 + 8);
    expect(summary.largest).toBe(8);
    expect(summary.mutexes).toBe(1);
  });
});

describe('parseSem — a database host', () => {
  const info = parseSem(fixture('database-server'));

  /** PostgreSQL takes sets of 17 under keys that count up from the port. */
  it('reads a run of sets of the same size', () => {
    const postgres = info.sets.filter((set) => set.nsems === 17);

    expect(postgres).toHaveLength(5);
    expect(postgres.map((set) => set.key)).toEqual([
      5432001, 5432002, 5432003, 5432004, 5432005,
    ]);
    expect(summarize(info).semaphores).toBe(5 * 17 + 250);
  });

  /** `key_t` is signed, so a key with its top bit set prints negative. */
  it('reads a signed key back as the bit pattern it is', () => {
    const big = info.sets.find((set) => set.nsems === 250)!;

    expect(big.key).toBe(-1910767614);
    expect(keyHex(big)).toBe('0x8e1c0002');
  });

  it('finds the largest set', () => {
    expect(summarize(info).largest).toBe(250);
    expect(isAtSemmsl(info.sets.find((set) => set.nsems === 250)!)).toBe(false);
  });
});

describe('parseSem — sets nothing has used', () => {
  const info = parseSem(fixture('never-used'));

  /** What a service that died between `semget` and `semop` leaves behind. */
  it('reads every set as never operated on', () => {
    const summary = summarize(info);

    expect(summary.sets).toBe(3);
    expect(summary.neverUsed).toHaveLength(3);
    expect(summary.neverUsedSemaphores).toBe(1 + 1 + 16);
    expect(info.sets.every((set) => set.otime === 0)).toBe(true);
    // Every one of them was still *created* at some point, which is the only
    // time this file has for them.
    expect(info.sets.every((set) => set.ctime > 0)).toBe(true);
  });
});

describe('parseSem — an IPC namespace of its own', () => {
  const info = parseSem(fixture('ipc-namespace'));

  /** An owner with no mapping in the reader's user namespace. */
  it('sees the overflow id an unmapped owner reads as', () => {
    const unmapped = info.sets.find((set) => set.semid === 98307)!;

    expect(unmapped.uid).toBe(65534);
    expect(isOverflowId(unmapped.uid)).toBe(true);
    expect(isOverflowId(info.sets[0]!.uid)).toBe(false);
    // Owner and creator agree, so nothing was handed on — both are unmapped.
    expect(ownerChanged(unmapped)).toBe(false);
  });

  it('reads an id from a slot that has been used before', () => {
    const reused = info.sets.find((set) => set.semid === 131076)!;

    expect(slotOf(reused)).toBe(4);
    expect(sequenceOf(reused)).toBe(4);
  });
});

describe('parseSem — the ends of nsems', () => {
  const info = parseSem(fixture('semmsl-limit'));

  /** 32,000 is `SEMMSL`, so a set of that size is at the ceiling. */
  it('reads a set at the per-set ceiling beside a set of one', () => {
    expect(info.sets.map((set) => set.nsems)).toEqual([32000, 1]);
    expect(isAtSemmsl(info.sets[0]!)).toBe(true);
    expect(isAtSemmsl(info.sets[1]!)).toBe(false);
    expect(isSingle(info.sets[1]!)).toBe(true);
    expect(summarize(info).semaphores).toBe(32001);
  });
});

describe('parseSem — a machine with no semaphore sets', () => {
  const info = parseSem(fixture('no-sets'));

  it('reads the header and no sets', () => {
    expect(info.sets).toEqual([]);
  });

  it('summarizes nothing as nothing', () => {
    const summary = summarize(info);

    expect(summary.sets).toBe(0);
    expect(summary.semaphores).toBe(0);
    expect(summary.largest).toBe(0);
    expect(summary.neverUsed).toEqual([]);
  });
});

describe('parseSem — shapes the fixtures do not have', () => {
  it('reads an empty file as no sets rather than as a failure', () => {
    expect(parseSem('')).toEqual({ sets: [] });
    expect(parseSem('\n\n')).toEqual({ sets: [] });
  });

  it('skips a line that is not a set', () => {
    const text = [
      '       key      semid perms      nsems   uid   gid  cuid  cgid      otime      ctime',
      'this is not a set',
      '      4242          0   600          1  1000  1000  1000  1000 1786700468 1786689672',
      '      4242          0   600',
      '',
    ].join('\n');

    expect(parseSem(text).sets).toHaveLength(1);
  });

  /**
   * A key wide enough to overflow its `%10d` pushes the rest of the line right,
   * which is why nothing here reads by column.
   */
  it('reads a line a wide key has pushed right', () => {
    const text = [
      '       key      semid perms      nsems   uid   gid  cuid  cgid      otime      ctime',
      '-1910767614     163845   640        250  1001  1002  1001  1002 1786658745 1785449147',
      '',
    ].join('\n');

    const set = parseSem(text).sets[0]!;

    expect(set.key).toBe(-1910767614);
    expect(set.semid).toBe(163845);
    expect(set.nsems).toBe(250);
    expect(set.ctime).toBe(1785449147);
  });
});

describe('formatting', () => {
  it('writes the permission bits the way ipcs does', () => {
    const set = (mode: number) => ({ mode }) as never;

    expect(formatPermissions(set(0o600))).toBe('rw-------');
    expect(formatPermissions(set(0o666))).toBe('rw-rw-rw-');
    expect(formatPermissions(set(0o640))).toBe('rw-r-----');
  });

  /** A time of 0 is never rather than 1970, for both of these columns. */
  it('writes a timestamp as the moment it is, and never as never', () => {
    expect(formatTime(1786700468)).toBe('2026-08-14 09:41:08 UTC');
    expect(formatTime(0)).toBeNull();
  });
});
