import { describe, expect, it } from 'vitest';
import { readSysvipcShmFixture as fixture } from '../test/fixtures';
import {
  allocatedOf,
  flagsOf,
  formatBytes,
  formatPermissions,
  formatTime,
  hasMemoryColumns,
  isHugePages,
  isLocked,
  isMarkedForDestruction,
  isOrphaned,
  isOverflowId,
  isPidVisible,
  isPrivate,
  isUntouched,
  keyHex,
  ownerChanged,
  parseShm,
  permissionsOf,
  sequenceOf,
  slotOf,
  summarize,
  wasNeverAttached,
} from './sysvipc-shm';

describe('parseShm — a graphical session', () => {
  const info = parseShm(fixture('desktop'));

  it('reads every field of a line', () => {
    expect(info.segments[0]).toEqual({
      key: 0,
      shmid: 0,
      mode: 0o1600,
      size: 2359296,
      cpid: 2731,
      lpid: 12282,
      nattch: 2,
      uid: 1000,
      gid: 1000,
      cuid: 1000,
      cgid: 1000,
      atime: 1786700469,
      dtime: 1786700431,
      ctime: 1786700428,
      rss: 2359296,
      swap: 0,
    });
  });

  it('leaves the header out of the segments', () => {
    expect(info.segments).toHaveLength(5);
    expect(hasMemoryColumns(info)).toBe(true);
  });

  /**
   * The trap in this file: `perms` is octal, and the bits above the permissions
   * are `SHM_*` flags rather than anything a mode usually carries.
   */
  it('reads perms as octal, and the flags above the permission bits', () => {
    const segment = info.segments[0]!;

    expect(segment.mode).toBe(0o1600);
    expect(permissionsOf(segment)).toBe(0o600);
    expect(formatPermissions(segment)).toBe('rw-------');
    expect(flagsOf(segment).map((flag) => flag.name)).toEqual(['dest']);
    expect(isMarkedForDestruction(segment)).toBe(true);
    expect(isLocked(segment)).toBe(false);
  });

  it('reads a mode with no flags in it as the permissions alone', () => {
    const world = info.segments.find((segment) => segment.key === 5432)!;

    expect(world.mode).toBe(0o666);
    expect(formatPermissions(world)).toBe('rw-rw-rw-');
    expect(flagsOf(world)).toEqual([]);
  });

  /** Key 0 is `IPC_PRIVATE` — no name, so nothing can look the segment up. */
  it('tells a private segment from a keyed one', () => {
    expect(isPrivate(info.segments[0]!)).toBe(true);
    expect(isPrivate(info.segments.find((segment) => segment.key === 5432)!)).toBe(false);
  });

  /**
   * The one worth acting on: nothing attached, and no `dest` to remove it when
   * anything detaches. 64 MiB held for nobody until a reboot or `ipcrm`.
   */
  it('finds the segment nothing is attached to and nothing will remove', () => {
    const summary = summarize(info);

    expect(summary.orphaned.map((segment) => segment.shmid)).toEqual([2, 98307]);
    expect(summary.orphanedBytes).toBe(67108864);
    expect(isOrphaned(info.segments[0]!)).toBe(false);
  });

  /**
   * A segment already marked for destruction is not one of those: it goes on
   * the last detach, so it is counted apart.
   */
  it('counts the segments waiting on their last detach separately', () => {
    expect(summarize(info).destroying.map((segment) => segment.shmid)).toEqual([0, 32769]);
  });

  it('tells never attached from attached and let go', () => {
    const never = info.segments.find((segment) => segment.key === 5432)!;
    const crashed = info.segments.find((segment) => segment.shmid === 98307)!;

    expect(wasNeverAttached(never)).toBe(true);
    expect(isUntouched(never)).toBe(true);
    // Nothing is attached to this one either, but it holds every page it ever
    // touched — which is the difference the page is about.
    expect(wasNeverAttached(crashed)).toBe(false);
    expect(isUntouched(crashed)).toBe(false);
    expect(allocatedOf(crashed)).toBe(67108864);
  });

  /** `shmctl(IPC_SET)` moves the owner and leaves the creator alone. */
  it('sees ownership that has been handed on', () => {
    const given = info.segments.find((segment) => segment.shmid === 131076)!;

    expect(ownerChanged(given)).toBe(true);
    expect([given.uid, given.gid, given.cuid, given.cgid]).toEqual([1000, 44, 0, 0]);
    expect(ownerChanged(info.segments[0]!)).toBe(false);
  });

  /** Size is what was asked for; rss is what has been touched. */
  it('keeps size and resident apart', () => {
    const partly = info.segments.find((segment) => segment.shmid === 131076)!;

    expect(partly.size).toBe(8388608);
    expect(partly.rss).toBe(5242880);
  });

  it('sums what was asked for and what is real', () => {
    const summary = summarize(info);

    expect(summary.segments).toBe(5);
    expect(summary.size).toBe(2359296 + 4194304 + 1048576 + 67108864 + 8388608);
    expect(summary.resident).toBe(2359296 + 4194304 + 0 + 67108864 + 5242880);
    expect(summary.swapped).toBe(0);
    // Attachments, not processes: 2 + 2 + 0 + 0 + 3.
    expect(summary.attachments).toBe(7);
  });

  /**
   * The id is a sequence number above a slot, which is why two segments made
   * back to back are 32,768 apart rather than 1.
   */
  it('reads the id as the slot and the sequence packed into it', () => {
    const reused = info.segments.find((segment) => segment.shmid === 98307)!;

    expect(slotOf(info.segments[0]!)).toBe(0);
    expect(sequenceOf(info.segments[0]!)).toBe(0);
    expect(slotOf(info.segments[1]!)).toBe(1);
    expect(sequenceOf(info.segments[1]!)).toBe(1);
    // Slot 3, used three times before this segment got it.
    expect(slotOf(reused)).toBe(3);
    expect(sequenceOf(reused)).toBe(3);
  });
});

describe('parseShm — a database host', () => {
  const info = parseShm(fixture('database-server'));

  /**
   * `key_t` is an `int` and the kernel prints it with `%10d`, so a key with its
   * top bit set — which is how a hex constant or an `ftok` result often reads —
   * comes out negative.
   */
  it('reads a signed key back as the bit pattern it is', () => {
    const oracle = info.segments.find((segment) => segment.shmid === 32769)!;

    expect(oracle.key).toBe(-1910767615);
    expect(keyHex(oracle)).toBe('0x8e1c0001');
    // And a key that fits in a positive int is the same either way.
    expect(keyHex(info.segments[0]!)).toBe('0x0052e2c1');
  });

  it('reads the huge-page and locked flags out of perms', () => {
    const huge = info.segments.find((segment) => segment.shmid === 32769)!;
    const locked = info.segments.find((segment) => segment.shmid === 65538)!;

    expect(isHugePages(huge)).toBe(true);
    expect(permissionsOf(huge)).toBe(0o640);
    expect(flagsOf(huge).map((flag) => flag.name)).toEqual(['hugetlb']);
    expect(isLocked(locked)).toBe(true);
    expect(flagsOf(locked).map((flag) => flag.name)).toEqual(['locked']);
    expect(summarize(info).hugePages).toBe(1);
    expect(summarize(info).locked).toBe(1);
  });

  /** 56 bytes still cost a page, so rss is larger than size rather than wrong. */
  it('reads an rss above the size asked for', () => {
    const guard = info.segments[0]!;

    expect(guard.size).toBe(56);
    expect(guard.rss).toBe(4096);
  });

  /** And the other way: 8 GiB asked for, 2 GiB touched. */
  it('reads an rss far below the size asked for', () => {
    const sparse = info.segments.find((segment) => segment.shmid === 131076)!;

    expect(sparse.size).toBe(8589934592);
    expect(sparse.rss).toBe(2147483648);
    expect(isUntouched(sparse)).toBe(false);
  });

  /** A 32 GiB segment is past 2^31, so it has to survive as a number. */
  it('keeps a size larger than a 32-bit count', () => {
    expect(info.segments.find((segment) => segment.shmid === 32769)!.size).toBe(34359738368);
  });
});

describe('parseShm — memory pressure', () => {
  const info = parseShm(fixture('swapped-out'));

  it('reads what went to swap', () => {
    const pressed = info.segments.find((segment) => segment.shmid === 65538)!;

    expect(pressed.rss).toBe(134217728);
    expect(pressed.swap).toBe(402653184);
    // Resident plus swapped is the whole segment: every page exists somewhere.
    expect(allocatedOf(pressed)).toBe(pressed.size);
  });

  it('reads a segment that is attached and still has no pages', () => {
    const reserved = info.segments.find((segment) => segment.key === 987654)!;

    expect(reserved.nattch).toBe(1);
    expect(isUntouched(reserved)).toBe(true);
    expect(wasNeverAttached(reserved)).toBe(false);
  });

  /** Detached, nothing resident, and swap held anyway — which nothing frees. */
  it('counts a detached segment that costs swap alone', () => {
    const summary = summarize(info);
    const swapped = info.segments.find((segment) => segment.shmid === 32769)!;

    expect(isOrphaned(swapped)).toBe(true);
    expect(swapped.rss).toBe(0);
    expect(summary.orphanedBytes).toBe(67108864);
    expect(summary.swapped).toBe(402653184 + 67108864 + 16777216);
  });
});

describe('parseShm — an IPC namespace of its own', () => {
  const info = parseShm(fixture('ipc-namespace'));

  /**
   * The pids are printed through `pid_nr_ns`, so a creator outside the reader's
   * pid namespace has 0 where its pid goes — which is not pid 0.
   */
  it('reads a pid of 0 as a process this namespace cannot see', () => {
    const outside = info.segments[0]!;
    const inside = info.segments.find((segment) => segment.cpid === 41)!;

    expect(outside.cpid).toBe(0);
    expect(isPidVisible(outside.cpid)).toBe(false);
    expect(isPidVisible(inside.cpid)).toBe(true);
  });

  /** Created outside and attached in here: one pid printed, one not. */
  it('reads the two pids independently', () => {
    const attached = info.segments.find((segment) => segment.shmid === 2)!;

    expect(isPidVisible(attached.cpid)).toBe(false);
    expect(isPidVisible(attached.lpid)).toBe(true);
  });

  /** An owner with no mapping in this user namespace reads as the overflow id. */
  it('sees the overflow id an unmapped owner reads as', () => {
    const unmapped = info.segments.find((segment) => segment.shmid === 98307)!;

    expect(unmapped.uid).toBe(65534);
    expect(isOverflowId(unmapped.uid)).toBe(true);
    expect(isOverflowId(info.segments[0]!.uid)).toBe(false);
    // Owner and creator agree, so nothing was handed on — both are unmapped.
    expect(ownerChanged(unmapped)).toBe(false);
  });
});

describe('parseShm — a kernel from before 3.2', () => {
  const info = parseShm(fixture('legacy-32bit'));

  /**
   * Fourteen columns rather than sixteen: `rss` and `swap` arrived in 3.2, so
   * they are null here — nothing was said, which is not nothing resident.
   */
  it('reads the fourteen-column form without inventing the other two', () => {
    expect(info.segments).toHaveLength(4);
    expect(hasMemoryColumns(info)).toBe(false);
    expect(info.segments[0]!.rss).toBeNull();
    expect(info.segments[0]!.swap).toBeNull();
    expect(isUntouched(info.segments[0]!)).toBeNull();
    expect(allocatedOf(info.segments[0]!)).toBeNull();
  });

  it('reads every other field as it does on a modern kernel', () => {
    expect(info.segments[0]).toEqual({
      key: 0,
      shmid: 0,
      mode: 0o1600,
      size: 393216,
      cpid: 1731,
      lpid: 1902,
      nattch: 2,
      uid: 1000,
      gid: 1000,
      cuid: 1000,
      cgid: 1000,
      atime: 1307542927,
      dtime: 1307542911,
      ctime: 1307542909,
      rss: null,
      swap: null,
    });
  });

  /** The totals it can give, and null for the two it cannot. */
  it('leaves the memory totals unanswered rather than zero', () => {
    const summary = summarize(info);

    expect(summary.size).toBe(393216 + 1048576 + 4096 + 2097152);
    expect(summary.resident).toBeNull();
    expect(summary.swapped).toBeNull();
    expect(summary.orphanedBytes).toBeNull();
    expect(summary.orphaned).toHaveLength(1);
  });
});

describe('parseShm — a machine with no shared memory', () => {
  const info = parseShm(fixture('no-segments'));

  /** The header alone, which is what most machines say. */
  it('reads the header and no segments', () => {
    expect(info.segments).toEqual([]);
    // The header is still what says this kernel would have printed them.
    expect(hasMemoryColumns(info)).toBe(true);
  });

  it('summarizes nothing as nothing rather than as unknown', () => {
    const summary = summarize(info);

    expect(summary.segments).toBe(0);
    expect(summary.size).toBe(0);
    expect(summary.resident).toBe(0);
    expect(summary.attachments).toBe(0);
    expect(summary.orphaned).toEqual([]);
  });
});

describe('parseShm — shapes the fixtures do not have', () => {
  it('reads a 32-bit kernel that does print rss and swap', () => {
    // The columns are ten wide there rather than twenty-one, header included,
    // which is why nothing here reads by position.
    const text = [
      '       key      shmid perms       size  cpid  lpid nattch   uid   gid  cuid  cgid      atime      dtime      ctime        rss       swap',
      '         0          0  1600     393216  1731  1902      2  1000  1000  1000  1000 1307542927 1307542911 1307542909     393216          0',
      '',
    ].join('\n');

    const info = parseShm(text);

    expect(hasMemoryColumns(info)).toBe(true);
    expect(info.segments[0]!.size).toBe(393216);
    expect(info.segments[0]!.rss).toBe(393216);
    expect(info.segments[0]!.swap).toBe(0);
  });

  it('reads an empty file as no segments rather than as a failure', () => {
    expect(parseShm('')).toEqual({ segments: [], memory: false });
    expect(parseShm('\n\n')).toEqual({ segments: [], memory: false });
  });

  it('skips a line that is not a segment', () => {
    const text = [
      '       key      shmid perms       size  cpid  lpid nattch   uid   gid  cuid  cgid      atime      dtime      ctime',
      'this is not a segment',
      '         0          0  1600     393216  1731  1902      2  1000  1000  1000  1000 1307542927 1307542911 1307542909',
      '         0          0  1600     393216',
      '',
    ].join('\n');

    expect(parseShm(text).segments).toHaveLength(1);
  });

  /**
   * The kernel prints the ids of the *reader's* namespace, so this file changes
   * with who reads it — but the header never does, and one with no rss column
   * settles the shape even on a machine with nothing to list.
   */
  it('takes the shape from the header when there are no rows', () => {
    const text =
      '       key      shmid perms       size  cpid  lpid nattch   uid   gid  cuid  cgid      atime      dtime      ctime\n';

    expect(hasMemoryColumns(parseShm(text))).toBe(false);
  });
});

describe('formatting', () => {
  it('writes a size in the binary units it is quoted in', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(56)).toBe('56 B');
    expect(formatBytes(4096)).toBe('4.0 KiB');
    expect(formatBytes(2359296)).toBe('2.3 MiB');
    expect(formatBytes(34359738368)).toBe('32 GiB');
  });

  it('writes the permission bits the way ipcs does', () => {
    const segment = (mode: number) => ({ mode }) as never;

    expect(formatPermissions(segment(0o1600))).toBe('rw-------');
    expect(formatPermissions(segment(0o666))).toBe('rw-rw-rw-');
    expect(formatPermissions(segment(0o4640))).toBe('rw-r-----');
    expect(formatPermissions(segment(0o777))).toBe('rwxrwxrwx');
  });

  /** A time of 0 is never rather than 1970, which is the whole point of it. */
  it('writes a timestamp as the moment it is, and never as never', () => {
    expect(formatTime(1786700469)).toBe('2026-08-14 09:41:09 UTC');
    expect(formatTime(0)).toBeNull();
  });
});
