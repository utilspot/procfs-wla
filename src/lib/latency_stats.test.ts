import { describe, expect, it } from 'vitest';
import { readLatencyStatsFixture as fixture } from '../test/fixtures';
import {
  averageUs,
  BACKTRACE_DEPTH,
  byTotal,
  formatMicros,
  maybeTruncated,
  parseLatencyStats,
  siteOf,
  summarize,
} from './latency_stats';

describe('parseLatencyStats — an idle desktop', () => {
  const info = parseLatencyStats(fixture('idle-desktop'));

  it('reads the version out of the header', () => {
    expect(info.version).toBe('v0.1');
    expect(summarize(info).version).toBe('v0.1');
  });

  it('reads a record as a count, a total, a maximum and a path', () => {
    expect(info.records[0]).toEqual({
      count: 2314,
      totalUs: 985230,
      maxUs: 1520,
      backtrace: [
        'poll_schedule_timeout',
        'do_sys_poll',
        '__x64_sys_poll',
        'do_syscall_64',
        'entry_SYSCALL_64_after_hwframe',
      ],
    });
  });

  // The innermost frame is where the sleep happened; the rest got it there.
  it('takes the first frame as where it waited', () => {
    expect(siteOf(info.records[0]!)).toBe('poll_schedule_timeout');
    expect(siteOf(info.records[2]!)).toBe('io_schedule');
  });

  /**
   * The file gives a total and a maximum but no average, and the average is
   * what separates a steady wait from an occasional stall.
   */
  it('works out the average the file leaves out', () => {
    const record = info.records[0]!;

    expect(averageUs(record)).toBeCloseTo(985230 / 2314);
    // Averaging 426 µs, but one wait took 1520.
    expect(averageUs(record)! < record.maxUs).toBe(true);
  });

  it('adds up the waits and the time across the records', () => {
    const summary = summarize(info);

    expect(summary.records).toBe(5);
    expect(summary.events).toBe(2314 + 1187 + 642 + 88 + 14);
    expect(summary.totalUs).toBe(985230 + 402118 + 158204 + 42310 + 9820);
  });

  /**
   * The costliest record and the one holding the longest single wait need not
   * be the same, and are not here.
   */
  it('picks out the worst by total and by single wait separately', () => {
    const summary = summarize(info);

    expect(siteOf(summary.worstTotal!)).toBe('poll_schedule_timeout');
    expect(siteOf(summary.worstMax!)).toBe('io_schedule');
    expect(summary.worstMax).not.toBe(summary.worstTotal);
  });
});

describe('parseLatencyStats — a disk-bound machine', () => {
  const info = parseLatencyStats(fixture('io-bound'));

  it('reads the journal and writeback waits', () => {
    expect(info.records.map((record) => siteOf(record))).toEqual([
      'io_schedule',
      'jbd2_log_wait_commit',
      'io_schedule',
      'wait_for_completion_io',
      'rq_qos_wait',
    ]);
  });

  // The file's order is its internal table's; the useful order is by cost.
  it('ranks the records by total time waited', () => {
    const ranked = byTotal(info);

    expect(ranked[0]?.totalUs).toBe(28442630);
    expect(ranked.map((record) => record.totalUs)).toEqual(
      [...ranked.map((record) => record.totalUs)].sort((a, b) => b - a),
    );
    // Ranking does not disturb the parsed file.
    expect(info.records[0]?.totalUs).toBe(28442630);
  });

  it('measures in microseconds, however long the wait', () => {
    const summary = summarize(info);

    expect(formatMicros(summary.worstMax!.maxUs)).toBe('96 ms');
    expect(formatMicros(summary.totalUs)).toBe('63 s');
  });
});

describe('parseLatencyStats — nothing recorded', () => {
  const info = parseLatencyStats(fixture('disabled'));

  /**
   * The header is printed whether or not anything was recorded, so a file with
   * only a header is not an empty file — and cannot say whether collection is
   * off or whether nothing has waited since a reset.
   */
  it('reads the header with no records under it', () => {
    expect(info.version).toBe('v0.1');
    expect(info.records).toEqual([]);
    expect(summarize(info)).toMatchObject({ records: 0, events: 0, totalUs: 0 });
    expect(summarize(info).worstTotal).toBeNull();
    expect(summarize(info).worstMax).toBeNull();
  });
});

describe('parseLatencyStats — a path at the frame limit', () => {
  const info = parseLatencyStats(fixture('deep-backtrace'));

  /**
   * The kernel keeps twelve frames per record, so a path of exactly twelve may
   * be whole or may be cut off, and nothing here can tell which.
   */
  it('marks a path that may go further than it says', () => {
    const deep = info.records[0]!;

    expect(deep.backtrace).toHaveLength(BACKTRACE_DEPTH);
    expect(maybeTruncated(deep)).toBe(true);
    expect(maybeTruncated(info.records[1]!)).toBe(false);
  });

  it('reads a record whose path is a single frame', () => {
    const shallow = info.records[2]!;

    expect(shallow.backtrace).toEqual(['schedule']);
    expect(siteOf(shallow)).toBe('schedule');
    expect(maybeTruncated(shallow)).toBe(false);
  });
});

describe('parseLatencyStats — a network server', () => {
  const info = parseLatencyStats(fixture('network-server'));

  it('reads every record in the file', () => {
    expect(summarize(info).records).toBe(6);
    expect(siteOf(byTotal(info)[0]!)).toBe('sk_wait_data');
  });

  it('averages a very frequent, very short wait', () => {
    const socket = info.records[0]!;

    // 18422 waits totalling 6.2 s: a third of a millisecond each.
    expect(averageUs(socket)).toBeCloseTo(6204800 / 18422);
    expect(formatMicros(averageUs(socket)!)).toBe('337 µs');
  });
});

describe('parseLatencyStats — every fixture', () => {
  const names = ['idle-desktop', 'io-bound', 'disabled', 'deep-backtrace', 'network-server'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseLatencyStats(fixture(name));
    const summary = summarize(info);

    expect(info.version).toBe('v0.1');

    for (const record of info.records) {
      expect(record.count).toBeGreaterThan(0);
      expect(record.backtrace.length).toBeGreaterThan(0);
      expect(record.backtrace.length).toBeLessThanOrEqual(BACKTRACE_DEPTH);
      expect(record.backtrace.every((frame) => frame !== '')).toBe(true);

      // One wait cannot be longer than every wait folded together.
      expect(record.maxUs).toBeLessThanOrEqual(record.totalUs);
      // The average sits between nothing and the longest single wait.
      expect(averageUs(record)!).toBeGreaterThan(0);
      expect(averageUs(record)!).toBeLessThanOrEqual(record.maxUs);
    }

    expect(summary.totalUs).toBe(
      info.records.reduce((total, record) => total + record.totalUs, 0),
    );
    // Ranking keeps every record.
    expect(byTotal(info)).toHaveLength(summary.records);

    if (summary.records > 0) {
      expect(summary.worstTotal!.totalUs).toBe(Math.max(...info.records.map((r) => r.totalUs)));
      expect(summary.worstMax!.maxUs).toBe(Math.max(...info.records.map((r) => r.maxUs)));
    }
  });
});

describe('parseLatencyStats — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseLatencyStats('')).toEqual({ version: null, records: [] });
  });

  it('returns nothing for a file that is not /proc/latency_stats', () => {
    expect(parseLatencyStats('processor\t: 0\n').records).toEqual([]);
  });

  // The records are what matters; a file without the header still parses.
  it('reads records with no header at all', () => {
    const info = parseLatencyStats('12 4800 900 io_schedule vfs_read\n');

    expect(info.version).toBeNull();
    expect(info.records).toHaveLength(1);
  });

  it('reads a version the header gives in another form', () => {
    expect(parseLatencyStats('Latency Top version : v0.2\n').version).toBe('v0.2');
    expect(parseLatencyStats('Latency Top version: v0.1\n').version).toBe('v0.1');
  });

  it('skips a record with no call path', () => {
    expect(parseLatencyStats('12 4800 900\n').records).toEqual([]);
    expect(parseLatencyStats('12 4800 900   \n').records).toEqual([]);
  });

  it('skips a line with a number missing', () => {
    expect(parseLatencyStats('12 4800 io_schedule\n').records).toEqual([]);
  });

  // A record folding in no waits cannot have an average worked out for it.
  it('claims no average for a record counting nothing', () => {
    const info = parseLatencyStats('0 0 0 io_schedule\n');

    expect(info.records[0]?.count).toBe(0);
    expect(averageUs(info.records[0]!)).toBeNull();
  });

  it('formats microseconds, milliseconds and seconds', () => {
    expect(formatMicros(0)).toBe('0 µs');
    expect(formatMicros(940)).toBe('940 µs');
    expect(formatMicros(1520)).toBe('1.5 ms');
    expect(formatMicros(96400)).toBe('96 ms');
    expect(formatMicros(2_400_000)).toBe('2.4 s');
    expect(formatMicros(63_000_000)).toBe('63 s');
  });
});
