import { describe, expect, it } from 'vitest';
import { readDiskstatsFixture as fixture } from '../test/fixtures';
import {
  formatBytes,
  formatDuration,
  isIdle,
  isPartitionOf,
  parseDiskstats,
  summarize,
} from './diskstats';

describe('parseDiskstats — a modern kernel (20 fields)', () => {
  const stats = parseDiskstats(fixture('nvme-laptop'));

  it('reads every device', () => {
    expect(stats).toHaveLength(10);
    expect(stats.map((stat) => stat.device)).toContain('nvme0n1');
  });

  it('splits the counters and converts sectors to bytes', () => {
    const nvme = stats.find((stat) => stat.device === 'nvme0n1')!;

    expect(nvme).toMatchObject({ major: 259, minor: 0, inFlight: 0 });
    expect(nvme.reads).toMatchObject({ completed: 1284736, merged: 210453, sectors: 98234567 });
    expect(nvme.reads.bytes).toBe(98234567 * 512);
    expect(nvme.writes.bytes).toBe(187234891 * 512);
    expect(nvme.bytesMoved).toBe(nvme.reads.bytes + nvme.writes.bytes);
  });

  it('reads the discard and flush counters this kernel adds', () => {
    const nvme = stats.find((stat) => stat.device === 'nvme0n1')!;

    expect(nvme.discards).toMatchObject({ completed: 24893, sectors: 3847264 });
    expect(nvme.flush).toEqual({ requests: 4821, ms: 2394 });
  });

  it('spots the devices that have never been used', () => {
    expect(isIdle(stats.find((stat) => stat.device === 'sr0')!)).toBe(true);
    expect(isIdle(stats.find((stat) => stat.device === 'nvme0n1')!)).toBe(false);
  });

  it('matches partitions to their disk', () => {
    const partition = stats.find((stat) => stat.device === 'nvme0n1p2')!;
    const sda1 = stats.find((stat) => stat.device === 'sda1')!;
    const disk = stats.find((stat) => stat.device === 'nvme0n1')!;

    expect(isPartitionOf(partition, stats)).toBe(disk);
    expect(isPartitionOf(sda1, stats)?.device).toBe('sda');
    expect(isPartitionOf(disk, stats)).toBeUndefined();
    // dm-1 is not a partition of dm-0 despite the name prefix.
    expect(isPartitionOf(stats.find((stat) => stat.device === 'dm-1')!, stats)).toBeUndefined();
  });

  /**
   * A disk whose name ends in a digit separates its partitions with a `p`, so
   * `loop10` is its own device and not partition 0 of `loop1`. Getting this
   * wrong hides a dozen devices on a snap-heavy desktop and drops their I/O
   * from the totals.
   */
  it('does not read a higher-numbered device as a partition of a lower one', () => {
    const loops = parseDiskstats(fixture('many-loops'));
    const nested = loops.filter((stat) => isPartitionOf(stat, loops) !== undefined);

    expect(nested.map((stat) => stat.device)).toEqual(['nvme0n1p1']);
    expect(loops.find((stat) => stat.device === 'loop10')).toBeDefined();
    expect(isPartitionOf(loops.find((stat) => stat.device === 'loop10')!, loops)).toBeUndefined();
  });

  it('totals whole disks only, so partitions are not double counted', () => {
    const summary = summarize(stats);
    const disks = ['loop0', 'loop1', 'nvme0n1', 'sda', 'dm-0', 'dm-1', 'sr0'];

    expect(summary.devices).toBe(10);
    expect(summary.active).toBe(9);
    expect(summary.bytesRead).toBe(
      disks
        .map((name) => stats.find((stat) => stat.device === name)!.reads.bytes)
        .reduce((a, b) => a + b, 0),
    );
    expect(summary.busiest?.device).toBe('nvme0n1');
  });
});

describe('parseDiskstats — a RAID server (18 fields)', () => {
  const stats = parseDiskstats(fixture('sata-raid'));

  it('reads discards but reports no flush counters', () => {
    const sda = stats.find((stat) => stat.device === 'sda')!;

    expect(sda.discards).toMatchObject({ completed: 892341 });
    expect(sda.flush).toBeUndefined();
  });

  it('reports requests in flight', () => {
    expect(summarize(stats).inFlight).toBe(3);
    expect(stats.find((stat) => stat.device === 'sda')?.inFlight).toBe(3);
  });
});

describe('parseDiskstats — a pre-4.18 kernel (14 fields)', () => {
  const stats = parseDiskstats(fixture('legacy-kernel'));

  it('parses the short form without discard or flush', () => {
    expect(stats).toHaveLength(5);

    const hda = stats.find((stat) => stat.device === 'hda')!;
    expect(hda.reads.completed).toBe(128394);
    expect(hda.weightedIoMs).toBe(413115);
    expect(hda.discards).toBeUndefined();
    expect(hda.flush).toBeUndefined();
  });
});

describe('parseDiskstats — an idle VM', () => {
  it('handles a device with every counter at zero', () => {
    const stats = parseDiskstats(fixture('idle-vm'));
    const summary = summarize(stats);

    expect(stats).toHaveLength(3);
    expect(summary.active).toBe(2);
    expect(isIdle(stats.find((stat) => stat.device === 'vdb')!)).toBe(true);
  });
});

describe('parseDiskstats — many loop devices', () => {
  it('reads them all', () => {
    const stats = parseDiskstats(fixture('many-loops'));

    expect(stats).toHaveLength(27);
    expect(stats.filter((stat) => stat.device.startsWith('loop'))).toHaveLength(24);
  });
});

describe('parseDiskstats — edge cases', () => {
  it('returns nothing for an empty file', () => {
    expect(parseDiskstats('')).toEqual([]);
    expect(parseDiskstats('\n\n')).toEqual([]);
  });

  it('skips lines with too few fields to be a device', () => {
    expect(parseDiskstats('8 0 sda 1 2 3\n')).toEqual([]);
  });

  it('handles CRLF and leading whitespace', () => {
    const [stat] = parseDiskstats('   8       0 sda 1 2 3 4 5 6 7 8 0 9 10\r\n');
    expect(stat).toMatchObject({ major: 8, minor: 0, device: 'sda' });
    expect(stat?.reads.completed).toBe(1);
  });
});

describe('formatBytes', () => {
  it('scales to a readable unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(50_296_099_840)).toBe('50 GB');
    expect(formatBytes(1_500_000_000_000)).toBe('1.5 TB');
  });
});

describe('formatDuration', () => {
  it('scales from milliseconds to hours', () => {
    expect(formatDuration(0)).toBe('0');
    expect(formatDuration(412)).toBe('412 ms');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(1_912_384)).toBe('31m 52s');
    expect(formatDuration(26_528_568)).toBe('7h 22m');
  });
});
