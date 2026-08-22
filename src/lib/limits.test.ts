import { describe, expect, it } from 'vitest';
import { readLimitsFixture as fixture } from '../test/fixtures';
import {
  canLowerNice,
  describeLimit,
  find,
  formatBytes,
  formatCount,
  formatMicros,
  formatSeconds,
  formatValue,
  isEnforced,
  isPerUser,
  isPinned,
  isRaisable,
  isRealtime,
  niceFloor,
  parseLimits,
  summarize,
  unenforcedSince,
} from './limits';

describe('parseLimits — an ordinary desktop', () => {
  const limits = parseLimits(fixture('desktop', 'self'));

  it('reads the sixteen limits a current kernel prints', () => {
    expect(limits).toHaveLength(16);
    expect(limits[0]!.name).toBe('Max cpu time');
    expect(limits.at(-1)!.name).toBe('Max realtime timeout');
  });

  it('leaves the header out of them', () => {
    expect(limits.map((limit) => limit.name)).not.toContain('Limit');
  });

  /** The name holds spaces, so the columns cannot be split on whitespace. */
  it('keeps a name made of several words whole', () => {
    expect(find(limits, 'Max realtime priority')).not.toBeNull();
    expect(find(limits, 'Max core file size')).not.toBeNull();
  });

  it('reads `unlimited` as no limit rather than as a number', () => {
    expect(find(limits, 'Max cpu time')).toMatchObject({ soft: null, hard: null });
    expect(find(limits, 'Max file size')!.soft).toBeNull();
  });

  it('reads the pair and the unit', () => {
    expect(find(limits, 'Max open files')).toEqual({
      name: 'Max open files',
      soft: 1024,
      hard: 1048576,
      unit: 'files',
    });
    expect(find(limits, 'Max stack size')).toEqual({
      name: 'Max stack size',
      soft: 8388608,
      hard: null,
      unit: 'bytes',
    });
  });

  /** Two rows carry no unit at all, and the column is simply absent. */
  it('takes the two rows with no unit column', () => {
    expect(find(limits, 'Max nice priority')).toEqual({
      name: 'Max nice priority',
      soft: 0,
      hard: 0,
      unit: null,
    });
    expect(find(limits, 'Max realtime priority')!.unit).toBeNull();
  });

  it('returns null for a row this kernel did not print', () => {
    expect(find(limits, 'Max io priority')).toBeNull();
  });
});

describe('parseLimits — the shapes a file can take', () => {
  it('reads nothing out of a file that is not this one', () => {
    expect(parseLimits('')).toEqual([]);
    expect(parseLimits('nonsense\nmore nonsense\n')).toEqual([]);
  });

  it('survives CRLF line endings', () => {
    const limits = parseLimits(fixture('desktop', 'self').replace(/\n/g, '\r\n'));

    expect(limits).toHaveLength(16);
    expect(find(limits, 'Max open files')!.hard).toBe(1048576);
  });

  /** RLIMIT_RTTIME arrived in 2.6.25, so an older file is a row short. */
  it('reads an older kernel’s fifteen rows without inventing the sixteenth', () => {
    const limits = parseLimits(fixture('legacy-2.6', 'self'));

    expect(limits).toHaveLength(15);
    expect(find(limits, 'Max realtime timeout')).toBeNull();
    expect(find(limits, 'Max realtime priority')).not.toBeNull();
  });

  it('reads a row whose value column is full', () => {
    const wide = 'Max address space         18446744073709551000  unlimited            bytes';

    expect(parseLimits(wide)[0]).toMatchObject({ soft: 18446744073709551000, hard: null });
  });
});

/**
 * The soft limit is what is enforced; the hard one is the ceiling the process
 * may raise it to with no privilege at all. The gap between them is the whole
 * point of the file.
 */
describe('the gap between soft and hard', () => {
  const desktop = parseLimits(fixture('desktop', 'self'));

  it('is headroom the process can take itself', () => {
    expect(isRaisable(find(desktop, 'Max open files')!)).toBe(true);
    // A finite soft against an unlimited hard is headroom too.
    expect(isRaisable(find(desktop, 'Max stack size')!)).toBe(true);
  });

  it('is not headroom where the two are equal', () => {
    expect(isRaisable(find(desktop, 'Max processes')!)).toBe(false);
    expect(isPinned(find(desktop, 'Max processes')!)).toBe(true);
  });

  /** Unlimited on both sides bounds nothing, so it is neither. */
  it('is neither for a row that limits nothing at all', () => {
    const cpu = find(desktop, 'Max cpu time')!;

    expect(isRaisable(cpu)).toBe(false);
    expect(isPinned(cpu)).toBe(false);
  });

  it('is gone once a process has raised the limit to its ceiling', () => {
    const browser = parseLimits(fixture('desktop', '12282'));

    expect(find(browser, 'Max open files')).toMatchObject({ soft: 1048576, hard: 1048576 });
    expect(isRaisable(find(browser, 'Max open files')!)).toBe(false);
  });
});

describe('the rows that do not mean what they look like', () => {
  const desktop = parseLimits(fixture('desktop', 'self'));

  /** Counted across the real user id machine-wide, not for this process. */
  it('knows which three are per user rather than per process', () => {
    expect(isPerUser('Max processes')).toBe(true);
    expect(isPerUser('Max pending signals')).toBe(true);
    expect(isPerUser('Max msgqueue size')).toBe(true);
    expect(isPerUser('Max open files')).toBe(false);
  });

  it('knows which two no kernel has enforced since 2.4', () => {
    expect(isEnforced('Max resident set')).toBe(false);
    expect(unenforcedSince('Max resident set')).toBe('Linux 2.4.30');
    expect(unenforcedSince('Max file locks')).toBe('Linux 2.4.25');
    expect(isEnforced('Max address space')).toBe(true);
    expect(unenforcedSince('Max address space')).toBeNull();
  });

  /**
   * The kernel refuses any nice value below `20 - rlim_cur`, so the usual 0
   * puts the floor at 20 — above every nice value there is, which is the same
   * as forbidding the process to raise its own priority.
   */
  it('reads the nice floor backwards, which is how the kernel writes it', () => {
    expect(niceFloor(find(desktop, 'Max nice priority')!)).toBe(20);
    expect(canLowerNice(find(desktop, 'Max nice priority')!)).toBe(false);

    const audio = find(parseLimits(fixture('realtime', 'self')), 'Max nice priority')!;
    expect(niceFloor(audio)).toBe(-20);
    expect(canLowerNice(audio)).toBe(true);
  });

  it('reads it for that row alone', () => {
    expect(niceFloor(find(desktop, 'Max realtime priority')!)).toBeNull();
    expect(niceFloor(find(desktop, 'Max open files')!)).toBeNull();
    expect(canLowerNice(find(desktop, 'Max open files')!)).toBe(false);
  });

  it('says which process may schedule itself in real time', () => {
    expect(isRealtime(find(desktop, 'Max realtime priority')!)).toBe(false);
    expect(
      isRealtime(find(parseLimits(fixture('realtime', 'self')), 'Max realtime priority')!),
    ).toBe(true);
  });
});

describe('describeLimit', () => {
  it('explains every row a current kernel prints', () => {
    for (const limit of parseLimits(fixture('desktop', 'self'))) {
      expect(describeLimit(limit.name), limit.name).not.toBeNull();
    }
  });

  it('names the constant setrlimit is called with', () => {
    expect(describeLimit('Max open files')).toMatchObject({
      resource: 'RLIMIT_NOFILE',
      flag: '-n',
    });
    // The one limit no shell's ulimit reaches.
    expect(describeLimit('Max realtime timeout')!.flag).toBeNull();
  });

  it('has nothing to say about a row it does not know', () => {
    expect(describeLimit('Max io priority')).toBeNull();
  });
});

describe('formatting', () => {
  it('gives byte limits in the binary units they are always round in', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(32768)).toBe('32 KiB');
    expect(formatBytes(8388608)).toBe('8 MiB');
    expect(formatBytes(2147483648)).toBe('2 GiB');
    expect(formatBytes(819200)).toBe('800 KiB');
  });

  it('groups counts, which reach the millions', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1024)).toBe('1,024');
    expect(formatCount(1048576)).toBe('1,048,576');
  });

  it('gives RLIMIT_RTTIME in the unit it reads best in', () => {
    expect(formatMicros(500)).toBe('500 µs');
    expect(formatMicros(200000)).toBe('200 ms');
    expect(formatMicros(1500)).toBe('1.5 ms');
    expect(formatMicros(2000000)).toBe('2 s');
  });

  it('gives RLIMIT_CPU in the unit it reads best in', () => {
    expect(formatSeconds(30)).toBe('30 s');
    expect(formatSeconds(600)).toBe('10 min');
    expect(formatSeconds(7200)).toBe('2 h');
  });

  it('formats a value by the unit its own row is counted in', () => {
    const limits = parseLimits(fixture('desktop', 'self'));

    expect(formatValue(find(limits, 'Max stack size')!, 8388608)).toBe('8 MiB');
    expect(formatValue(find(limits, 'Max open files')!, 1048576)).toBe('1,048,576');
    expect(formatValue(find(limits, 'Max nice priority')!, 0)).toBe('0');
    expect(formatValue(find(limits, 'Max cpu time')!, null)).toBe('unlimited');
  });
});

describe('summarize', () => {
  it('counts what a desktop limits, and what it leaves alone', () => {
    const summary = summarize(parseLimits(fixture('desktop', 'self')));

    expect(summary).toMatchObject({ count: 16, unlimited: 7, noCoreDumps: true });
    // Including the core dump: a soft limit of zero against an unlimited hard
    // one is a process that could turn its own dumps back on.
    expect(summary.raisable.map((limit) => limit.name)).toEqual([
      'Max stack size',
      'Max core file size',
      'Max open files',
    ]);
    expect(summary.perUser).toHaveLength(3);
    expect(summary.unenforced.map((limit) => limit.name)).toEqual([
      'Max resident set',
      'Max file locks',
    ]);
  });

  /** Every limit pinned: nothing here can be raised back without privilege. */
  it('finds nothing to raise in a service that was locked down', () => {
    const summary = summarize(parseLimits(fixture('hardened-service', 'self')));

    expect(summary.raisable).toEqual([]);
    expect(summary.pinned.length).toBeGreaterThan(8);
    expect(summary.noCoreDumps).toBe(true);
    // Set to a real figure, and enforced by nothing: 512 MiB that bounds
    // exactly nothing about this process.
    expect(summary.unenforced.map((limit) => limit.soft)).toEqual([536870912, 64]);
  });

  it('does not call a core dump missing where one is allowed', () => {
    expect(summarize(parseLimits(fixture('container', 'self'))).noCoreDumps).toBe(false);
  });

  /**
   * A SCHED_FIFO thread with no RLIMIT_RTTIME behind it can hold its CPU with
   * nothing able to preempt it, which is the one way this file spells danger.
   */
  it('spots real-time priority with no timeout to cut a runaway short', () => {
    expect(summarize(parseLimits(fixture('realtime', '3117'))).realtimeWithoutTimeout).toBe(true);
    expect(summarize(parseLimits(fixture('realtime', 'self'))).realtimeWithoutTimeout).toBe(false);
    expect(summarize(parseLimits(fixture('desktop', 'self'))).realtimeWithoutTimeout).toBe(false);
  });

  it('reads a kernel with no such row as having no timeout either', () => {
    const limits = parseLimits(fixture('legacy-2.6', 'self'));
    const raised = limits.map((limit) =>
      limit.name === 'Max realtime priority' ? { ...limit, soft: 50, hard: 50 } : limit,
    );

    expect(summarize(raised).realtimeWithoutTimeout).toBe(true);
  });

  it('summarizes an empty file without inventing anything', () => {
    expect(summarize([])).toMatchObject({
      count: 0,
      unlimited: 0,
      noCoreDumps: false,
      realtimeWithoutTimeout: false,
    });
  });
});
