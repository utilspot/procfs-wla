/**
 * Parser for `/proc/vmstat`.
 *
 * A couple of hundred `name value` lines, and the thing to know before reading
 * any of them is that **two different kinds of number are mixed together**:
 *
 *   nr_free_pages 625283      ← a gauge: what is true right now, in pages
 *   pgfault 93081213          ← a counter: how many since boot, never resets
 *
 * Everything named `nr_*` is an instantaneous count; everything else is
 * monotonic since boot. Charting a gauge as a rate, or a counter as a level,
 * gets the machine backwards, so {@link isGauge} keeps them apart and this
 * page shows them in separate tables. `workingset_nodes` is the one gauge that
 * is not named `nr_*`.
 *
 * **The units are not uniform either.** Most `nr_*` fields are in pages, but:
 *
 * - `pgpgin` and `pgpgout` are in **kilobytes**, not pages — which is why
 *   `vmstat -s` labels them "K paged in" and "K paged out". Multiplying them
 *   by the page size overstates disk traffic fourfold.
 * - `nr_kernel_stack` is in **kilobytes** too: the kernel counts it as
 *   `NR_KERNEL_STACK_KB`.
 * - `pswpin` and `pswpout` really are pages, sitting right beside `pgpgin` in
 *   the file in a different unit.
 *
 * See {@link unitOf}.
 *
 * **Which fields exist depends on the kernel and its configuration**, so an
 * absent field is not a zero: a kernel without `CONFIG_TRANSPARENT_HUGEPAGE`
 * has no `thp_*` at all, and one from before 4.8 has no `nr_zone_*`. The
 * reclaim counters moved too — a 3.x kernel counts them per zone
 * (`pgscan_kswapd_normal`) where a modern one has a single `pgscan_kswapd`,
 * which is why the reclaim figures here are summed by prefix rather than read
 * from one field. See {@link sumMatching}.
 */

/**
 * Assumed page size, for turning a page count into bytes. The file never says
 * how large a page is; 4 KiB holds on x86 and on ARM64 with the usual granule,
 * as assumed elsewhere in this app.
 */
export const PAGE_SIZE = 4096;

/** Gauges that are not named `nr_*`. */
const EXTRA_GAUGES = new Set(['workingset_nodes']);

/** Fields the kernel counts in kilobytes rather than in pages. */
const KILOBYTE_FIELDS = new Set(['pgpgin', 'pgpgout', 'nr_kernel_stack']);

/** Fields that count pages despite not being named `nr_*`. */
const PAGE_FIELDS = new Set(['pswpin', 'pswpout']);

/**
 * Counts throttling events rather than pages scanned, so it must stay out of
 * any sum over `pgscan_direct*`.
 */
export const NOT_PAGES_SCANNED = new Set(['pgscan_direct_throttle']);

export type VmstatUnit = 'pages' | 'kilobytes' | 'events';

export interface VmstatField {
  name: string;
  value: number;
  /** True for an instantaneous count, false for a counter since boot. */
  gauge: boolean;
  unit: VmstatUnit;
}

/** What the fields worth explaining are. Anything absent is still listed. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  nr_free_pages: 'Pages on the free lists right now',
  nr_zone_inactive_anon: 'Anonymous pages in this zone the kernel would evict first',
  nr_zone_active_anon: 'Anonymous pages in this zone in recent use',
  nr_zone_inactive_file: 'Page cache in this zone the kernel would drop first',
  nr_zone_active_file: 'Page cache in this zone in recent use',
  nr_inactive_anon: 'Anonymous pages the kernel would swap out first',
  nr_active_anon: 'Anonymous pages in recent use',
  nr_inactive_file: 'Page cache the kernel would drop first',
  nr_active_file: 'Page cache in recent use',
  nr_unevictable: 'Pages that cannot be reclaimed at all, mostly mlocked ones',
  nr_mlock: 'Pages a process has locked into memory',
  nr_anon_pages: 'Anonymous memory: what processes allocated rather than read from a file',
  nr_mapped: 'Pages mapped into some process’s address space',
  nr_file_pages: 'Page cache, including shared memory and swap cache',
  nr_dirty: 'Pages changed since they were read, and not yet written back',
  nr_writeback: 'Pages being written back to disk at this moment',
  nr_dirty_threshold: 'Where the kernel starts forcing writers to write back themselves',
  nr_dirty_background_threshold: 'Where the kernel wakes its own writeback threads',
  nr_shmem: 'Shared memory and tmpfs pages',
  nr_slab_reclaimable: 'Kernel slab memory the kernel can give back under pressure',
  nr_slab_unreclaimable: 'Kernel slab memory it cannot',
  nr_kernel_stack: 'Kernel stacks, counted in kilobytes rather than in pages',
  nr_page_table_pages: 'Pages holding page tables — the cost of mapping everything else',
  nr_swapcached: 'Pages that are both in memory and already written to swap',
  nr_writeback_temp: 'Pages held by FUSE while it writes them back',
  nr_free_cma: 'Free pages inside CMA areas, lent out until a device wants them',
  nr_anon_transparent_hugepages: 'Anonymous transparent hugepages mapped right now',
  workingset_nodes: 'Shadow entries kept to remember what was evicted',
  pgpgin: 'Read from block devices since boot, in kilobytes — not pages',
  pgpgout: 'Written to block devices since boot, in kilobytes — not pages',
  pswpin: 'Pages read back from swap since boot',
  pswpout: 'Pages written to swap since boot',
  pgfault: 'Page faults of every kind, most of them served without touching a disk',
  pgmajfault: 'Faults that had to wait for a disk — the ones that cost real time',
  pgfree: 'Pages returned to the allocator',
  pgactivate: 'Pages promoted to the active list because they were used again',
  pgdeactivate: 'Pages demoted to the inactive list, next in line to be dropped',
  pgrefill: 'Pages examined while topping the active list back up',
  pgscan_kswapd: 'Pages examined by kswapd looking for something to reclaim',
  pgscan_direct: 'Pages examined by a process that had to reclaim before it could allocate',
  pgsteal_kswapd: 'Pages kswapd actually reclaimed',
  pgsteal_direct: 'Pages reclaimed by a process that was made to do it itself',
  pgscan_direct_throttle: 'Times a process was made to wait rather than reclaim — not a page count',
  pgrotated: 'Pages moved to the end of the inactive list after writeback',
  pageoutrun: 'Times kswapd woke up and did a pass',
  oom_kill: 'Processes the out-of-memory killer has killed',
  allocstall: 'Allocations that stalled to reclaim, on a kernel that counts them in one figure',
  workingset_refault_file: 'Page cache that was evicted and needed again — the cost of being short',
  workingset_refault_anon: 'Anonymous pages that were swapped out and needed again',
  workingset_activate_file: 'Refaulted cache promoted straight to the active list',
  workingset_restore_file: 'Refaults the kernel decided it should not have evicted',
  workingset_nodereclaim: 'Shadow entries thrown away because even they cost too much',
  numa_hit: 'Allocations satisfied on the node they asked for',
  numa_miss: 'Allocations that had to come from another node instead',
  numa_foreign: 'Allocations meant for this node that were satisfied elsewhere',
  numa_local: 'Allocations satisfied on the node the process was running on',
  numa_other: 'Allocations satisfied on some other node',
  numa_interleave: 'Allocations spread across nodes on purpose',
  numa_pte_updates: 'Mappings unmapped on purpose so the next fault reveals who uses them',
  numa_hint_faults: 'Faults taken to find out which node a page is really used from',
  numa_hint_faults_local: 'Of those, the ones that turned out to be local already',
  numa_pages_migrated: 'Pages moved to the node using them',
  pgmigrate_success: 'Pages successfully moved, by compaction or by the NUMA balancer',
  pgmigrate_fail: 'Pages that could not be moved, usually because something had them pinned',
  compact_stall: 'Times an allocation stopped to compact memory before it could proceed',
  compact_fail: 'Of those, the ones that still could not be satisfied',
  compact_success: 'Of those, the ones that could',
  compact_migrate_scanned: 'Pages examined looking for something movable',
  compact_free_scanned: 'Pages examined looking for somewhere to move it to',
  compact_daemon_wake: 'Times kcompactd woke to do this in the background instead',
  thp_fault_alloc: 'Hugepages allocated to serve a fault',
  thp_fault_fallback: 'Faults that wanted a hugepage and had to settle for small ones',
  thp_collapse_alloc: 'Hugepages khugepaged built out of small pages already in use',
  thp_split_page: 'Hugepages broken back up into small ones',
  thp_deferred_split_page: 'Hugepages queued to be broken up later',
  thp_zero_page_alloc: 'The shared zero hugepage, allocated once',
  htlb_buddy_alloc_success: 'Reserved hugepages the allocator managed to find',
  htlb_buddy_alloc_fail: 'Reserved hugepages it could not',
  unevictable_pgs_mlocked: 'Pages locked into memory since boot',
  unevictable_pgs_munlocked: 'Pages unlocked again',
  unevictable_pgs_culled: 'Pages moved off the reclaim lists because they cannot be reclaimed',
  drop_pagecache: 'Times something wrote to drop_caches to throw the page cache away',
  drop_slab: 'Times something wrote to drop_caches to throw reclaimable slab away',
  zswpin: 'Pages decompressed back out of zswap',
  zswpout: 'Pages compressed into zswap instead of being written to swap',
  swap_ra: 'Pages read from swap speculatively, in case they were wanted next',
  swap_ra_hit: 'Of those, the ones that were',
  balloon_inflate: 'Pages handed back to the hypervisor',
  balloon_deflate: 'Pages taken back from it',
  nr_unstable: 'Always zero on a modern kernel — NFS pages that were once counted here',
};

/** Families the counters fall into, in the order worth reading them. */
export const FAMILIES: readonly { id: string; label: string; test: RegExp }[] = [
  {
    id: 'paging',
    label: 'Paging and faults',
    test: /^(pgpgin|pgpgout|pswpin|pswpout|pgfault|pgmajfault|swpin_zero|swpout_zero)$/,
  },
  {
    id: 'allocation',
    label: 'Allocation',
    test: /^(pgalloc_|pgfree|pgskip_|pgreuse|allocstall)/,
  },
  {
    id: 'reclaim',
    label: 'Reclaim',
    test: /^(pgscan|pgsteal|pgrefill|pgactivate|pgdeactivate|pglazyfree|pgrotated|pgdemote|pgpromote|pageoutrun|kswapd_|slabs_scanned|pginodesteal|zone_reclaim_|nr_vmscan)/,
  },
  { id: 'workingset', label: 'The working set that came back', test: /^workingset_/ },
  { id: 'numa', label: 'NUMA allocation and balancing', test: /^(numa_|pgmigrate_)/ },
  { id: 'compaction', label: 'Compaction', test: /^compact_/ },
  { id: 'hugepages', label: 'Hugepages', test: /^(thp_|htlb_)/ },
  { id: 'unevictable', label: 'Unevictable pages', test: /^unevictable_pgs_/ },
  { id: 'swap', label: 'Swap and compression', test: /^(swap_ra|zswp|ksm_swpin|cow_ksm)/ },
  { id: 'other', label: 'Everything else', test: /.*/ },
];

const LINE = /^(\S+)\s+(-?\d+)$/;

/** Whether this field is a level rather than a total since boot. */
export function isGauge(name: string): boolean {
  return name.startsWith('nr_') || EXTRA_GAUGES.has(name);
}

/** What this field counts in. */
export function unitOf(name: string): VmstatUnit {
  if (KILOBYTE_FIELDS.has(name)) return 'kilobytes';
  if (PAGE_FIELDS.has(name)) return 'pages';
  return isGauge(name) ? 'pages' : 'events';
}

export function parseVmstat(text: string): VmstatField[] {
  const fields: VmstatField[] = [];

  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match === null) continue;

    const name = match[1]!;
    fields.push({
      name,
      value: Number(match[2]),
      gauge: isGauge(name),
      unit: unitOf(name),
    });
  }

  return fields;
}

/** What this field is, or null for one this page has no note for. */
export function describeField(name: string): string | null {
  return DESCRIPTIONS[name] ?? null;
}

/** One field's value, or null where this kernel does not print it. */
export function valueOf(fields: readonly VmstatField[], name: string): number | null {
  return fields.find((field) => field.name === name)?.value ?? null;
}

/**
 * Every matching field added up. The reclaim counters are read this way
 * because a 3.x kernel splits them per zone — `pgscan_kswapd_dma32` and the
 * rest — where a modern one prints a single `pgscan_kswapd`, and both should
 * come out as one figure. Fields in {@link NOT_PAGES_SCANNED} are left out:
 * `pgscan_direct_throttle` matches the prefix and counts something else.
 */
export function sumMatching(fields: readonly VmstatField[], pattern: RegExp): number {
  return fields
    .filter((field) => pattern.test(field.name) && !NOT_PAGES_SCANNED.has(field.name))
    .reduce((total, field) => total + field.value, 0);
}

/** Bytes a page count stands for, on the assumed page size. */
export function pagesToBytes(pages: number): number {
  return pages * PAGE_SIZE;
}

/** Bytes this field stands for, or null where it counts events. */
export function bytesOf(field: VmstatField): number | null {
  if (field.unit === 'pages') return pagesToBytes(field.value);
  if (field.unit === 'kilobytes') return field.value * 1024;
  return null;
}

/** The family a counter belongs to. */
export function familyOf(name: string): string {
  return FAMILIES.find((family) => family.test.test(name))!.id;
}

export interface ReclaimSummary {
  /** Pages examined by kswapd in the background. */
  scannedKswapd: number;
  /** Pages examined by a process that had to reclaim before it could allocate. */
  scannedDirect: number;
  stolenKswapd: number;
  stolenDirect: number;
  /**
   * Pages reclaimed per page examined, 0–1. Low means the kernel is walking a
   * long way for every page it gets back. Null when nothing has been scanned.
   */
  efficiency: number | null;
  /**
   * Share of scanning done by processes rather than by kswapd. Direct reclaim
   * is an allocation stalling to free memory itself, which is felt.
   */
  directShare: number | null;
  /** Allocations that stalled to reclaim, however this kernel counts them. */
  stalls: number;
}

export function reclaim(fields: readonly VmstatField[]): ReclaimSummary {
  const scannedKswapd = sumMatching(fields, /^pgscan_kswapd/);
  const scannedDirect = sumMatching(fields, /^pgscan_direct/);
  const stolenKswapd = sumMatching(fields, /^pgsteal_kswapd/);
  const stolenDirect = sumMatching(fields, /^pgsteal_direct/);

  const scanned = scannedKswapd + scannedDirect;
  const stolen = stolenKswapd + stolenDirect;

  return {
    scannedKswapd,
    scannedDirect,
    stolenKswapd,
    stolenDirect,
    efficiency: scanned === 0 ? null : Math.min(1, stolen / scanned),
    directShare: scanned === 0 ? null : scannedDirect / scanned,
    // A modern kernel splits this per zone; a 3.x one has a single field.
    stalls: sumMatching(fields, /^allocstall/),
  };
}

export interface NumaSummary {
  hit: number;
  miss: number;
  foreign: number;
  local: number;
  other: number;
  /** Share of allocations that had to come off another node. */
  missShare: number | null;
}

/** Null on a kernel with no NUMA counters at all. */
export function numa(fields: readonly VmstatField[]): NumaSummary | null {
  const hit = valueOf(fields, 'numa_hit');
  if (hit === null) return null;

  const miss = valueOf(fields, 'numa_miss') ?? 0;

  return {
    hit,
    miss,
    foreign: valueOf(fields, 'numa_foreign') ?? 0,
    local: valueOf(fields, 'numa_local') ?? 0,
    other: valueOf(fields, 'numa_other') ?? 0,
    missShare: hit + miss === 0 ? null : miss / (hit + miss),
  };
}

/** Past this, the kernel is walking a long way for every page it gets back. */
export const POOR_EFFICIENCY = 0.5;

export interface VmstatSummary {
  fields: number;
  gauges: VmstatField[];
  counters: VmstatField[];
  /** Free memory right now, in bytes. */
  freeBytes: number | null;
  /** Page cache right now, in bytes. */
  cacheBytes: number | null;
  /** Anonymous memory right now, in bytes. */
  anonBytes: number | null;
  dirtyBytes: number | null;
  reclaim: ReclaimSummary;
  numa: NumaSummary | null;
  majorFaults: number | null;
  faults: number | null;
  swapInPages: number | null;
  swapOutPages: number | null;
  /** Page cache and anonymous pages that had to be fetched back after eviction. */
  refaults: number;
  oomKills: number | null;
}

export function summarize(fields: readonly VmstatField[]): VmstatSummary {
  const pages = (name: string): number | null => {
    const value = valueOf(fields, name);
    return value === null ? null : pagesToBytes(value);
  };

  return {
    fields: fields.length,
    gauges: fields.filter((field) => field.gauge),
    counters: fields.filter((field) => !field.gauge),
    freeBytes: pages('nr_free_pages'),
    cacheBytes: pages('nr_file_pages'),
    anonBytes: pages('nr_anon_pages'),
    dirtyBytes: pages('nr_dirty'),
    reclaim: reclaim(fields),
    numa: numa(fields),
    majorFaults: valueOf(fields, 'pgmajfault'),
    faults: valueOf(fields, 'pgfault'),
    swapInPages: valueOf(fields, 'pswpin'),
    swapOutPages: valueOf(fields, 'pswpout'),
    refaults: sumMatching(fields, /^workingset_refault/),
    oomKills: valueOf(fields, 'oom_kill'),
  };
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** Binary units, since everything here is a count of pages underneath. */
export function formatBytes(value: number): string {
  if (value === 0) return '0 B';

  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}

/** `1.2M` — these counters reach the hundreds of millions. */
export function formatCount(value: number): string {
  const units = [
    { limit: 1e9, suffix: 'G' },
    { limit: 1e6, suffix: 'M' },
    { limit: 1e3, suffix: 'k' },
  ];

  for (const { limit, suffix } of units) {
    if (Math.abs(value) >= limit) return `${(value / limit).toFixed(1)}${suffix}`;
  }
  return String(value);
}

/** `81%`, and `<1%` for a share that is not quite nothing. */
export function formatShare(value: number): string {
  if (value === 0) return '0%';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
