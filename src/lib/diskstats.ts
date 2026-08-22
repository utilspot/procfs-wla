/**
 * Parser for `/proc/diskstats`.
 *
 * One line per block device: `major minor name` followed by counters. How many
 * counters there are depends on the kernel, so the tail is optional:
 *
 *   14 fields  every kernel — reads, writes, in-flight and time counters
 *   18 fields  Linux 4.18+  — plus discards
 *   20 fields  Linux 5.5+   — plus flush requests
 *
 * Counters are cumulative since boot. Sector counts are always in 512-byte
 * units regardless of the device's real sector size.
 */

export const SECTOR_BYTES = 512;

export interface IoCounters {
  completed: number;
  merged: number;
  sectors: number;
  ms: number;
  /** `sectors` in bytes. */
  bytes: number;
}

export interface DiskStat {
  major: number;
  minor: number;
  device: string;
  reads: IoCounters;
  writes: IoCounters;
  /** Requests issued but not yet finished. */
  inFlight: number;
  /** Milliseconds spent doing I/O. */
  ioMs: number;
  weightedIoMs: number;
  /** Linux 4.18+ only. */
  discards: IoCounters | undefined;
  /** Linux 5.5+ only. */
  flush: { requests: number; ms: number } | undefined;
  /** Bytes read plus bytes written, i.e. how busy the device has been. */
  bytesMoved: number;
}

function counters(completed = 0, merged = 0, sectors = 0, ms = 0): IoCounters {
  return { completed, merged, sectors, ms, bytes: sectors * SECTOR_BYTES };
}

export function parseDiskstats(text: string): DiskStat[] {
  const stats: DiskStat[] = [];

  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/);
    // major, minor, name and the eleven counters every kernel reports.
    if (fields.length < 14) continue;

    const [major, minor, device, ...rest] = fields;
    const n = (index: number): number => Number(rest[index] ?? 0) || 0;

    const reads = counters(n(0), n(1), n(2), n(3));
    const writes = counters(n(4), n(5), n(6), n(7));

    stats.push({
      major: Number(major),
      minor: Number(minor),
      device: device!,
      reads,
      writes,
      inFlight: n(8),
      ioMs: n(9),
      weightedIoMs: n(10),
      discards: fields.length >= 18 ? counters(n(11), n(12), n(13), n(14)) : undefined,
      flush: fields.length >= 20 ? { requests: n(15), ms: n(16) } : undefined,
      bytesMoved: reads.bytes + writes.bytes,
    });
  }

  return stats;
}

/** True when the device has never completed a read or a write. */
export function isIdle(stat: DiskStat): boolean {
  return stat.reads.completed === 0 && stat.writes.completed === 0;
}

/**
 * Whether `name` is what the kernel would call a partition of `disk`.
 *
 * The rule is the kernel's own, from `disk_name()`: a disk whose name ends in a
 * digit gets a `p` before the partition number, one that does not is followed
 * by the number directly — `nvme0n1` → `nvme0n1p2`, `sda` → `sda1`.
 *
 * Accepting either form for either kind of disk looks harmless and is not:
 * `loop10` would then read as partition 0 of `loop1`, so a snap-heavy desktop
 * would hide a dozen devices under another one and leave them out of the
 * totals below. The same rule is in src/lib/partitions.ts, which needs it for
 * the same reason — neither file states the relationship.
 */
function isPartitionName(name: string, disk: string): boolean {
  if (!name.startsWith(disk)) return false;

  const suffix = name.slice(disk.length);
  return /\d$/.test(disk) ? /^p\d+$/.test(suffix) : /^\d+$/.test(suffix);
}

/**
 * True when another listed device is this one's whole disk — `nvme0n1p2` under
 * `nvme0n1`, `sda1` under `sda`. Used to indent partitions under a disk, and to
 * keep them out of the totals, since a partition repeats its disk's I/O.
 */
export function isPartitionOf(stat: DiskStat, all: readonly DiskStat[]): DiskStat | undefined {
  return all.find(
    (candidate) =>
      candidate !== stat &&
      candidate.major === stat.major &&
      isPartitionName(stat.device, candidate.device),
  );
}

export interface DiskstatsSummary {
  devices: number;
  /** Devices that have completed at least one read or write. */
  active: number;
  bytesRead: number;
  bytesWritten: number;
  /** The device that has moved the most bytes. */
  busiest: DiskStat | undefined;
  /** Highest number of requests in flight across the listed devices. */
  inFlight: number;
}

export function summarize(stats: readonly DiskStat[]): DiskstatsSummary {
  // Partitions repeat their disk's I/O, so only whole disks are totalled.
  const disks = stats.filter((stat) => isPartitionOf(stat, stats) === undefined);

  return {
    devices: stats.length,
    active: stats.filter((stat) => !isIdle(stat)).length,
    bytesRead: disks.reduce((total, stat) => total + stat.reads.bytes, 0),
    bytesWritten: disks.reduce((total, stat) => total + stat.writes.bytes, 0),
    busiest: disks.reduce<DiskStat | undefined>(
      (best, stat) => (best === undefined || stat.bytesMoved > best.bytesMoved ? stat : best),
      undefined,
    ),
    inFlight: stats.reduce((most, stat) => Math.max(most, stat.inFlight), 0),
  };
}

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];

/** Human-readable byte count, e.g. `48.2 GB`. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }

  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}

/** Human-readable duration from a millisecond counter, e.g. `31m 53s`. */
export function formatDuration(ms: number): string {
  if (ms === 0) return '0';
  if (ms < 1000) return `${ms} ms`;

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
