import { describe, expect, it } from 'vitest';
import { readVmstatFixture as fixture } from '../test/fixtures';
import {
  bytesOf,
  describeField,
  familyOf,
  formatBytes,
  formatCount,
  formatShare,
  isGauge,
  NOT_PAGES_SCANNED,
  numa,
  PAGE_SIZE,
  pagesToBytes,
  parseVmstat,
  reclaim,
  sumMatching,
  summarize,
  unitOf,
  valueOf,
} from './vmstat';

describe('parseVmstat — a desktop, captured whole', () => {
  const fields = parseVmstat(fixture('desktop'));

  it('reads every line of the file', () => {
    expect(fields).toHaveLength(195);
    expect(fields[0]).toMatchObject({ name: 'nr_free_pages', value: 621879 });
    expect(fields.at(-1)).toMatchObject({ name: 'nr_unstable', value: 0 });
  });

  /**
   * The file mixes levels with totals since boot, and reading one as the other
   * gets the machine backwards.
   */
  it('tells a level from a counter since boot', () => {
    expect(isGauge('nr_free_pages')).toBe(true);
    expect(isGauge('nr_zone_active_file')).toBe(true);
    expect(isGauge('pgfault')).toBe(false);
    expect(isGauge('numa_hit')).toBe(false);
  });

  /** `workingset_nodes` is the one level not named `nr_*`. */
  it('knows the one level that is not named nr_', () => {
    expect(isGauge('workingset_nodes')).toBe(true);
    expect(isGauge('workingset_refault_file')).toBe(false);
  });

  it('splits the file into levels and counters', () => {
    const summary = summarize(fields);

    expect(summary.gauges.length + summary.counters.length).toBe(195);
    expect(summary.gauges.map((field) => field.name)).toContain('nr_free_pages');
    expect(summary.counters.map((field) => field.name)).toContain('pgfault');
  });

  /**
   * pgpgin and pgpgout are kilobytes, which is why `vmstat -s` labels them
   * "K paged in" — and pswpin beside them really is pages.
   */
  it('knows which fields are not counted in pages', () => {
    expect(unitOf('pgpgin')).toBe('kilobytes');
    expect(unitOf('pgpgout')).toBe('kilobytes');
    expect(unitOf('nr_kernel_stack')).toBe('kilobytes');
    expect(unitOf('pswpin')).toBe('pages');
    expect(unitOf('nr_free_pages')).toBe('pages');
    expect(unitOf('pgfault')).toBe('events');
  });

  it('converts each unit to bytes accordingly, and events not at all', () => {
    const free = fields.find((field) => field.name === 'nr_free_pages')!;
    const pgpgin = fields.find((field) => field.name === 'pgpgin')!;
    const faults = fields.find((field) => field.name === 'pgfault')!;

    expect(bytesOf(free)).toBe(621879 * PAGE_SIZE);
    expect(bytesOf(pgpgin)).toBe(3906466 * 1024);
    expect(bytesOf(faults)).toBeNull();
  });

  it('summarizes what the levels say about memory right now', () => {
    const summary = summarize(fields);

    expect(summary.freeBytes).toBe(pagesToBytes(621879));
    expect(formatBytes(summary.freeBytes!)).toBe('2.4 GiB');
    expect(summary.cacheBytes).toBe(pagesToBytes(1397479));
    expect(summary.anonBytes).toBe(pagesToBytes(811379));
  });

  /** This machine has never been short of memory, so nothing was scanned. */
  it('reports no efficiency at all for a machine that never reclaimed', () => {
    const summary = summarize(fields);

    expect(summary.reclaim.scannedKswapd).toBe(0);
    expect(summary.reclaim.scannedDirect).toBe(0);
    expect(summary.reclaim.efficiency).toBeNull();
    expect(summary.reclaim.directShare).toBeNull();
    expect(summary.oomKills).toBe(0);
  });

  it('sorts each counter into a family', () => {
    expect(familyOf('pgfault')).toBe('paging');
    expect(familyOf('pgscan_kswapd')).toBe('reclaim');
    expect(familyOf('numa_hit')).toBe('numa');
    expect(familyOf('thp_fault_alloc')).toBe('hugepages');
    expect(familyOf('compact_stall')).toBe('compaction');
    expect(familyOf('workingset_refault_file')).toBe('workingset');
    expect(familyOf('direct_map_level2_splits')).toBe('other');
  });

  it('describes the fields worth explaining', () => {
    expect(describeField('pgmajfault')).toMatch(/wait for a disk/);
    expect(describeField('pgpgin')).toMatch(/kilobytes/);
    expect(describeField('some_new_counter')).toBeNull();
  });
});

describe('parseVmstat — a machine under memory pressure', () => {
  const fields = parseVmstat(fixture('under-pressure'));

  it('works out how hard the kernel worked for each page it got back', () => {
    const summary = reclaim(fields);

    expect(summary.scannedKswapd).toBe(48221984);
    expect(summary.scannedDirect).toBe(8442210);
    expect(summary.efficiency).toBeCloseTo(0.763, 3);
  });

  /**
   * Direct reclaim is an allocation being made to free memory itself before it
   * can proceed, which is felt as a stall.
   */
  it('separates direct reclaim from what kswapd did in the background', () => {
    const summary = reclaim(fields);

    expect(summary.directShare).toBeCloseTo(0.149, 3);
    expect(summary.stalls).toBe(88442 + 1204);
  });

  /** pgscan_direct_throttle matches the prefix and is not a page count. */
  it('keeps the throttle counter out of the pages scanned', () => {
    expect(valueOf(fields, 'pgscan_direct_throttle')).toBe(12884);
    expect(NOT_PAGES_SCANNED.has('pgscan_direct_throttle')).toBe(true);
    expect(reclaim(fields).scannedDirect).toBe(8442210);
    // Which is the field on its own, with the throttle count left out.
    expect(sumMatching(fields, /^pgscan_direct/)).toBe(8442210);
  });

  it('adds up the pages that had to be fetched back after eviction', () => {
    expect(summarize(fields).refaults).toBe(12884422 + 3118844);
  });

  it('reads the swap traffic and the kills', () => {
    const summary = summarize(fields);

    expect(summary.swapInPages).toBe(1884422);
    expect(summary.swapOutPages).toBe(4118844);
    expect(summary.oomKills).toBe(3);
    expect(summary.majorFaults).toBe(1884422);
  });
});

describe('parseVmstat — a two-node server', () => {
  const fields = parseVmstat(fixture('numa-2node'));

  it('reads the allocations that came off the wrong node', () => {
    const summary = numa(fields)!;

    expect(summary).toMatchObject({
      hit: 884422100,
      miss: 12884422,
      foreign: 12884422,
      local: 871537678,
      other: 25768844,
    });
    expect(summary.missShare).toBeCloseTo(0.0144, 4);
  });

  /** hit + miss and local + other count the same allocations two ways. */
  it('reads two sets of NUMA counters that agree on the total', () => {
    const summary = numa(fields)!;

    expect(summary.hit + summary.miss).toBe(summary.local + summary.other);
  });

  it('is null on a kernel with no NUMA counters at all', () => {
    expect(numa(parseVmstat('nr_free_pages 100\npgfault 200\n'))).toBeNull();
  });
});

describe('parseVmstat — hugepages in heavy use', () => {
  const fields = parseVmstat(fixture('thp-heavy'));

  it('reads the hugepage allocations and what fell back', () => {
    expect(valueOf(fields, 'thp_fault_alloc')).toBe(8844221);
    expect(valueOf(fields, 'thp_fault_fallback')).toBe(1204118);
    expect(valueOf(fields, 'nr_anon_transparent_hugepages')).toBe(88442);
  });

  it('reads the compaction that keeps them possible', () => {
    expect(valueOf(fields, 'compact_stall')).toBe(44221);
    expect(valueOf(fields, 'compact_success')).toBe(35377);
    expect(familyOf('compact_migrate_scanned')).toBe('compaction');
  });
});

describe('parseVmstat — a kernel from the 3.x days', () => {
  const fields = parseVmstat(fixture('legacy-3.x'));

  /** An absent field is not a zero — that kernel had no such counter. */
  it('has none of the fields the kernel had not gained yet', () => {
    expect(fields).toHaveLength(110);
    expect(valueOf(fields, 'workingset_refault_file')).toBeNull();
    expect(valueOf(fields, 'nr_zone_active_file')).toBeNull();
    expect(valueOf(fields, 'zswpin')).toBeNull();
  });

  /**
   * That kernel counted reclaim per zone, so the figure has to be summed over
   * the prefix rather than read out of one field.
   */
  it('sums the per-zone reclaim counters this kernel prints instead', () => {
    expect(valueOf(fields, 'pgscan_kswapd')).toBeNull();
    expect(valueOf(fields, 'pgscan_kswapd_normal')).toBe(3884422);

    const summary = reclaim(fields);
    expect(summary.scannedKswapd).toBe(0 + 588442 + 3884422);
    expect(summary.scannedDirect).toBe(0 + 188442 + 984221);
    expect(summary.stolenKswapd).toBe(0 + 442118 + 2884422);
    expect(summary.efficiency).toBeCloseTo(0.7, 1);
  });

  /** And it counted stalls in one field where a modern kernel has five. */
  it('reads the single allocstall this kernel has', () => {
    expect(valueOf(fields, 'allocstall')).toBe(12884);
    expect(valueOf(fields, 'allocstall_normal')).toBeNull();
    expect(reclaim(fields).stalls).toBe(12884);
  });
});

describe('parseVmstat — the awkward files', () => {
  it('reads an empty file as no fields at all', () => {
    expect(parseVmstat('')).toEqual([]);
    expect(summarize([])).toMatchObject({ fields: 0, freeBytes: null, oomKills: null });
  });

  it('ignores a line that is not a name and a number', () => {
    expect(parseVmstat('nonsense\nnr_free_pages notanumber\n')).toEqual([]);
  });

  it('reads CRLF line endings', () => {
    expect(parseVmstat('nr_free_pages 625283\r\n')[0]?.value).toBe(625283);
  });

  it('reads a negative value without refusing the line', () => {
    // nr_ counters can go momentarily negative on a busy machine.
    expect(parseVmstat('nr_isolated_anon -3\n')[0]?.value).toBe(-3);
  });

  it('does not divide by a total of zero', () => {
    const fields = parseVmstat('pgscan_kswapd 0\npgsteal_kswapd 0\nnuma_hit 0\nnuma_miss 0\n');

    expect(reclaim(fields).efficiency).toBeNull();
    expect(numa(fields)?.missShare).toBeNull();
  });

  /** Reclaiming more than was scanned would be nonsense; clamp rather than lie. */
  it('never reports an efficiency above one', () => {
    const fields = parseVmstat('pgscan_kswapd 10\npgsteal_kswapd 40\n');

    expect(reclaim(fields).efficiency).toBe(1);
  });

  it('keeps a field it has never heard of', () => {
    const fields = parseVmstat('some_new_counter 42\n');

    expect(fields[0]).toMatchObject({ name: 'some_new_counter', value: 42, gauge: false });
    expect(describeField('some_new_counter')).toBeNull();
  });
});

describe('formatting', () => {
  it('shortens a counter that has run since boot', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(2613)).toBe('2.6k');
    expect(formatCount(93164277)).toBe('93.2M');
    expect(formatCount(439752116)).toBe('439.8M');
    expect(formatCount(1.5e9)).toBe('1.5G');
  });

  it('reads a page count as the memory it stands for', () => {
    expect(formatBytes(pagesToBytes(0))).toBe('0 B');
    expect(formatBytes(pagesToBytes(1))).toBe('4.0 KiB');
    expect(formatBytes(pagesToBytes(621879))).toBe('2.4 GiB');
  });

  it('rounds a share, keeping a trace apart from nothing', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.0001)).toBe('<1%');
    expect(formatShare(0.763)).toBe('76%');
    expect(formatShare(1)).toBe('100%');
  });
});
