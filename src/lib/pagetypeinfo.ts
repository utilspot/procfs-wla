/**
 * Parser for `/proc/pagetypeinfo`.
 *
 * `/proc/buddyinfo` split by **migrate type**, in two tables under a two-line
 * header:
 *
 *    Page block order: 9
 *    Pages per block:  512
 *
 *    Free pages count per migrate type at order    0    1    2 …
 *    Node    0, zone   Normal, type    Unmovable  904  612  388 …
 *    Node    0, zone   Normal, type      Movable 1204  988  754 …
 *
 *    Number of blocks type     Unmovable      Movable …
 *    Node 0, zone   Normal           204         6820 …
 *
 * The first table is free blocks per order, as in `/proc/buddyinfo`, so the
 * same warning applies: **a block of order N is 2^N pages**, and the columns
 * are not comparable as a histogram. See {@link pagesIn}.
 *
 * What this file adds is the migrate type, which is the kernel sorting free
 * memory by whether it could be moved if a large allocation needed the space:
 * see {@link MIGRATE_TYPES}. Movable memory is a user page the kernel can
 * relocate; unmovable is a kernel allocation that has to stay where it is.
 * Keeping them in separate pageblocks is what stops a machine fragmenting so
 * badly that no large allocation can be satisfied.
 *
 * The **second table** is the one that says how well that is going: a count of
 * whole pageblocks belonging to each type. Unmovable blocks growing at the
 * expense of movable ones is fragmentation that will not undo itself, since
 * the kernel cannot move what is in them.
 *
 * How many order columns there are depends on the kernel's MAX_ORDER, and the
 * pageblock order differs by architecture, so both are read rather than
 * assumed. A kernel built with `CONFIG_PAGE_OWNER` adds a third table, which
 * this parser passes over — the two above are what a machine without it has.
 */

/** What the kernel sorts free memory by, and what each kind means. */
export const MIGRATE_TYPES: Readonly<Record<string, string>> = {
  Unmovable: 'Kernel allocations, which cannot be relocated to make room for anything',
  Movable: 'User pages, which the kernel can move elsewhere when it needs the space',
  Reclaimable: 'Caches the kernel can throw away rather than move, such as inodes and dentries',
  HighAtomic: 'Blocks held back for allocations that cannot sleep or wait for reclaim',
  CMA: 'Reserved for contiguous allocations by devices, lent to movable pages until wanted',
  Isolate: 'Blocks temporarily fenced off, while memory is being compacted or taken offline',
};

/**
 * Assumed page size in bytes. This file counts pages and never says how large
 * one is; 4 KiB holds on x86 and on ARM64 with the usual 4K granule, and a
 * 64K-page kernel would put every byte figure here out by 16x. The same
 * assumption is made, for the same reason, in `buddyinfo.ts`.
 */
export const PAGE_SIZE = 4096;

export interface FreeRow {
  node: number;
  /** `DMA`, `DMA32`, `Normal`, `Movable`, `Device`. */
  zone: string;
  /** `Unmovable`, `Movable`, `Reclaimable`, `HighAtomic`, `CMA`, `Isolate`. */
  type: string;
  /** Free block counts, index `i` being the count at order `i`. */
  counts: number[];
}

export interface BlockRow {
  node: number;
  zone: string;
  /** Whole pageblocks owned by each type, keyed by type name. */
  blocks: Record<string, number>;
}

export interface PageTypeInfo {
  /** The order of a pageblock, which differs by architecture. */
  pageblockOrder: number | null;
  /** Pages in one pageblock — 2^pageblockOrder, and printed as well. */
  pagesPerBlock: number | null;
  /** Migrate type names from the second table's header, in the kernel's order. */
  types: string[];
  free: FreeRow[];
  blocks: BlockRow[];
}

const PAGEBLOCK_ORDER = /^Page block order:\s*(\d+)$/;
const PAGES_PER_BLOCK = /^Pages per block:\s*(\d+)$/;
const FREE_ROW = /^Node\s+(\d+),\s*zone\s+(\S+),\s*type\s+(\S+)\s+(.*)$/;
const BLOCK_HEADER = /^Number of blocks type\s+(.*)$/;
const BLOCK_ROW = /^Node\s+(\d+),\s*zone\s+(\S+)\s+(.*)$/;

/** Reads a run of counts, stopping at anything that is not one. */
function countsOf(text: string): number[] {
  const counts: number[] = [];

  for (const token of text.trim().split(/\s+/)) {
    const value = Number(token);
    // Stop rather than skip, so a stray token cannot shift the rest of the
    // row into the wrong orders.
    if (token === '' || !Number.isFinite(value)) break;
    counts.push(value);
  }

  return counts;
}

export function parsePageTypeInfo(text: string): PageTypeInfo {
  const info: PageTypeInfo = {
    pageblockOrder: null,
    pagesPerBlock: null,
    types: [],
    free: [],
    blocks: [],
  };
  let inBlocks = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const order = PAGEBLOCK_ORDER.exec(trimmed);
    if (order !== null) {
      info.pageblockOrder = Number(order[1]);
      continue;
    }

    const perBlock = PAGES_PER_BLOCK.exec(trimmed);
    if (perBlock !== null) {
      info.pagesPerBlock = Number(perBlock[1]);
      continue;
    }

    const blockHeader = BLOCK_HEADER.exec(trimmed);
    if (blockHeader !== null) {
      info.types = (blockHeader[1] ?? '').trim().split(/\s+/).filter((name) => name !== '');
      inBlocks = true;
      continue;
    }

    // A free row names its type, so it is unambiguous wherever it appears.
    const free = FREE_ROW.exec(trimmed);
    if (free !== null) {
      const counts = countsOf(free[4] ?? '');
      if (counts.length === 0) continue;

      info.free.push({
        node: Number(free[1]),
        zone: free[2] ?? '',
        type: free[3] ?? '',
        counts,
      });
      continue;
    }

    // A row with no type belongs to the block table, which is the only one
    // shaped that way — and only after its header has been seen.
    const block = BLOCK_ROW.exec(trimmed);
    if (block !== null && inBlocks) {
      const counts = countsOf(block[3] ?? '');
      if (counts.length === 0) continue;

      info.blocks.push({
        node: Number(block[1]),
        zone: block[2] ?? '',
        blocks: Object.fromEntries(
          info.types.map((type, index) => [type, counts[index] ?? 0]),
        ),
      });
    }
  }

  // Without the second table's header there is nothing to name the columns,
  // so the types are taken from the rows that did name themselves.
  if (info.types.length === 0) {
    info.types = Array.from(new Set(info.free.map((row) => row.type)));
  }

  return info;
}

/** What a migrate type means, or null for one this table has no note for. */
export function describeType(type: string): string | null {
  return MIGRATE_TYPES[type] ?? null;
}

/** Pages in a block of this order: 2^order. */
export function pagesIn(order: number): number {
  return 2 ** order;
}

/** Bytes in a block of this order, on the assumed page size. */
export function bytesIn(order: number): number {
  return pagesIn(order) * PAGE_SIZE;
}

/**
 * Free pages the row holds, weighting each order by what a block at that order
 * is actually worth. Reading the counts unweighted gets free memory backwards.
 */
export function pagesOf(row: FreeRow): number {
  return row.counts.reduce((total, count, order) => total + count * pagesIn(order), 0);
}

/** Free bytes the row holds, on the assumed page size. */
export function bytesOf(row: FreeRow): number {
  return pagesOf(row) * PAGE_SIZE;
}

/**
 * The largest order this row still has a block at, which is the largest
 * contiguous allocation it can satisfy of that type without compaction. Null
 * when the row holds nothing at all.
 */
export function largestOrder(row: FreeRow): number | null {
  for (let order = row.counts.length - 1; order >= 0; order -= 1) {
    if ((row.counts[order] ?? 0) > 0) return order;
  }
  return null;
}

/** A zone, and every migrate type's row within it. */
export interface ZoneRows {
  node: number;
  zone: string;
  rows: FreeRow[];
  blocks: BlockRow | null;
}

/** The free rows grouped by the zone they belong to, in the file's order. */
export function zones(info: PageTypeInfo): ZoneRows[] {
  const grouped = new Map<string, ZoneRows>();

  for (const row of info.free) {
    const key = `${row.node}/${row.zone}`;
    const existing = grouped.get(key);

    if (existing === undefined) {
      grouped.set(key, {
        node: row.node,
        zone: row.zone,
        rows: [row],
        blocks:
          info.blocks.find((block) => block.node === row.node && block.zone === row.zone) ?? null,
      });
    } else {
      existing.rows.push(row);
    }
  }

  return Array.from(grouped.values());
}

/** Pageblocks a zone holds altogether, across every type. */
export function totalBlocks(row: BlockRow): number {
  return Object.values(row.blocks).reduce((total, count) => total + count, 0);
}

/**
 * Share of a zone's pageblocks belonging to one type. Null when the zone owns
 * no blocks at all, which would divide by zero.
 */
export function blockShare(row: BlockRow, type: string): number | null {
  const total = totalBlocks(row);
  return total === 0 ? null : (row.blocks[type] ?? 0) / total;
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

export interface TypeTotal {
  type: string;
  pages: number;
  bytes: number;
}

export interface PageTypeSummary {
  nodes: number;
  zones: number;
  /** Orders the file printed, which is the kernel's MAX_ORDER. */
  orders: number;
  pageblockOrder: number | null;
  pageblockBytes: number | null;
  /** Free memory by migrate type, across every zone, largest first. */
  totals: TypeTotal[];
  totalBytes: number;
  /** Zones with nothing free at or above the pageblock order. */
  fragmented: ZoneRows[];
}

/**
 * Whether the zone has any free block as large as a pageblock. Below that, the
 * kernel cannot hand out a huge page without compacting first — which is the
 * question this file exists to answer.
 */
export function hasWholeBlock(zone: ZoneRows, pageblockOrder: number | null): boolean {
  if (pageblockOrder === null) return true;
  return zone.rows.some((row) => (largestOrder(row) ?? -1) >= pageblockOrder);
}

export function summarize(info: PageTypeInfo): PageTypeSummary {
  const grouped = zones(info);
  const byType = new Map<string, number>();

  for (const row of info.free) {
    byType.set(row.type, (byType.get(row.type) ?? 0) + pagesOf(row));
  }

  const totals = Array.from(byType, ([type, pages]) => ({
    type,
    pages,
    bytes: pages * PAGE_SIZE,
  })).sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type));

  return {
    nodes: new Set(info.free.map((row) => row.node)).size,
    zones: grouped.length,
    orders: Math.max(0, ...info.free.map((row) => row.counts.length)),
    pageblockOrder: info.pageblockOrder,
    pageblockBytes: info.pageblockOrder === null ? null : bytesIn(info.pageblockOrder),
    totals,
    totalBytes: totals.reduce((total, entry) => total + entry.bytes, 0),
    fragmented: grouped.filter((zone) => !hasWholeBlock(zone, info.pageblockOrder)),
  };
}
