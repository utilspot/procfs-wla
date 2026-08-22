import { describe, expect, it } from 'vitest';
import { readPartitionsFixture as fixture } from '../test/fixtures';
import {
  BLOCK_SIZE,
  bytes,
  disks,
  formatBytes,
  groupByDisk,
  isEmpty,
  isPartitionOf,
  parsePartitions,
  shareOfDisk,
  summarize,
  unpartitionedBytes,
} from './partitions';

describe('parsePartitions — an NVMe laptop', () => {
  const all = parsePartitions(fixture('nvme-laptop'));
  const device = (name: string) => all.find((candidate) => candidate.name === name)!;

  it('skips the header and reads a row per device', () => {
    expect(all).toHaveLength(8);
    expect(all.every((partition) => partition.name !== 'name')).toBe(true);
  });

  it('reads the four columns', () => {
    expect(device('nvme0n1p1')).toEqual({
      major: 259,
      minor: 1,
      blocks: 500000,
      name: 'nvme0n1p1',
    });
  });

  // The column is 1 KiB blocks, not 512-byte sectors as diskstats uses.
  it('reads blocks as 1 KiB units', () => {
    expect(BLOCK_SIZE).toBe(1024);
    expect(bytes(device('nvme0n1p1'))).toBe(500000 * 1024);
    expect(formatBytes(bytes(device('nvme0n1')))).toBe('512 GB');
  });

  it('matches partitions to their disk across the p separator', () => {
    expect(isPartitionOf(device('nvme0n1p2'), all)).toBe(device('nvme0n1'));
    expect(isPartitionOf(device('nvme0n1'), all)).toBeUndefined();
    // A device-mapper volume is whole, not a partition of anything.
    expect(isPartitionOf(device('dm-0'), all)).toBeUndefined();
  });

  it('groups each disk with its partitions in on-disk order', () => {
    const [first] = groupByDisk(all);

    expect(first?.disk.name).toBe('nvme0n1');
    expect(first?.partitions.map((partition) => partition.name)).toEqual([
      'nvme0n1p1',
      'nvme0n1p2',
      'nvme0n1p3',
    ]);
  });

  it('works out what share of the disk a partition takes', () => {
    const disk = device('nvme0n1');

    expect(shareOfDisk(device('nvme0n1p3'), disk)).toBeCloseTo(0.996, 2);
    expect(shareOfDisk(device('nvme0n1p1'), disk)).toBeLessThan(0.01);
  });

  it('reports the space a partitioned disk has left over', () => {
    const [first] = groupByDisk(all);

    // Half a gigabyte of alignment and partition table.
    expect(formatBytes(unpartitionedBytes(first!)!)).toBe('464 MB');
  });

  // A volume used whole has no partitions; its full size is not "unpartitioned".
  it('reports no leftover space for a device with no partitions', () => {
    const dm = groupByDisk(all).find((group) => group.disk.name === 'dm-0')!;

    expect(dm.partitions).toEqual([]);
    expect(unpartitionedBytes(dm)).toBeNull();
  });

  it('reads a loop device the kernel lists at zero size', () => {
    expect(isEmpty(device('loop2'))).toBe(true);
    expect(isEmpty(device('loop0'))).toBe(false);
    expect(summarize(all).empty).toBe(1);
  });

  it('totals whole disks only, so partitions are not counted twice', () => {
    const summary = summarize(all);

    expect(summary.devices).toBe(8);
    expect(summary.disks).toBe(5);
    expect(summary.partitions).toBe(3);
    expect(summary.totalBytes).toBe(
      disks(all).reduce((total, partition) => total + bytes(partition), 0),
    );
    // The three partitions add up to nearly the disk on their own.
    expect(summary.totalBytes).toBeLessThan(
      all.reduce((total, partition) => total + bytes(partition), 0),
    );
  });
});

describe('parsePartitions — a snap-heavy desktop', () => {
  const all = parsePartitions(fixture('many-loops'));

  /**
   * `loop1` ends in a digit, so its partitions would be `loop1p1` — `loop10` is
   * its own device. A looser rule reads it as partition 0 of `loop1` and hides
   * ten devices under another one.
   */
  it('does not read a higher-numbered loop as a partition of a lower one', () => {
    const nested = all.filter((partition) => isPartitionOf(partition, all) !== undefined);

    expect(nested.map((partition) => partition.name)).toEqual(['sda1']);
    expect(isPartitionOf(all.find((p) => p.name === 'loop10')!, all)).toBeUndefined();
    expect(isPartitionOf(all.find((p) => p.name === 'loop11')!, all)).toBeUndefined();
    expect(summarize(all).disks).toBe(13);
  });

  it('sees a disk that is only half carved up', () => {
    const sda = groupByDisk(all).find((group) => group.disk.name === 'sda')!;

    expect(formatBytes(unpartitionedBytes(sda)!)).toBe('500 GB');
  });
});

describe('parsePartitions — a Raspberry Pi', () => {
  const all = parsePartitions(fixture('rpi-sdcard'));

  it('matches mmc partitions across the p separator too', () => {
    expect(isPartitionOf(all.find((p) => p.name === 'mmcblk0p1')!, all)?.name).toBe('mmcblk0');
    expect(summarize(all)).toMatchObject({ disks: 2, partitions: 2 });
  });
});

describe('parsePartitions — a storage server', () => {
  const all = parsePartitions(fixture('sata-server'));

  it('matches SCSI partitions without a separator', () => {
    expect(isPartitionOf(all.find((p) => p.name === 'sda1')!, all)?.name).toBe('sda');
  });

  it('treats md and dm devices as whole disks, since the file does not stack them', () => {
    expect(isPartitionOf(all.find((p) => p.name === 'md0')!, all)).toBeUndefined();
    expect(isPartitionOf(all.find((p) => p.name === 'dm-1')!, all)).toBeUndefined();
    // Which means the total counts the array and its members both.
    expect(summarize(all).disks).toBe(8);
  });
});

describe('parsePartitions — every fixture', () => {
  const names = ['nvme-laptop', 'sata-server', 'rpi-sdcard', 'vm-minimal', 'many-loops'];

  it.each(names)('parses %s into consistent devices', (name) => {
    const all = parsePartitions(fixture(name));

    expect(all.length).toBeGreaterThan(0);

    for (const partition of all) {
      expect(partition.name).not.toBe('');
      expect(Number.isInteger(partition.major)).toBe(true);
      expect(partition.blocks).toBeGreaterThanOrEqual(0);
    }

    for (const group of groupByDisk(all)) {
      // A partition never claims more space than the disk it is on.
      const used = group.partitions.reduce((total, p) => total + p.blocks, 0);
      expect(used).toBeLessThanOrEqual(group.disk.blocks);
      for (const partition of group.partitions) {
        expect(shareOfDisk(partition, group.disk)).toBeLessThanOrEqual(1);
      }
    }

    // Grouping accounts for every row exactly once.
    const grouped = groupByDisk(all).reduce(
      (count, group) => count + 1 + group.partitions.length,
      0,
    );
    expect(grouped).toBe(all.length);
  });
});

describe('parsePartitions — awkward input', () => {
  it('returns nothing for a file that is not /proc/partitions', () => {
    expect(parsePartitions('')).toEqual([]);
    expect(parsePartitions('processor\t: 0\n')).toEqual([]);
  });

  it('skips the header even without a blank line after it', () => {
    const all = parsePartitions('major minor  #blocks  name\n   8        0  100 sda\n');

    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('sda');
  });

  it('skips a row with a missing column', () => {
    expect(parsePartitions('   8        0  sda\n')).toEqual([]);
  });

  it('skips a row whose name has a space in it', () => {
    expect(parsePartitions('   8   0   100   my disk\n')).toEqual([]);
  });

  it('does not match a partition on a different major', () => {
    const all = parsePartitions('  8  0  100 sda\n  9  1  50 sda1\n');

    expect(isPartitionOf(all[1]!, all)).toBeUndefined();
  });

  it('has no share of a disk the kernel lists at zero size', () => {
    const all = parsePartitions('  7  0  0 loop0\n');

    expect(shareOfDisk(all[0]!, all[0]!)).toBe(0);
    expect(summarize(all).totalBytes).toBe(0);
  });
});

describe('formatBytes', () => {
  // Disk capacities are quoted in decimal units, as the diskstats page does.
  it('scales through the decimal units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_000_000)).toBe('1.0 MB');
    expect(formatBytes(512_000_000_000)).toBe('512 GB');
    expect(formatBytes(12_000_000_000_000)).toBe('12 TB');
  });
});
