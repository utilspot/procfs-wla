/**
 * Parser for `/proc/zoneinfo`.
 *
 * A block per memory zone, per NUMA node:
 *
 *   Node 0, zone   Normal
 *     per-node stats
 *         nr_active_anon 909239
 *         …
 *     pages free     16387
 *           min      11721
 *           low      14651
 *           high     17581
 *           spanned  2214400
 *           present  2214400
 *           managed  2146127
 *           protection: (0, 0, 0, 0, 0)
 *         nr_free_pages 16387
 *         …
 *     pagesets
 *       cpu: 0
 *                 count:    1827
 *     node_unreclaimable:  0
 *     start_pfn:           1048576
 *
 * Four things in here are easy to read wrong:
 *
 * - **The `per-node stats` block does not belong to the zone it is printed
 *   under.** Since 4.8 the reclaim lists live on the node rather than the
 *   zone, so those figures are printed once per node — under whichever zone
 *   comes first, which on most machines is the tiny `DMA` zone. Reading
 *   `nr_active_anon` there as the DMA zone's is out by orders of magnitude.
 *   {@link ZoneInfo} keeps them apart.
 * - **`spanned`, `present` and `managed` are three different numbers.**
 *   Spanned is the whole PFN range including holes, present is what is
 *   physically there, and managed is what the allocator actually got after
 *   firmware reservations and the memory map itself were taken out. The
 *   difference between the last two is where the "missing" RAM went. See
 *   {@link holePages} and {@link reservedPages}.
 * - **`free` against `min`, `low` and `high` is the state of the zone.**
 *   kswapd is woken when free falls below `low` and reclaims until `high`;
 *   below `min` an ordinary allocation has to stop and reclaim before it can
 *   proceed. See {@link watermarkState}.
 * - **`protection:` is the lowmem_reserve array**, not a total: entry *i* is
 *   how many pages of this zone the kernel will refuse to an allocation that
 *   could have come from zone *i* instead. It is why a zone with free pages
 *   can still turn an allocation down.
 *
 * Which keys appear depends on the kernel — `boost`, `promo` and `cma` are
 * recent, a kernel from before 4.8 has no per-node block at all and says
 * `all_unreclaimable` where a modern one says `node_unreclaimable` — so
 * nothing here assumes a fixed set.
 */

/**
 * Assumed page size, for turning these page counts into bytes. The file never
 * says how large a page is; 4 KiB holds on x86 and on ARM64 with the usual
 * granule, as assumed elsewhere in this app.
 */
export const PAGE_SIZE = 4096;

/** What the keys in the watermark block mean. */
export const PAGE_KEYS: Readonly<Record<string, string>> = {
  free: 'Pages on this zone’s free lists right now',
  boost: 'A temporary addition to the watermarks, to reclaim harder after a fragmenting allocation',
  min: 'Below this, an ordinary allocation must stop and reclaim before it can proceed',
  low: 'Below this, kswapd is woken to reclaim in the background',
  high: 'Where kswapd stops once it has been woken',
  promo: 'The watermark above which pages may be promoted to a faster node',
  spanned: 'Every page frame the zone covers, holes included',
  present: 'Page frames actually backed by memory',
  managed: 'What the allocator was left with after firmware reservations and the memory map',
  cma: 'Pages inside CMA areas, lent to movable allocations until a device wants them',
};

/** What the keys after the pagesets mean. */
export const TAIL_KEYS: Readonly<Record<string, string>> = {
  node_unreclaimable: 'Set when the node has been scanned without anything left to reclaim',
  all_unreclaimable: 'What node_unreclaimable was called before the LRU moved off the zones',
  start_pfn: 'The first page frame number in this zone',
  inactive_ratio: 'How much larger the active list may be than the inactive one',
  reserved_highatomic: 'Pageblocks held back for allocations that cannot wait',
  free_highatomic: 'How much of that reserve is still free',
};

export interface NamedValue {
  name: string;
  value: number;
}

/** One CPU's cache of pages, held off the buddy lists. */
export interface Pageset {
  cpu: number;
  fields: NamedValue[];
}

export interface Zone {
  node: number;
  /** `DMA`, `DMA32`, `Normal`, `Movable`, `Device`. */
  name: string;
  /** The watermark block: free, min, low, high, spanned, present, managed… */
  pages: NamedValue[];
  /** The lowmem_reserve array, indexed by the zone it protects against. */
  protection: number[];
  /** The `nr_zone_*` and `numa_*` counters that really are this zone's. */
  stats: NamedValue[];
  pagesets: Pageset[];
  /** `node_unreclaimable`, `start_pfn` and the rest after the pagesets. */
  tail: NamedValue[];
}

/** The `per-node stats` block, which is printed under a node's first zone. */
export interface NodeStats {
  node: number;
  /** The zone whose block it was printed under, which does not own it. */
  printedUnder: string;
  stats: NamedValue[];
}

export interface ZoneInfo {
  nodes: NodeStats[];
  zones: Zone[];
}

const ZONE = /^Node (\d+), zone\s+(\S+)$/;
const PROTECTION = /^protection:\s*\((.*)\)$/;
const CPU = /^cpu:\s*(\d+)$/;
const COLON_VALUE = /^([\w ]+):\s+(-?\d+)$/;
const PLAIN_VALUE = /^(\S+)\s+(-?\d+)$/;
/** `pages free 16387` opens the watermark block and is its first entry. */
const PAGES_FREE = /^pages free\s+(-?\d+)$/;

const TAIL_NAMES = new Set(Object.keys(TAIL_KEYS));

type State = 'zone' | 'node-stats' | 'watermarks' | 'zone-stats' | 'pagesets' | 'tail';

export function parseZoneInfo(text: string): ZoneInfo {
  const info: ZoneInfo = { nodes: [], zones: [] };

  let zone: Zone | null = null;
  let node: NodeStats | null = null;
  let pageset: Pageset | null = null;
  let state: State = 'zone';

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const header = ZONE.exec(trimmed);
    if (header !== null) {
      zone = {
        node: Number(header[1]),
        name: header[2]!,
        pages: [],
        protection: [],
        stats: [],
        pagesets: [],
        tail: [],
      };
      info.zones.push(zone);
      node = null;
      pageset = null;
      state = 'zone';
      continue;
    }

    if (zone === null) continue;

    if (trimmed === 'per-node stats') {
      node = { node: zone.node, printedUnder: zone.name, stats: [] };
      info.nodes.push(node);
      state = 'node-stats';
      continue;
    }

    // The watermark block opens with the one key that is two words.
    const free = PAGES_FREE.exec(trimmed);
    if (free !== null) {
      zone.pages.push({ name: 'free', value: Number(free[1]) });
      state = 'watermarks';
      continue;
    }

    const protection = PROTECTION.exec(trimmed);
    if (protection !== null) {
      zone.protection = (protection[1] ?? '')
        .split(',')
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isFinite(entry));
      // Everything after it belongs to the zone rather than the watermarks.
      state = 'zone-stats';
      continue;
    }

    if (trimmed === 'pagesets') {
      state = 'pagesets';
      continue;
    }

    const cpu = CPU.exec(trimmed);
    if (cpu !== null) {
      pageset = { cpu: Number(cpu[1]), fields: [] };
      zone.pagesets.push(pageset);
      state = 'pagesets';
      continue;
    }

    const colon = COLON_VALUE.exec(trimmed);
    if (colon !== null) {
      const name = colon[1]!.trim();
      const value = Number(colon[2]);

      // A tail key ends the pagesets wherever it turns up.
      if (TAIL_NAMES.has(name)) {
        zone.tail.push({ name, value });
        state = 'tail';
        continue;
      }
      if (state === 'pagesets' && pageset !== null) {
        pageset.fields.push({ name, value });
        continue;
      }
      zone.tail.push({ name, value });
      continue;
    }

    const plain = PLAIN_VALUE.exec(trimmed);
    if (plain === null) continue;

    const entry = { name: plain[1]!, value: Number(plain[2]) };
    if (state === 'node-stats' && node !== null) node.stats.push(entry);
    else if (state === 'watermarks') zone.pages.push(entry);
    else if (state === 'zone-stats') zone.stats.push(entry);
  }

  return info;
}

/** One value out of the watermark block, or null where it was not printed. */
export function pageValue(zone: Zone, name: string): number | null {
  return zone.pages.find((entry) => entry.name === name)?.value ?? null;
}

/** One of the zone's own counters, or null. */
export function statValue(zone: Zone, name: string): number | null {
  return zone.stats.find((entry) => entry.name === name)?.value ?? null;
}

/** What a watermark key means, or null for one this page has no note for. */
export function describePageKey(name: string): string | null {
  return PAGE_KEYS[name] ?? null;
}

/** What a tail key means, or null. */
export function describeTailKey(name: string): string | null {
  return TAIL_KEYS[name] ?? null;
}

/** Whether the zone exists on paper but has no memory in it. */
export function isEmpty(zone: Zone): boolean {
  return (pageValue(zone, 'present') ?? 0) === 0;
}

/** Page frames the zone covers that nothing is behind: spanned minus present. */
export function holePages(zone: Zone): number | null {
  const spanned = pageValue(zone, 'spanned');
  const present = pageValue(zone, 'present');
  if (spanned === null || present === null) return null;
  return Math.max(0, spanned - present);
}

/**
 * Pages that are there but the allocator never got: firmware reservations and
 * the memory map itself. This is where the RAM a machine seems to be missing
 * actually went.
 */
export function reservedPages(zone: Zone): number | null {
  const present = pageValue(zone, 'present');
  const managed = pageValue(zone, 'managed');
  if (present === null || managed === null) return null;
  return Math.max(0, present - managed);
}

export type WatermarkState = 'empty' | 'above-high' | 'below-high' | 'below-low' | 'below-min';

/** What each state of a zone means for anything trying to allocate from it. */
export const WATERMARK_STATES: Readonly<Record<WatermarkState, string>> = {
  empty: 'No memory in this zone at all — it exists on paper and nothing can come from it',
  'above-high': 'Above the high watermark: nothing is reclaiming on this zone’s account',
  'below-high': 'Between low and high — where kswapd keeps going once it has been woken',
  'below-low': 'Below the low watermark, which is what wakes kswapd to reclaim in the background',
  'below-min':
    'Below the min watermark: an ordinary allocation here has to stop and reclaim before it can proceed',
};

/**
 * Where the zone's free pages sit against its watermarks — which is the state
 * of the zone, and the thing this file is read for.
 */
export function watermarkState(zone: Zone): WatermarkState {
  if (isEmpty(zone)) return 'empty';

  const free = pageValue(zone, 'free') ?? 0;
  const min = pageValue(zone, 'min') ?? 0;
  const low = pageValue(zone, 'low') ?? 0;
  const high = pageValue(zone, 'high') ?? 0;

  if (free <= min) return 'below-min';
  if (free <= low) return 'below-low';
  if (free <= high) return 'below-high';
  return 'above-high';
}

/** Whether anything allocating from this zone is having to reclaim first. */
export function isStalling(zone: Zone): boolean {
  return watermarkState(zone) === 'below-min';
}

/** Pages this CPU is holding off the buddy lists. */
export function pagesetCount(pageset: Pageset): number {
  return pageset.fields.find((field) => field.name === 'count')?.value ?? 0;
}

/** Pages cached across every CPU's list for this zone. */
export function cachedPages(zone: Zone): number {
  return zone.pagesets.reduce((total, pageset) => total + pagesetCount(pageset), 0);
}

/** The zones belonging to one node, in the order the file printed them. */
export function zonesOfNode(info: ZoneInfo, node: number): Zone[] {
  return info.zones.filter((zone) => zone.node === node);
}

export interface ZoneInfoSummary {
  nodes: number[];
  zones: number;
  /** Zones with no memory in them at all. */
  empty: number;
  /** Pages the allocator has across every zone. */
  managedPages: number;
  freePages: number;
  /** Pages present but never handed to the allocator. */
  reservedPages: number;
  /** Page frames covered by no memory. */
  holePages: number;
  /** Pages held on the per-CPU lists rather than the buddy lists. */
  cachedPages: number;
  /** Zones where an allocation would have to reclaim before proceeding. */
  stalling: Zone[];
  /** Zones kswapd would be reclaiming from. */
  reclaiming: Zone[];
  /** Nodes the kernel has given up finding anything to reclaim on. */
  unreclaimable: number[];
  /** True where the file has no per-node block, as before 4.8. */
  perZoneLru: boolean;
}

export function summarize(info: ZoneInfo): ZoneInfoSummary {
  const sum = (read: (zone: Zone) => number | null): number =>
    info.zones.reduce((total, zone) => total + (read(zone) ?? 0), 0);

  const unreclaimable = info.zones
    .filter((zone) =>
      zone.tail.some(
        (entry) =>
          (entry.name === 'node_unreclaimable' || entry.name === 'all_unreclaimable') &&
          entry.value === 1,
      ),
    )
    .map((zone) => zone.node);

  return {
    nodes: Array.from(new Set(info.zones.map((zone) => zone.node))).sort((a, b) => a - b),
    zones: info.zones.length,
    empty: info.zones.filter(isEmpty).length,
    managedPages: sum((zone) => pageValue(zone, 'managed')),
    freePages: sum((zone) => pageValue(zone, 'free')),
    reservedPages: sum(reservedPages),
    holePages: sum(holePages),
    cachedPages: sum((zone) => cachedPages(zone)),
    stalling: info.zones.filter(isStalling),
    reclaiming: info.zones.filter((zone) => {
      const state = watermarkState(zone);
      return state === 'below-low' || state === 'below-high';
    }),
    unreclaimable: Array.from(new Set(unreclaimable)).sort((a, b) => a - b),
    perZoneLru: info.nodes.length === 0 && info.zones.length > 0,
  };
}

/** Bytes a page count stands for, on the assumed page size. */
export function pagesToBytes(pages: number): number {
  return pages * PAGE_SIZE;
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** Binary units, since every figure here is a count of pages. */
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

/** A page count as memory, which is what it means. */
export function formatPages(pages: number): string {
  return formatBytes(pagesToBytes(pages));
}
