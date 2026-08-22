/**
 * Parser for `/proc/latency_stats`.
 *
 * The latencies the kernel has recorded, one record per line under a version
 * header:
 *
 *    Latency Top version : v0.1
 *    2314 985230 1520 poll_schedule_timeout do_sys_poll __x64_sys_poll
 *
 * A record is a count, a **total** and a **maximum**, then the call path that
 * waited — up to {@link BACKTRACE_DEPTH} frames, innermost first, so the first
 * symbol is where the sleep actually happened.
 *
 * Both times are in **microseconds**, and the total is the sum over every one
 * of those `count` waits. The average worth quoting is therefore
 * `total / count`, which the file leaves to the reader — see
 * {@link averageUs}. A record with a small average and a large maximum is a
 * different problem from one with both large, and the file cannot say which
 * without that division.
 *
 * The records come in the order of the kernel's own table, which is neither
 * sorted nor stable, so nothing is read into their order here.
 *
 * The header is printed whether or not anything was recorded, so a file
 * holding nothing else means either that `kernel.latencytop` is off or that
 * nothing has waited since the last reset — and writing to the file is what
 * resets it. The two cannot be told apart from here.
 */

/** Frames the kernel keeps per record, and prints at most. */
export const BACKTRACE_DEPTH = 12;

/** `Latency Top version : v0.1` */
const VERSION = /^Latency Top version\s*:\s*(\S+)\s*$/;

/** `2314 985230 1520 poll_schedule_timeout do_sys_poll` */
const RECORD = /^(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/;

export interface LatencyRecord {
  /** Waits folded into this record. */
  count: number;
  /** Microseconds spent across all of them. */
  totalUs: number;
  /** The longest single wait, in microseconds. */
  maxUs: number;
  /** The call path, innermost frame first. */
  backtrace: string[];
}

export interface LatencyStatsInfo {
  /** The version the header gave, or null when there was no header. */
  version: string | null;
  records: LatencyRecord[];
}

export function parseLatencyStats(text: string): LatencyStatsInfo {
  const records: LatencyRecord[] = [];
  let version: string | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const header = VERSION.exec(trimmed);
    if (header !== null) {
      version = header[1] ?? null;
      continue;
    }

    const match = RECORD.exec(trimmed);
    if (match === null) continue;

    const backtrace = (match[4] ?? '').split(/\s+/).filter((frame) => frame !== '');
    // A record with no call path at all says nothing about where it waited.
    if (backtrace.length === 0) continue;

    records.push({
      count: Number(match[1]),
      totalUs: Number(match[2]),
      maxUs: Number(match[3]),
      backtrace,
    });
  }

  return { version, records };
}

/**
 * The mean wait, in microseconds. Null when the record folds in no waits at
 * all, which would divide by zero rather than mean anything.
 */
export function averageUs(record: LatencyRecord): number | null {
  return record.count === 0 ? null : record.totalUs / record.count;
}

/** Where the sleep happened: the innermost frame of the path. */
export function siteOf(record: LatencyRecord): string | null {
  return record.backtrace[0] ?? null;
}

/**
 * Whether the call path may go further than it says. The kernel keeps
 * {@link BACKTRACE_DEPTH} frames per record, so a path of exactly that many
 * may be whole or may be cut off, and there is no telling which from here.
 */
export function maybeTruncated(record: LatencyRecord): boolean {
  return record.backtrace.length >= BACKTRACE_DEPTH;
}

/** Microseconds as the unit that reads best for the size of them. */
export function formatMicros(micros: number): string {
  if (micros < 1000) return `${Math.round(micros)} µs`;
  if (micros < 1000 * 1000) return `${(micros / 1000).toFixed(micros < 10_000 ? 1 : 0)} ms`;

  const seconds = micros / 1_000_000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
}

export interface LatencyStatsSummary {
  version: string | null;
  records: number;
  /** Waits recorded, across every record. */
  events: number;
  /** Microseconds waited, across every record. */
  totalUs: number;
  /** The record that has cost the most time in total. */
  worstTotal: LatencyRecord | null;
  /** The record holding the longest single wait. */
  worstMax: LatencyRecord | null;
}

export function summarize(info: LatencyStatsInfo): LatencyStatsSummary {
  const pick = (better: (a: LatencyRecord, b: LatencyRecord) => boolean) =>
    info.records.reduce<LatencyRecord | null>(
      (best, record) => (best === null || better(record, best) ? record : best),
      null,
    );

  return {
    version: info.version,
    records: info.records.length,
    events: info.records.reduce((total, record) => total + record.count, 0),
    totalUs: info.records.reduce((total, record) => total + record.totalUs, 0),
    worstTotal: pick((a, b) => a.totalUs > b.totalUs),
    worstMax: pick((a, b) => a.maxUs > b.maxUs),
  };
}

/** The records by total time waited, worst first — the file's order is not that. */
export function byTotal(info: LatencyStatsInfo): LatencyRecord[] {
  return [...info.records].sort((a, b) => b.totalUs - a.totalUs);
}
