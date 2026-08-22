/**
 * Parser for `/proc/partitions`.
 *
 * A header, a blank line, then one row per block device the kernel knows:
 *
 *   major minor  #blocks  name
 *
 *    259        0  500107608 nvme0n1
 *    259        1    1048576 nvme0n1p1
 *    259        2  499057152 nvme0n1p2
 *      7        0      65536 loop0
 *
 * **`#blocks` is in 1024-byte blocks, not sectors** — the one thing here that
 * is easy to get wrong, and worth 2x if you assume 512-byte sectors as
 * `/proc/diskstats` uses. See {@link BLOCK_SIZE}.
 *
 * Whole disks and their partitions are listed flat, side by side. Nothing marks
 * which is which: a partition is recognised by its name being its disk's name
 * plus a numeric suffix, on the same major — `nvme0n1p2` under `nvme0n1`,
 * `sda1` under `sda`. That is the same rule `/proc/diskstats` needs, since
 * neither file states the relationship.
 *
 * A partition's blocks are part of its disk's, so totalling every row would
 * count the same space twice; {@link summarize} adds up whole disks only.
 */

/** Size of one block in `#blocks`, in bytes. */
export const BLOCK_SIZE = 1024;

export interface Partition {
  major: number;
  minor: number;
  /** Size in 1024-byte blocks, as the kernel reports it. */
  blocks: number;
  name: string;
}

/** `  259        1    1048576 nvme0n1p1` */
const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/;

export function parsePartitions(text: string): Partition[] {
  const partitions: Partition[] = [];

  for (const line of text.split('\n')) {
    // The header names the columns and is not a row; so is a blank line.
    const match = ROW.exec(line);
    if (match === null) continue;

    partitions.push({
      major: Number(match[1]),
      minor: Number(match[2]),
      blocks: Number(match[3]),
      name: match[4]!,
    });
  }

  return partitions;
}

/** Size in bytes, from the 1 KiB blocks the kernel reports. */
export function bytes(partition: Partition): number {
  return partition.blocks * BLOCK_SIZE;
}

/**
 * Whether `name` is what the kernel would call partition N of `disk`.
 *
 * The rule is the kernel's own, from `disk_name()`: a disk whose name ends in a
 * digit gets a `p` before the partition number, one that does not is followed
 * by the number directly. So `nvme0n1` → `nvme0n1p2` and `sda` → `sda1`.
 *
 * Accepting either form for either kind of disk looks harmless and is not:
 * `loop10` would then read as partition 0 of `loop1`, and a machine with a
 * dozen snap loops has several of those.
 */
function isPartitionName(name: string, disk: string): boolean {
  if (!name.startsWith(disk)) return false;

  const suffix = name.slice(disk.length);
  const separated = /\d$/.test(disk);
  return separated ? /^p\d+$/.test(suffix) : /^\d+$/.test(suffix);
}

/**
 * The disk this row is a partition of, or undefined when it is a whole device.
 * Matched on the same major and the kernel's partition naming.
 */
export function isPartitionOf(
  partition: Partition,
  all: readonly Partition[],
): Partition | undefined {
  return all.find(
    (candidate) =>
      candidate !== partition &&
      candidate.major === partition.major &&
      isPartitionName(partition.name, candidate.name),
  );
}

/** Whole devices, i.e. everything that is not a partition of something else. */
export function disks(all: readonly Partition[]): Partition[] {
  return all.filter((partition) => isPartitionOf(partition, all) === undefined);
}

/** A device the kernel lists at zero size — an unused loop or ram device. */
export function isEmpty(partition: Partition): boolean {
  return partition.blocks === 0;
}

export interface PartitionsSummary {
  /** Rows in the file. */
  devices: number;
  disks: number;
  partitions: number;
  empty: number;
  /** Capacity of the whole disks, with partitions not double-counted. */
  totalBytes: number;
  /** Whole disks by size, largest first. */
  largest: Partition[];
}

export function summarize(all: readonly Partition[]): PartitionsSummary {
  const whole = disks(all);

  return {
    devices: all.length,
    disks: whole.length,
    partitions: all.length - whole.length,
    empty: all.filter(isEmpty).length,
    totalBytes: whole.reduce((total, partition) => total + bytes(partition), 0),
    largest: [...whole].sort((a, b) => b.blocks - a.blocks || a.name.localeCompare(b.name)),
  };
}

/**
 * Rows grouped as disks with their partitions, disks largest first and each
 * disk's partitions in minor order — which is the order they sit on the device.
 */
export interface DiskGroup {
  disk: Partition;
  partitions: Partition[];
}

export function groupByDisk(all: readonly Partition[]): DiskGroup[] {
  return summarize(all).largest.map((disk) => ({
    disk,
    partitions: all
      .filter((partition) => isPartitionOf(partition, all) === disk)
      .sort((a, b) => a.minor - b.minor),
  }));
}

/** How much of its disk a partition takes, 0–1. */
export function shareOfDisk(partition: Partition, disk: Partition): number {
  return disk.blocks === 0 ? 0 : partition.blocks / disk.blocks;
}

/**
 * Space on a partitioned disk not covered by any of its partitions. Usually a
 * few megabytes of partition table and alignment; a large figure means the disk
 * is not fully carved up.
 *
 * Null for a device with no partitions at all — an LVM volume or a loop device
 * is used whole, and calling its entire size "unpartitioned" would say nothing.
 */
export function unpartitionedBytes(group: DiskGroup): number | null {
  if (group.partitions.length === 0) return null;

  const used = group.partitions.reduce((total, partition) => total + partition.blocks, 0);
  return Math.max(0, (group.disk.blocks - used) * BLOCK_SIZE);
}

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];

/** Decimal units, the way disk capacities are quoted — as diskstats does. */
export function formatBytes(value: number): string {
  if (value === 0) return '0 B';

  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < UNITS.length - 1) {
    size /= 1000;
    unit += 1;
  }

  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}
