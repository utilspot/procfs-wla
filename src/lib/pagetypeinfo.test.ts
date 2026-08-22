import { describe, expect, it } from 'vitest';
import { readPageTypeInfoFixture as fixture } from '../test/fixtures';
import {
  blockShare,
  bytesIn,
  bytesOf,
  describeType,
  formatBytes,
  hasWholeBlock,
  largestOrder,
  PAGE_SIZE,
  pagesIn,
  pagesOf,
  parsePageTypeInfo,
  summarize,
  totalBlocks,
  zones,
} from './pagetypeinfo';

describe('parsePageTypeInfo — a healthy desktop', () => {
  const info = parsePageTypeInfo(fixture('desktop'));

  it('reads the two header numbers', () => {
    expect(info.pageblockOrder).toBe(9);
    expect(info.pagesPerBlock).toBe(512);
    // Which agree: a pageblock is 2^9 pages.
    expect(pagesIn(info.pageblockOrder!)).toBe(info.pagesPerBlock);
  });

  it('reads the migrate types from the second table’s header', () => {
    expect(info.types).toEqual([
      'Unmovable',
      'Movable',
      'Reclaimable',
      'HighAtomic',
      'CMA',
      'Isolate',
    ]);
  });

  it('reads a row per zone and type', () => {
    expect(info.free).toHaveLength(18);
    expect(info.free[0]).toMatchObject({ node: 0, zone: 'DMA', type: 'Unmovable' });
    expect(info.free[0]?.counts).toEqual([1, 1, 1, 0, 2, 1, 1, 0, 1, 0, 0]);
  });

  it('reads the pageblock counts from the second table', () => {
    const normal = info.blocks.find((row) => row.zone === 'Normal')!;

    expect(normal.blocks).toEqual({
      Unmovable: 204,
      Movable: 6820,
      Reclaimable: 312,
      HighAtomic: 1,
      CMA: 0,
      Isolate: 0,
    });
    expect(totalBlocks(normal)).toBe(7337);
    expect(blockShare(normal, 'Movable')).toBeCloseTo(6820 / 7337);
  });

  /**
   * A block at order N is 2^N pages, so the counts are not comparable across
   * columns — the weighting is what makes a row mean anything.
   */
  it('weights each order by what a block there is worth', () => {
    const movable = info.free.find(
      (row) => row.zone === 'Normal' && row.type === 'Movable',
    )!;

    const unweighted = movable.counts.reduce((total, count) => total + count, 0);
    expect(pagesOf(movable)).toBeGreaterThan(unweighted * 10);
    expect(bytesOf(movable)).toBe(pagesOf(movable) * PAGE_SIZE);
  });

  it('finds the largest run each type can satisfy', () => {
    const movable = info.free.find((row) => row.zone === 'DMA' && row.type === 'Movable')!;
    const unmovable = info.free.find((row) => row.zone === 'DMA' && row.type === 'Unmovable')!;
    const empty = info.free.find((row) => row.zone === 'DMA' && row.type === 'CMA')!;

    expect(largestOrder(movable)).toBe(10);
    expect(largestOrder(unmovable)).toBe(8);
    expect(largestOrder(empty)).toBeNull();
  });

  it('groups the rows by zone, with that zone’s block counts', () => {
    const grouped = zones(info);

    expect(grouped.map((zone) => zone.zone)).toEqual(['DMA', 'DMA32', 'Normal']);
    expect(grouped[0]?.rows).toHaveLength(6);
    expect(grouped[0]?.blocks?.blocks.Movable).toBe(7);
  });

  // Every zone here has something at or above the pageblock order.
  it('finds nothing fragmented past a pageblock', () => {
    const summary = summarize(info);

    expect(summary.fragmented).toEqual([]);
    expect(zones(info).every((zone) => hasWholeBlock(zone, 9))).toBe(true);
  });

  it('totals the free memory by type, largest first', () => {
    const summary = summarize(info);

    expect(summary.totals[0]?.type).toBe('Movable');
    expect(summary.totals.map((entry) => entry.type)).toContain('Reclaimable');
    expect(summary.totalBytes).toBe(
      summary.totals.reduce((total, entry) => total + entry.bytes, 0),
    );
    expect(summary).toMatchObject({ nodes: 1, zones: 3, orders: 11, pageblockOrder: 9 });
  });
});

describe('parsePageTypeInfo — a fragmented machine', () => {
  const info = parsePageTypeInfo(fixture('fragmented'));

  /**
   * Plenty free, and none of it in a run as large as a pageblock — which is
   * the question this file exists to answer.
   */
  it('finds the zones with nothing as large as a pageblock', () => {
    const summary = summarize(info);

    expect(summary.fragmented.map((zone) => zone.zone)).toEqual(['DMA', 'Normal']);
    expect(summary.totalBytes).toBeGreaterThan(100 * 1024 * 1024);
  });

  it('finds the largest run left, which is well short of one', () => {
    const movable = info.free.find(
      (row) => row.zone === 'Normal' && row.type === 'Movable',
    )!;

    expect(largestOrder(movable)).toBe(4);
    expect(formatBytes(bytesIn(largestOrder(movable)!))).toBe('64 KiB');
  });

  // Unmovable blocks growing at the expense of movable ones is the kind of
  // fragmentation that does not undo itself.
  it('shows how far the blocks have drifted to unmovable', () => {
    const normal = info.blocks.find((row) => row.zone === 'Normal')!;

    expect(blockShare(normal, 'Unmovable')).toBeGreaterThan(0.35);
    expect(blockShare(normal, 'Movable')).toBeLessThan(0.51);
  });
});

describe('parsePageTypeInfo — two NUMA nodes', () => {
  const info = parsePageTypeInfo(fixture('numa-2node'));

  it('keeps each node’s zones apart', () => {
    const grouped = zones(info);

    expect(grouped.map((zone) => `${zone.node}/${zone.zone}`)).toEqual([
      '0/DMA32',
      '0/Normal',
      '1/Normal',
    ]);
    expect(summarize(info)).toMatchObject({ nodes: 2, zones: 3 });
  });

  it('reads a HighAtomic reserve on one node only', () => {
    const reserved = info.free.find(
      (row) => row.node === 1 && row.type === 'HighAtomic',
    )!;

    expect(largestOrder(reserved)).toBe(10);
    expect(describeType('HighAtomic')).toMatch(/cannot sleep/);
  });
});

describe('parsePageTypeInfo — an ARM board with CMA', () => {
  const info = parsePageTypeInfo(fixture('arm-cma'));

  /**
   * A different architecture puts the pageblock somewhere else, so both the
   * order and the column count are read rather than assumed.
   */
  it('reads a larger pageblock order and more orders', () => {
    expect(info.pageblockOrder).toBe(10);
    expect(info.pagesPerBlock).toBe(1024);
    expect(summarize(info).orders).toBe(12);
    expect(formatBytes(summarize(info).pageblockBytes!)).toBe('4.0 MiB');
  });

  it('reads the CMA area, which sits entirely at the top order', () => {
    const cma = info.free.find((row) => row.type === 'CMA')!;

    expect(largestOrder(cma)).toBe(11);
    expect(cma.counts.slice(0, 11).every((count) => count === 0)).toBe(true);
    expect(describeType('CMA')).toMatch(/contiguous allocations/);
    expect(info.blocks[0]?.blocks.CMA).toBe(64);
  });
});

describe('parsePageTypeInfo — a small VM', () => {
  const info = parsePageTypeInfo(fixture('vm-small'));

  it('reads a file with a single zone', () => {
    expect(summarize(info)).toMatchObject({ nodes: 1, zones: 1 });
    expect(info.free).toHaveLength(6);
  });
});

describe('parsePageTypeInfo — every fixture', () => {
  const names = ['desktop', 'fragmented', 'numa-2node', 'arm-cma', 'vm-small'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parsePageTypeInfo(fixture(name));
    const summary = summarize(info);

    expect(info.pageblockOrder).not.toBeNull();
    // The two header numbers say the same thing twice.
    expect(pagesIn(info.pageblockOrder!)).toBe(info.pagesPerBlock);

    for (const row of info.free) {
      expect(row.zone).not.toBe('');
      expect(info.types).toContain(row.type);
      // Every row in a file has the same number of orders.
      expect(row.counts).toHaveLength(summary.orders);
      expect(row.counts.every((count) => Number.isInteger(count) && count >= 0)).toBe(true);
      // The largest order is one the row actually has a block at.
      const largest = largestOrder(row);
      if (largest !== null) expect(row.counts[largest]).toBeGreaterThan(0);
      else expect(pagesOf(row)).toBe(0);
    }

    // Every zone in the first table has a row in the second.
    for (const zone of zones(info)) {
      expect(zone.blocks).not.toBeNull();
      expect(zone.rows.length).toBeGreaterThan(0);
    }

    // The per-type totals account for all the free memory.
    expect(summary.totals.reduce((total, entry) => total + entry.pages, 0)).toBe(
      info.free.reduce((total, row) => total + pagesOf(row), 0),
    );
  });
});

describe('parsePageTypeInfo — awkward input', () => {
  it('returns nothing for an empty file', () => {
    const info = parsePageTypeInfo('');

    expect(info.free).toEqual([]);
    expect(info.blocks).toEqual([]);
    expect(info.pageblockOrder).toBeNull();
    expect(summarize(info)).toMatchObject({ zones: 0, orders: 0, totalBytes: 0 });
  });

  it('returns nothing for a file that is not /proc/pagetypeinfo', () => {
    expect(parsePageTypeInfo('MemTotal:  1024 kB\n').free).toEqual([]);
  });

  /**
   * The two tables are told apart by shape: a free row names its type, a block
   * row does not — and a block row only counts after its header.
   */
  it('keeps a block row out of the free table', () => {
    const info = parsePageTypeInfo(
      [
        'Node 0, zone Normal, type Unmovable      1      2',
        'Number of blocks type     Unmovable      Movable ',
        'Node 0, zone   Normal            5           10 ',
      ].join('\n'),
    );

    expect(info.free).toHaveLength(1);
    expect(info.blocks).toHaveLength(1);
    expect(info.blocks[0]?.blocks).toEqual({ Unmovable: 5, Movable: 10 });
  });

  it('ignores a block row that comes before its header', () => {
    expect(parsePageTypeInfo('Node 0, zone   Normal            5           10 \n').blocks).toEqual(
      [],
    );
  });

  // A kernel built with CONFIG_PAGE_OWNER adds a third table.
  it('passes over the mixed-block table a page-owner kernel adds', () => {
    const info = parsePageTypeInfo(
      [
        'Page block order: 9',
        'Pages per block:  512',
        'Free pages count per migrate type at order       0      1 ',
        'Node    0, zone   Normal, type    Unmovable      4      2 ',
        'Number of blocks type     Unmovable      Movable ',
        'Node 0, zone   Normal            5           10 ',
        'Number of mixed blocks     Unmovable      Movable ',
        'Node 0, zone   Normal            1            2 ',
      ].join('\n'),
    );

    // The mixed table's rows have the shape of block rows, so the count is
    // what shows they were not taken for more of them.
    expect(info.free).toHaveLength(1);
    expect(info.blocks).toHaveLength(2);
    expect(info.types).toEqual(['Unmovable', 'Movable']);
  });

  it('names the types from the rows when there is no second table', () => {
    const info = parsePageTypeInfo(
      [
        'Node 0, zone Normal, type Unmovable      1      2',
        'Node 0, zone Normal, type   Movable      3      4',
      ].join('\n'),
    );

    expect(info.types).toEqual(['Unmovable', 'Movable']);
    expect(zones(info)[0]?.blocks).toBeNull();
  });

  it('claims no share for a zone owning no blocks', () => {
    expect(blockShare({ node: 0, zone: 'Normal', blocks: {} }, 'Movable')).toBeNull();
  });

  it('says nothing about fragmentation without a pageblock order', () => {
    const info = parsePageTypeInfo('Node 0, zone Normal, type Unmovable      1      2\n');

    expect(summarize(info).fragmented).toEqual([]);
    expect(hasWholeBlock(zones(info)[0]!, null)).toBe(true);
  });

  it('sizes a block from its order', () => {
    expect(formatBytes(bytesIn(0))).toBe('4.0 KiB');
    expect(formatBytes(bytesIn(9))).toBe('2.0 MiB');
    expect(pagesIn(10)).toBe(1024);
  });
});
