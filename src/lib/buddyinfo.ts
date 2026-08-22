/**
 * Parser for `/proc/buddyinfo`.
 *
 * One line per memory zone, listing how many free blocks the buddy allocator
 * holds at each order:
 *
 *   Node 0, zone      DMA      1      1      1      0      2      1      1      0      1      1      3
 *   Node 0, zone    DMA32   1908   1859   1537   1187    834    534    293    134     56     23    114
 *   Node 0, zone   Normal  16375  13984   9451   5678   2894   1231    512    198     67     21      3
 *
 * The columns are orders 0, 1, 2, … and **a block of order N is 2^N pages**, so
 * the counts are not comparable across columns: one order-10 block is 1024
 * order-0 pages. Reading the row as a plain histogram gets the shape of free
 * memory backwards, which is why {@link distribution} weights each order by
 * what it is actually worth.
 *
 * That weighting is the point of the file. The highest order still holding a
 * block is the largest contiguous allocation the zone can satisfy without
 * compaction — a zone with thousands of order-0 pages and nothing above order 3
 * has plenty of free memory and cannot hand out a 1 MiB buffer.
 *
 * How many columns there are depends on the kernel's MAX_ORDER, so the count is
 * read from the file rather than assumed.
 */

/**
 * Assumed page size in bytes. `/proc/buddyinfo` counts pages and says nothing
 * about how big one is; 4 KiB is right on x86 and on ARM64 with the usual 4K
 * granule, but not on a 64K-page kernel, where every byte figure is out by 16x.
 */
export const PAGE_SIZE = 4096;

export interface Zone {
  node: number;
  /** `DMA`, `DMA32`, `Normal`, `Movable`, `Device`. */
  zone: string;
  /** Free block counts, index `i` holding the count for order `i`. */
  counts: number[];
}

const LINE = /^Node\s+(\d+),\s*zone\s+(\S+)\s+(.*)$/;

export function parseBuddyInfo(text: string): Zone[] {
  const zones: Zone[] = [];

  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match === null) continue;

    const counts: number[] = [];
    for (const token of (match[3] ?? '').trim().split(/\s+/)) {
      const value = Number(token);
      // Stop at the first non-number rather than skipping it, so a stray token
      // cannot shift the remaining counts into the wrong orders.
      if (token === '' || !Number.isFinite(value)) break;
      counts.push(value);
    }

    if (counts.length === 0) continue;
    zones.push({ node: Number(match[1]), zone: match[2]!, counts });
  }

  return zones;
}

/** Bytes in one block of this order: 2^order pages. */
export function blockBytes(order: number): number {
  return 2 ** order * PAGE_SIZE;
}

/** Free memory the zone holds, counting each order at what it is worth. */
export function freeBytes(zone: Zone): number {
  return zone.counts.reduce((total, count, order) => total + count * blockBytes(order), 0);
}

/**
 * The highest order still holding a free block — the largest contiguous
 * allocation this zone can satisfy. Null when the zone has nothing free.
 */
export function largestOrder(zone: Zone): number | null {
  for (let order = zone.counts.length - 1; order >= 0; order--) {
    if ((zone.counts[order] ?? 0) > 0) return order;
  }
  return null;
}

/** Bytes in the largest block the zone can still hand out. */
export function largestBlockBytes(zone: Zone): number | null {
  const order = largestOrder(zone);
  return order === null ? null : blockBytes(order);
}

export interface OrderShare {
  order: number;
  count: number;
  /** Memory held at this order, i.e. `count * 2^order * PAGE_SIZE`. */
  bytes: number;
  /** Share of the zone's free memory, 0–1. */
  share: number;
}

/**
 * The zone's free memory broken down by order and weighted by size, which is
 * the only way the row means anything: the count alone says nothing about how
 * much memory an order holds.
 */
export function distribution(zone: Zone): OrderShare[] {
  const total = freeBytes(zone);

  return zone.counts.map((count, order) => {
    const bytes = count * blockBytes(order);
    return { order, count, bytes, share: total === 0 ? 0 : bytes / total };
  });
}

/**
 * Whether the zone looks fragmented: it holds a useful amount of memory but
 * cannot satisfy a reasonably large contiguous request.
 *
 * A hint for reading the table rather than a verdict — a zone can be short of
 * high-order blocks for perfectly ordinary reasons, and the kernel will compact
 * on demand. `order` defaults to 4, a 64 KiB block on a 4 KiB-page machine.
 */
export function looksFragmented(zone: Zone, order = 4, floor = 16 * 1024 * 1024): boolean {
  const largest = largestOrder(zone);
  return freeBytes(zone) >= floor && (largest === null || largest < order);
}

export interface BuddySummary {
  nodes: number;
  zones: number;
  /** Columns the file carried, i.e. the kernel's MAX_ORDER. */
  orders: number;
  totalBytes: number;
  /** Largest contiguous block anywhere on the machine. */
  largestBlockBytes: number | null;
  /** Zones that hold memory but cannot satisfy a large request. */
  fragmented: Zone[];
  /** Zones by free memory, largest first. */
  largest: Zone[];
}

export function summarize(zones: readonly Zone[]): BuddySummary {
  const blocks = zones.map(largestBlockBytes).filter((bytes): bytes is number => bytes !== null);

  return {
    nodes: new Set(zones.map((zone) => zone.node)).size,
    zones: zones.length,
    orders: Math.max(0, ...zones.map((zone) => zone.counts.length)),
    totalBytes: zones.reduce((total, zone) => total + freeBytes(zone), 0),
    largestBlockBytes: blocks.length === 0 ? null : Math.max(...blocks),
    fragmented: zones.filter((zone) => looksFragmented(zone)),
    largest: [...zones].sort(
      (a, b) => freeBytes(b) - freeBytes(a) || a.zone.localeCompare(b.zone),
    ),
  };
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** Binary units, since these are page counts rather than disk capacities. */
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
