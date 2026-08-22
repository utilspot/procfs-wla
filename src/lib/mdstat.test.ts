import { describe, expect, it } from 'vitest';
import { readMdstatFixture as fixture } from '../test/fixtures';
import {
  bytesOf,
  describeAction,
  describeFlag,
  failedMembers,
  formatBytes,
  formatFinish,
  isActive,
  isDegraded,
  isRebuilding,
  missingMembers,
  parseMdstat,
  spareMembers,
  summarize,
} from './mdstat';

describe('parseMdstat — two healthy mirrors', () => {
  const info = parseMdstat(fixture('raid1-healthy'));

  it('reads the levels this kernel can drive', () => {
    expect(info.personalities).toEqual([
      'linear',
      'multipath',
      'raid0',
      'raid1',
      'raid6',
      'raid5',
      'raid4',
      'raid10',
    ]);
  });

  // A record here is a header and the lines indented under it.
  it('gathers each array from its several lines', () => {
    expect(info.arrays.map((array) => array.name)).toEqual(['md0', 'md1']);
    expect(info.arrays[1]).toMatchObject({
      state: ['active'],
      level: 'raid1',
      blocks: 976630464,
      metadata: '1.2',
      expected: 2,
      working: 2,
      status: 'UU',
    });
  });

  it('reads each member with its position in the array', () => {
    expect(info.arrays[0]?.members).toEqual([
      { device: 'sdb1', role: 1, flags: [] },
      { device: 'sda1', role: 0, flags: [] },
    ]);
  });

  it('reads the write-intent bitmap where there is one', () => {
    expect(info.arrays[1]?.bitmap).toEqual({
      pagesUsed: 1,
      pagesTotal: 8,
      sizeKB: 4,
      chunkKB: 65536,
    });
    expect(info.arrays[0]?.bitmap).toBeNull();
  });

  it('finds nothing degraded and nothing rebuilding', () => {
    const summary = summarize(info);

    expect(summary).toMatchObject({ arrays: 2, active: 2 });
    expect(summary.degraded).toEqual([]);
    expect(summary.rebuilding).toEqual([]);
    expect(formatBytes(summary.totalBytes)).toBe('932 GiB');
  });

  it('reads the unused devices line as nothing unused', () => {
    expect(info.unused).toEqual([]);
  });
});

describe('parseMdstat — a RAID 5 short of a member', () => {
  const info = parseMdstat(fixture('raid5-degraded'));
  const array = info.arrays[0]!;

  /**
   * `[4/3]` and `[UUU_]` are the health of the array: one position has no
   * working member behind it.
   */
  it('reads the array as degraded from both fields', () => {
    expect(array).toMatchObject({ expected: 4, working: 3, status: 'UUU_' });
    expect(isDegraded(array)).toBe(true);
    expect(missingMembers(array)).toBe(1);
    expect(summarize(info).degraded).toEqual([array]);
  });

  // A failed member stays listed, marked, until something removes it.
  it('reads the failed member and keeps it in the list', () => {
    expect(failedMembers(array).map((member) => member.device)).toEqual(['sdd1']);
    expect(array.members).toHaveLength(4);
    expect(describeFlag('F')).toMatch(/faulty/);
  });

  it('reads the geometry left on the blocks line', () => {
    expect(array.geometry).toBe('level 5, 512k chunk, algorithm 2');
    expect(bytesOf(array)).toBe(11720658432 * 1024);
  });
});

describe('parseMdstat — rebuilding onto a replacement', () => {
  const info = parseMdstat(fixture('recovering'));
  const array = info.arrays[0]!;

  it('reads the progress line', () => {
    expect(array.progress).toEqual({
      action: 'recovery',
      percent: 12.7,
      done: 248064000,
      total: 1953260544,
      finishMinutes: 141.2,
      speedKBs: 201234,
      queued: null,
    });
    expect(isRebuilding(array)).toBe(true);
  });

  /**
   * Recovery is rebuilding a member the array is missing, which is not the
   * same as a resync making existing members agree.
   */
  it('knows what the word on the progress line means', () => {
    expect(describeAction('recovery')).toMatch(/Rebuilding/);
    expect(describeAction('resync')).toMatch(/agree again/);
    expect(describeAction('check')).toMatch(/without changing/);
    expect(describeAction('scribble')).toBeNull();
  });

  it('is degraded until the rebuild finishes', () => {
    expect(isDegraded(array)).toBe(true);
    expect(array.status).toBe('UUUU_');
    expect(summarize(info).rebuilding).toEqual([array]);
  });

  it('formats the kernel’s estimate', () => {
    expect(formatFinish(141.2)).toBe('2.4 hours');
    expect(formatFinish(0.4)).toBe('24 sec');
    expect(formatFinish(8.5)).toBe('8.5 min');
    expect(formatFinish(42)).toBe('42 min');
  });
});

describe('parseMdstat — a scrub, and work queued behind it', () => {
  const info = parseMdstat(fixture('checking'));

  // A check reads and compares without changing any data.
  it('reads a check as a rebuild that changes nothing', () => {
    expect(info.arrays[0]?.progress).toMatchObject({ action: 'check', percent: 21.4 });
    expect(isRebuilding(info.arrays[0]!)).toBe(true);
    expect(isDegraded(info.arrays[0]!)).toBe(false);
  });

  /**
   * The kernel runs one of these at a time, so another array's work is queued
   * — printed with no bar and no percentage at all.
   */
  it('reads work that is queued rather than running', () => {
    expect(info.arrays[1]?.progress).toEqual({
      action: 'resync',
      percent: null,
      done: null,
      total: null,
      finishMinutes: null,
      speedKBs: null,
      queued: 'DELAYED',
    });
    expect(isRebuilding(info.arrays[1]!)).toBe(false);
    expect(summarize(info).queued.map((array) => array.name)).toEqual(['md1']);
  });

  it('reads a six-member array as whole', () => {
    expect(info.arrays[1]).toMatchObject({ expected: 6, working: 6, status: 'UUUUUU' });
    expect(isDegraded(info.arrays[1]!)).toBe(false);
  });
});

describe('parseMdstat — read-only, inactive and a spare', () => {
  const info = parseMdstat(fixture('inactive-and-spare'));

  // The state words come before the level on the header line.
  it('reads a parenthesised state beside the level', () => {
    expect(info.arrays[0]).toMatchObject({
      state: ['active', '(auto-read-only)'],
      level: 'raid1',
    });
    expect(isActive(info.arrays[0]!)).toBe(true);
  });

  it('reads a member marked write-mostly', () => {
    expect(info.arrays[0]?.members[1]).toEqual({ device: 'sda1', role: 0, flags: ['W'] });
    expect(describeFlag('W')).toMatch(/read from only/);
  });

  it('reads a resync the kernel has not started', () => {
    expect(info.arrays[0]?.progress).toMatchObject({ action: 'resync', queued: 'PENDING' });
  });

  /**
   * An inactive array has no level to run and no member counts, so nothing can
   * be said about whether it is degraded.
   */
  it('claims nothing about an inactive array', () => {
    const inactive = info.arrays[1]!;

    expect(inactive).toMatchObject({ state: ['inactive'], level: null, expected: null });
    expect(isActive(inactive)).toBe(false);
    expect(isDegraded(inactive)).toBeNull();
    expect(missingMembers(inactive)).toBeNull();
    expect(spareMembers(inactive).map((member) => member.device)).toEqual(['sdc1']);
  });

  it('counts only the running array as active', () => {
    expect(summarize(info)).toMatchObject({ arrays: 2, active: 1 });
    expect(summarize(info).degraded).toEqual([]);
  });
});

describe('parseMdstat — nothing assembled', () => {
  const info = parseMdstat(fixture('no-arrays'));

  it('reads a file with a personalities line and nothing else', () => {
    expect(info.arrays).toEqual([]);
    expect(info.personalities).toEqual([]);
    expect(info.unused).toEqual([]);
    expect(summarize(info)).toMatchObject({ arrays: 0, active: 0, totalBytes: 0 });
  });
});

describe('parseMdstat — every fixture', () => {
  const names = [
    'raid1-healthy',
    'raid5-degraded',
    'recovering',
    'checking',
    'inactive-and-spare',
    'no-arrays',
  ];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseMdstat(fixture(name));
    const summary = summarize(info);

    for (const array of info.arrays) {
      expect(array.name).toMatch(/^md/);
      expect(array.state.length).toBeGreaterThan(0);

      for (const member of array.members) {
        expect(member.device).not.toBe('');
        expect(Number.isInteger(member.role)).toBe(true);
        // A flag is a single letter, and each is printed in its own brackets.
        for (const flag of member.flags) expect(flag).toHaveLength(1);
      }

      // The status field has one character per member the array expects.
      if (array.status !== null && array.expected !== null) {
        expect(array.status).toHaveLength(array.expected);
        expect([...array.status].filter((c) => c === 'U')).toHaveLength(array.working!);
      }

      // An array with a level running is one with members.
      if (array.level !== null) expect(array.members.length).toBeGreaterThan(0);

      // Queued work has no figures; running work has all of them.
      if (array.progress?.queued != null) {
        expect(array.progress.percent).toBeNull();
        expect(array.progress.speedKBs).toBeNull();
      } else if (array.progress !== null) {
        expect(array.progress.percent).toBeGreaterThan(0);
        expect(array.progress.done).toBeLessThanOrEqual(array.progress.total!);
      }
    }

    expect(summary.degraded.every((array) => isDegraded(array) === true)).toBe(true);
    expect(summary.active).toBeLessThanOrEqual(summary.arrays);
  });
});

describe('parseMdstat — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseMdstat('')).toEqual({ personalities: [], arrays: [], unused: [] });
  });

  it('returns nothing for a file that is not /proc/mdstat', () => {
    expect(parseMdstat('processor\t: 0\n').arrays).toEqual([]);
  });

  it('reads devices md knows of but has not assembled', () => {
    const info = parseMdstat('Personalities : [raid1] \nunused devices: sdd1 sde1\n');

    expect(info.unused).toEqual(['sdd1', 'sde1']);
  });

  it('reads several flags on one member', () => {
    const info = parseMdstat('md0 : active raid1 sdb1[1](W)(F) sda1[0]\n');

    expect(info.arrays[0]?.members[0]?.flags).toEqual(['W', 'F']);
    expect(failedMembers(info.arrays[0]!)).toHaveLength(1);
  });

  // A blocks line without the pair says nothing about the array's health.
  it('claims nothing when the blocks line has no counts', () => {
    const info = parseMdstat('md0 : active raid1 sdb1[1]\n      512 blocks super 1.2\n');

    expect(info.arrays[0]).toMatchObject({ blocks: 512, expected: null, status: null });
    expect(isDegraded(info.arrays[0]!)).toBeNull();
  });

  /**
   * The status field is the surer of the two: an array can print a full pair
   * and still show a hole while a member is being replaced.
   */
  it('reads a hole in the status field as degraded whatever the counts say', () => {
    const info = parseMdstat(
      'md0 : active raid1 sdb1[1] sda1[0]\n      512 blocks super 1.2 [2/2] [U_]\n',
    );

    expect(isDegraded(info.arrays[0]!)).toBe(true);
  });

  it('reads a linear array, which has neither counts nor status', () => {
    const info = parseMdstat(
      'md0 : active linear sdb1[1] sda1[0]\n      1953514496 blocks super 1.2 0k rounding\n',
    );

    expect(info.arrays[0]).toMatchObject({ level: 'linear', geometry: '0k rounding' });
    expect(isDegraded(info.arrays[0]!)).toBeNull();
  });

  it('ignores an indented line before any array', () => {
    expect(parseMdstat('      512 blocks super 1.2 [2/2] [UU]\n').arrays).toEqual([]);
  });

  it('formats sizes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(976630464 * 1024)).toBe('931 GiB');
  });
});
