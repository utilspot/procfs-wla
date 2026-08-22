import { describe, expect, it } from 'vitest';
import { readZoneInfoFixture as fixture } from '../test/fixtures';
import {
  cachedPages,
  describePageKey,
  describeTailKey,
  formatPages,
  holePages,
  isEmpty,
  isStalling,
  PAGE_SIZE,
  pagesToBytes,
  pageValue,
  parseZoneInfo,
  reservedPages,
  statValue,
  summarize,
  WATERMARK_STATES,
  watermarkState,
  zonesOfNode,
} from './zoneinfo';

const zoneNamed = (info: ReturnType<typeof parseZoneInfo>, node: number, name: string) =>
  info.zones.find((zone) => zone.node === node && zone.name === name)!;

describe('parseZoneInfo — a desktop, captured whole', () => {
  const info = parseZoneInfo(fixture('desktop'));

  it('reads a zone per block, across the node', () => {
    expect(info.zones.map((zone) => zone.name)).toEqual([
      'DMA',
      'DMA32',
      'Normal',
      'Movable',
      'Device',
    ]);
    expect(zonesOfNode(info, 0)).toHaveLength(5);
  });

  it('reads the watermark block a key at a time', () => {
    const normal = zoneNamed(info, 0, 'Normal');

    expect(pageValue(normal, 'free')).toBe(16387);
    expect(pageValue(normal, 'min')).toBe(11721);
    expect(pageValue(normal, 'low')).toBe(14651);
    expect(pageValue(normal, 'high')).toBe(17581);
    expect(pageValue(normal, 'managed')).toBe(2146127);
    expect(pageValue(normal, 'nonsense')).toBeNull();
  });

  /**
   * The per-node block is printed under whichever zone comes first, and does
   * not belong to it — reading it as the DMA zone's is out by a lot.
   */
  it('keeps the per-node stats out of the zone they were printed under', () => {
    expect(info.nodes).toHaveLength(1);
    expect(info.nodes[0]).toMatchObject({ node: 0, printedUnder: 'DMA' });

    const dma = zoneNamed(info, 0, 'DMA');
    const nodeStat = (name: string) =>
      info.nodes[0]!.stats.find((entry) => entry.name === name)?.value;

    // The node has 900k active anonymous pages; the DMA zone itself has none.
    expect(nodeStat('nr_active_anon')).toBe(910018);
    expect(statValue(dma, 'nr_zone_active_anon')).toBe(0);
    expect(statValue(dma, 'nr_active_anon')).toBeNull();
  });

  /**
   * Free caught between low and high, which is where kswapd keeps going once
   * it has been woken.
   */
  it('reads where free sits against the watermarks', () => {
    expect(watermarkState(zoneNamed(info, 0, 'Normal'))).toBe('below-high');
    expect(watermarkState(zoneNamed(info, 0, 'DMA'))).toBe('above-high');
    expect(watermarkState(zoneNamed(info, 0, 'DMA32'))).toBe('above-high');
    expect(WATERMARK_STATES['below-high']).toMatch(/kswapd keeps going/);
  });

  /** Three different page counts, and the gaps between them mean things. */
  it('tells spanned, present and managed apart', () => {
    const dma32 = zoneNamed(info, 0, 'DMA32');

    expect(pageValue(dma32, 'spanned')).toBe(1044480);
    expect(pageValue(dma32, 'present')).toBe(913392);
    expect(pageValue(dma32, 'managed')).toBe(897008);
    expect(holePages(dma32)).toBe(1044480 - 913392);
    expect(reservedPages(dma32)).toBe(913392 - 897008);
  });

  it('reads the lowmem_reserve array as the list it is', () => {
    const dma = zoneNamed(info, 0, 'DMA');

    expect(dma.protection).toEqual([0, 3503, 11887, 11887, 11887]);
    expect(zoneNamed(info, 0, 'Normal').protection).toEqual([0, 0, 0, 0, 0]);
  });

  it('reads the per-CPU page lists', () => {
    const normal = zoneNamed(info, 0, 'Normal');

    expect(normal.pagesets).toHaveLength(6);
    expect(normal.pagesets[0]?.cpu).toBe(0);
    expect(normal.pagesets[0]?.fields.map((field) => field.name)).toEqual([
      'count',
      'high',
      'batch',
      'high_min',
      'high_max',
      'vm stats threshold',
    ]);
    expect(cachedPages(normal)).toBeGreaterThan(0);
  });

  it('reads the keys after the pagesets', () => {
    const normal = zoneNamed(info, 0, 'Normal');
    const tail = Object.fromEntries(normal.tail.map((entry) => [entry.name, entry.value]));

    expect(tail).toMatchObject({ node_unreclaimable: 0, start_pfn: 1048576 });
    expect(describeTailKey('start_pfn')).toMatch(/first page frame/);
  });

  /** A zone can exist on paper with nothing in it. */
  it('reads an empty zone as empty', () => {
    const movable = zoneNamed(info, 0, 'Movable');

    expect(isEmpty(movable)).toBe(true);
    expect(watermarkState(movable)).toBe('empty');
    expect(movable.stats).toEqual([]);
    expect(movable.pagesets).toEqual([]);
    expect(isEmpty(zoneNamed(info, 0, 'Normal'))).toBe(false);
  });

  it('summarizes the machine', () => {
    const summary = summarize(info);

    expect(summary).toMatchObject({ zones: 5, empty: 2, perZoneLru: false });
    expect(summary.nodes).toEqual([0]);
    expect(summary.managedPages).toBe(3840 + 897008 + 2146127);
    expect(summary.stalling).toEqual([]);
    expect(summary.reclaiming.map((zone) => zone.name)).toEqual(['Normal']);
    expect(summary.unreclaimable).toEqual([]);
  });

  it('describes the keys worth explaining', () => {
    expect(describePageKey('managed')).toMatch(/firmware reservations/);
    expect(describePageKey('min')).toMatch(/stop and reclaim/);
    expect(describePageKey('nonsense')).toBeNull();
  });
});

describe('parseZoneInfo — a machine out of room', () => {
  const info = parseZoneInfo(fixture('under-pressure'));

  it('reads a zone driven below its min watermark', () => {
    const normal = zoneNamed(info, 0, 'Normal');

    expect(pageValue(normal, 'free')).toBe(8442);
    expect(pageValue(normal, 'min')).toBe(11721);
    expect(watermarkState(normal)).toBe('below-min');
    expect(isStalling(normal)).toBe(true);
  });

  /** The watermarks are boosted after a fragmenting allocation. */
  it('reads the boost applied to the watermarks', () => {
    expect(pageValue(zoneNamed(info, 0, 'Normal'), 'boost')).toBe(5860);
  });

  it('finds the node the kernel gave up reclaiming on', () => {
    const summary = summarize(info);

    expect(summary.stalling.map((zone) => zone.name)).toEqual(['Normal']);
    expect(summary.unreclaimable).toEqual([0]);
  });
});

describe('parseZoneInfo — a two-node server', () => {
  const info = parseZoneInfo(fixture('numa-2node'));

  it('reads a stats block per node, each under that node’s first zone', () => {
    expect(info.nodes.map((node) => node.node)).toEqual([0, 1]);
    expect(info.nodes[0]?.printedUnder).toBe('DMA');
    // Node 1 has no DMA zone, so its block sits under Normal instead.
    expect(info.nodes[1]?.printedUnder).toBe('Normal');
  });

  it('keeps each node’s zones apart', () => {
    expect(zonesOfNode(info, 0).map((zone) => zone.name)).toEqual([
      'DMA',
      'DMA32',
      'Normal',
      'Movable',
      'Device',
    ]);
    expect(zonesOfNode(info, 1).map((zone) => zone.name)).toEqual(['Normal', 'Movable']);
    expect(summarize(info).nodes).toEqual([0, 1]);
  });

  it('reads the far node’s own allocation counters', () => {
    const normal = zoneNamed(info, 1, 'Normal');

    expect(statValue(normal, 'numa_miss')).toBe(1204118);
    expect(statValue(normal, 'numa_foreign')).toBe(884422);
  });
});

describe('parseZoneInfo — a kernel from before the LRU moved off the zones', () => {
  const info = parseZoneInfo(fixture('legacy-4.4'));

  /** No per-node block at all: every statistic is in its zone. */
  it('reads a file with no per-node block', () => {
    expect(info.nodes).toEqual([]);
    expect(summarize(info).perZoneLru).toBe(true);
    expect(info.zones.map((zone) => zone.name)).toEqual(['DMA', 'DMA32', 'Normal']);
  });

  it('reads the keys that era printed instead', () => {
    const normal = zoneNamed(info, 0, 'Normal');
    const tail = Object.fromEntries(normal.tail.map((entry) => [entry.name, entry.value]));

    expect(tail).toMatchObject({ all_unreclaimable: 0, inactive_ratio: 1 });
    expect(tail.node_unreclaimable).toBeUndefined();
    expect(describeTailKey('all_unreclaimable')).toMatch(/before the LRU moved/);
  });

  it('reads the scanned count that sat beside the watermarks', () => {
    expect(pageValue(zoneNamed(info, 0, 'DMA'), 'scanned')).toBe(0);
    expect(pageValue(zoneNamed(info, 0, 'DMA'), 'boost')).toBeNull();
  });

  /** all_unreclaimable counts the same as node_unreclaimable would. */
  it('still finds an unreclaimable node under the older key', () => {
    const text = fixture('legacy-4.4').replace('all_unreclaimable:  0', 'all_unreclaimable:  1');

    expect(summarize(parseZoneInfo(text)).unreclaimable).toEqual([0]);
  });
});

describe('parseZoneInfo — the awkward files', () => {
  it('reads an empty file as no zones at all', () => {
    expect(parseZoneInfo('')).toEqual({ nodes: [], zones: [] });
    expect(summarize({ nodes: [], zones: [] })).toMatchObject({ zones: 0, managedPages: 0 });
  });

  it('ignores lines before the first zone header', () => {
    expect(parseZoneInfo('nonsense 1\nmore nonsense\n').zones).toEqual([]);
  });

  it('reads CRLF line endings', () => {
    const info = parseZoneInfo('Node 0, zone   Normal\r\n  pages free     100\r\n');

    expect(pageValue(info.zones[0]!, 'free')).toBe(100);
  });

  it('reads a zone header with nothing under it', () => {
    const info = parseZoneInfo('Node 0, zone   Normal\n');

    expect(info.zones[0]).toMatchObject({ node: 0, name: 'Normal', pages: [], protection: [] });
    expect(watermarkState(info.zones[0]!)).toBe('empty');
  });

  /** `high:` inside a pageset is not the `high` watermark. */
  it('does not take a pageset field for a watermark', () => {
    const info = parseZoneInfo(
      [
        'Node 0, zone   Normal',
        '  pages free     100',
        '        high     50',
        '        present  1000',
        '        protection: (0, 0)',
        '  pagesets',
        '    cpu: 0',
        '              count:    7',
        '              high:     999',
      ].join('\n'),
    );

    const zone = info.zones[0]!;
    expect(pageValue(zone, 'high')).toBe(50);
    expect(zone.pagesets[0]?.fields).toEqual([
      { name: 'count', value: 7 },
      { name: 'high', value: 999 },
    ]);
    expect(cachedPages(zone)).toBe(7);
  });

  it('does not go negative on a present count above spanned', () => {
    const info = parseZoneInfo(
      ['Node 0, zone Normal', '  pages free 1', '        spanned  10', '        present  20'].join(
        '\n',
      ),
    );

    expect(holePages(info.zones[0]!)).toBe(0);
  });

  it('reads a protection list of any length', () => {
    const info = parseZoneInfo(
      ['Node 0, zone Normal', '  pages free 1', '        protection: (0, 1, 2)'].join('\n'),
    );

    expect(info.zones[0]?.protection).toEqual([0, 1, 2]);
  });
});

describe('formatting', () => {
  it('reads a page count as the memory it stands for', () => {
    expect(pagesToBytes(1)).toBe(PAGE_SIZE);
    expect(formatPages(0)).toBe('0 B');
    expect(formatPages(1)).toBe('4.0 KiB');
    expect(formatPages(2146127)).toBe('8.2 GiB');
  });
});
