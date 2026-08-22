import { describe, expect, it } from 'vitest';
import { readBuddyInfoFixture as fixture } from '../test/fixtures';
import {
  blockBytes,
  distribution,
  formatBytes,
  freeBytes,
  largestBlockBytes,
  largestOrder,
  looksFragmented,
  PAGE_SIZE,
  parseBuddyInfo,
  summarize,
} from './buddyinfo';

describe('parseBuddyInfo — a healthy desktop', () => {
  const zones = parseBuddyInfo(fixture('desktop-healthy'));
  const zone = (name: string) => zones.find((candidate) => candidate.zone === name)!;

  it('reads a line per zone', () => {
    expect(zones).toHaveLength(3);
    expect(zones.map((z) => z.zone)).toEqual(['DMA', 'DMA32', 'Normal']);
    expect(zones.every((z) => z.node === 0)).toBe(true);
  });

  it('reads a count per order', () => {
    expect(zone('DMA').counts).toEqual([1, 1, 1, 0, 2, 1, 1, 0, 1, 1, 3]);
    expect(summarize(zones).orders).toBe(11);
  });

  // A block of order N is 2^N pages, so the columns are not comparable.
  it('weights each order by what a block of it is worth', () => {
    expect(blockBytes(0)).toBe(PAGE_SIZE);
    expect(blockBytes(10)).toBe(1024 * PAGE_SIZE);

    const dma = zone('DMA');
    expect(freeBytes(dma)).toBe(
      dma.counts.reduce((total, count, order) => total + count * blockBytes(order), 0),
    );
  });

  /**
   * The DMA row holds one block at order 0 and three at order 10. By count the
   * high orders look rare; by memory they are most of the zone.
   */
  it('shows that a rare high order can hold most of the memory', () => {
    const shares = distribution(zone('DMA'));

    expect(shares[0]?.count).toBe(1);
    expect(shares[10]?.count).toBe(3);
    expect(shares[10]!.share).toBeGreaterThan(0.7);
    expect(shares[0]!.share).toBeLessThan(0.001);
    // The shares account for the whole zone.
    expect(shares.reduce((total, s) => total + s.share, 0)).toBeCloseTo(1, 6);
  });

  it('finds the largest contiguous block a zone can hand out', () => {
    expect(largestOrder(zone('Normal'))).toBe(10);
    expect(formatBytes(largestBlockBytes(zone('Normal'))!)).toBe('4.0 MiB');
  });

  it('summarizes the machine', () => {
    const summary = summarize(zones);

    expect(summary).toMatchObject({ nodes: 1, zones: 3, orders: 11 });
    expect(formatBytes(summary.totalBytes)).toBe('5.6 GiB');
    expect(formatBytes(summary.largestBlockBytes!)).toBe('4.0 MiB');
    expect(summary.totalBytes).toBe(zones.reduce((total, z) => total + freeBytes(z), 0));
    expect(summary.largest[0]?.zone).toBe('Normal');
  });

  it('flags nothing as fragmented', () => {
    expect(summarize(zones).fragmented).toEqual([]);
  });
});

describe('parseBuddyInfo — a fragmented host', () => {
  const zones = parseBuddyInfo(fixture('fragmented'));
  const zone = (name: string) => zones.find((candidate) => candidate.zone === name)!;

  /**
   * The whole point of the file: gigabytes free, and still unable to satisfy a
   * 64 KiB contiguous request.
   */
  it('has plenty free but nothing above order 3', () => {
    const summary = summarize(zones);

    expect(formatBytes(summary.totalBytes)).toBe('1.5 GiB');
    expect(largestOrder(zone('Normal'))).toBe(3);
    expect(formatBytes(summary.largestBlockBytes!)).toBe('32 KiB');
  });

  it('names the zones that cannot satisfy a large request', () => {
    expect(summarize(zones).fragmented.map((z) => z.zone)).toEqual(['DMA32', 'Normal']);
  });

  // The DMA zone is also short of high orders, but holds only 208 KiB — too
  // little for the shortage to mean anything.
  it('leaves a tiny zone alone, however short of high orders it is', () => {
    expect(largestOrder(zone('DMA'))).toBe(3);
    expect(looksFragmented(zone('DMA'))).toBe(false);
    expect(freeBytes(zone('DMA'))).toBeLessThan(16 * 1024 * 1024);
  });

  it('puts most of the memory at the lowest orders', () => {
    const shares = distribution(zone('Normal'));

    expect(shares[0]!.share).toBeGreaterThan(0.5);
    expect(shares.slice(4).every((s) => s.bytes === 0)).toBe(true);
  });
});

describe('parseBuddyInfo — a NUMA machine', () => {
  const zones = parseBuddyInfo(fixture('numa-2node'));

  it('reads both nodes and their zones', () => {
    const summary = summarize(zones);

    expect(summary).toMatchObject({ nodes: 2, zones: 4 });
    expect(zones.filter((z) => z.node === 1).map((z) => z.zone)).toEqual(['Normal']);
  });

  // Two zones share a name across nodes, so a zone is only identified by both.
  it('keeps the two Normal zones apart', () => {
    const normals = zones.filter((z) => z.zone === 'Normal');

    expect(normals).toHaveLength(2);
    expect(normals.map((z) => z.node)).toEqual([0, 1]);
    expect(freeBytes(normals[0]!)).not.toBe(freeBytes(normals[1]!));
  });
});

describe('parseBuddyInfo — a freshly booted machine', () => {
  const zones = parseBuddyInfo(fixture('after-boot'));

  it('has nearly all its free memory in the top order', () => {
    const normal = zones.find((z) => z.zone === 'Normal')!;
    const shares = distribution(normal);

    expect(shares[10]!.share).toBeGreaterThan(0.85);
    expect(largestOrder(normal)).toBe(10);
  });
});

describe('parseBuddyInfo — a kernel with a larger MAX_ORDER', () => {
  const zones = parseBuddyInfo(fixture('arm-max-order-13'));

  // The column count comes from the file, not from an assumption about 11.
  it('reads thirteen orders rather than eleven', () => {
    const summary = summarize(zones);

    expect(summary.orders).toBe(13);
    expect(zones[0]?.counts).toHaveLength(13);
    expect(largestOrder(zones[0]!)).toBe(12);
    expect(formatBytes(summary.largestBlockBytes!)).toBe('16 MiB');
  });
});

describe('parseBuddyInfo — every fixture', () => {
  const names = [
    'desktop-healthy',
    'fragmented',
    'numa-2node',
    'after-boot',
    'arm-max-order-13',
  ];

  it.each(names)('parses %s into consistent zones', (name) => {
    const zones = parseBuddyInfo(fixture(name));

    expect(zones.length).toBeGreaterThan(0);

    for (const zone of zones) {
      expect(zone.zone).not.toBe('');
      expect(zone.node).toBeGreaterThanOrEqual(0);
      expect(zone.counts.every((count) => count >= 0)).toBe(true);
      // Every zone in a file carries the same number of columns.
      expect(zone.counts).toHaveLength(zones[0]!.counts.length);

      const shares = distribution(zone);
      expect(shares).toHaveLength(zone.counts.length);
      expect(shares.reduce((total, s) => total + s.bytes, 0)).toBe(freeBytes(zone));

      const largest = largestOrder(zone);
      if (largest !== null) {
        expect(zone.counts[largest]).toBeGreaterThan(0);
        // Nothing is free above it.
        expect(zone.counts.slice(largest + 1).every((count) => count === 0)).toBe(true);
      }
    }
  });
});

describe('parseBuddyInfo — awkward input', () => {
  it('returns nothing for a file that is not buddyinfo', () => {
    expect(parseBuddyInfo('')).toEqual([]);
    expect(parseBuddyInfo('processor\t: 0\n')).toEqual([]);
  });

  it('reads a zone whose name is not one of the usual ones', () => {
    const [zone] = parseBuddyInfo('Node 0, zone  Movable      0      0      1\n');

    expect(zone).toMatchObject({ node: 0, zone: 'Movable', counts: [0, 0, 1] });
  });

  it('reads a zone with nothing free at all', () => {
    const [zone] = parseBuddyInfo('Node 0, zone   Device      0      0      0\n');

    expect(freeBytes(zone!)).toBe(0);
    expect(largestOrder(zone!)).toBeNull();
    expect(largestBlockBytes(zone!)).toBeNull();
    expect(distribution(zone!).every((s) => s.share === 0)).toBe(true);
    // Nothing free is not the same as fragmented.
    expect(looksFragmented(zone!)).toBe(false);
  });

  it('has no largest block when no zone holds anything', () => {
    expect(summarize(parseBuddyInfo('Node 0, zone DMA 0 0 0\n')).largestBlockBytes).toBeNull();
  });

  it('skips a line with no counts', () => {
    expect(parseBuddyInfo('Node 0, zone DMA\n')).toEqual([]);
  });

  it('stops at a non-numeric column rather than shifting the orders', () => {
    const [zone] = parseBuddyInfo('Node 0, zone DMA 1 2 nonsense 4\n');

    expect(zone?.counts).toEqual([1, 2]);
  });

  it('reads a node number above nine', () => {
    expect(parseBuddyInfo('Node 15, zone Normal 1\n')[0]?.node).toBe(15);
  });
});

describe('formatBytes', () => {
  // Binary units: these are page counts, not disk capacities.
  it('scales through the binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(4096)).toBe('4.0 KiB');
    expect(formatBytes(64 * 1024)).toBe('64 KiB');
    expect(formatBytes(4 * 1024 ** 2)).toBe('4.0 MiB');
    expect(formatBytes(6 * 1024 ** 3)).toBe('6.0 GiB');
  });
});
