/**
 * Parser for `/proc/slabinfo`.
 *
 * The kernel's slab allocator, one line per cache, behind a version line and a
 * column comment:
 *
 *   slabinfo - version: 2.1
 *   # name            <active_objs> <num_objs> <objsize> <objperslab> <pagesperslab> : tunables …
 *   dentry            182931 183120    192   21    1 : tunables    0    0    0 : slabdata   8720   8720      0
 *
 * Each line is six fields, then two `:`-introduced groups — `tunables` and
 * `slabdata`. The groups are what makes this awkward to split naively: a cache
 * name never contains a colon, but the counts have to be read *between* the
 * colons rather than by position from the end, because a kernel built without
 * the SLAB allocator's tunables still prints the group with zeroes, and older
 * files may omit a group entirely.
 *
 * A cache's memory is `num_slabs × pagesperslab × PAGE_SIZE`; the objects
 * actually in use account for `active_objs × objsize` of it, and the difference
 * is the allocator holding pages it has not handed back. Neither PAGE_SIZE nor
 * the allocator in use appears in the file — see {@link PAGE_SIZE}.
 *
 * Note that on a modern kernel this file is readable by root only, so a
 * backend running unprivileged may see it empty rather than forbidden.
 */

/**
 * Assumed page size in bytes. `/proc/slabinfo` reports pages, not bytes, and
 * says nothing about how big a page is; 4 KiB is right on x86 and on ARM64
 * with the usual 4K granule, but not on a 64K-page kernel, where every byte
 * figure here is out by 16×.
 */
export const PAGE_SIZE = 4096;

export interface Tunables {
  limit: number;
  batchCount: number;
  sharedFactor: number;
}

export interface SlabData {
  activeSlabs: number;
  numSlabs: number;
  sharedAvail: number;
}

export interface Slab {
  name: string;
  /** Objects in use. */
  activeObjs: number;
  /** Objects the cache has room for across the slabs it holds. */
  numObjs: number;
  /** Size of one object, in bytes. */
  objSize: number;
  objPerSlab: number;
  pagesPerSlab: number;
  /** Absent when the file did not carry the group. */
  tunables: Tunables | null;
  slabData: SlabData | null;
}

export interface SlabInfo {
  /** The `slabinfo - version: 2.1` line, when there was one. */
  version: string | null;
  slabs: Slab[];
}

const VERSION = /^slabinfo\s*-\s*version:\s*(\S+)/i;

/** Splits a line into the leading fields and each `: <group>` that follows. */
function sections(line: string): string[][] {
  return line
    .split(':')
    .map((section) => section.trim().split(/\s+/).filter((token) => token !== ''));
}

function numbers(tokens: readonly string[], from: number): number[] {
  const values: number[] = [];
  for (const token of tokens.slice(from)) {
    const value = Number(token);
    if (!Number.isFinite(value)) break;
    values.push(value);
  }
  return values;
}

function parseLine(line: string): Slab | null {
  const [head, ...groups] = sections(line);
  if (head === undefined || head.length < 6) return null;

  const name = head[0]!;
  const counts = numbers(head, 1);
  if (counts.length < 5) return null;

  // Each group leads with its own name — `tunables 0 0 0` — so the numbers
  // start one token in.
  const group = (label: string): number[] | null => {
    const found = groups.find((tokens) => tokens[0] === label);
    return found === undefined ? null : numbers(found, 1);
  };

  const tunables = group('tunables');
  const slabData = group('slabdata');

  return {
    name,
    activeObjs: counts[0]!,
    numObjs: counts[1]!,
    objSize: counts[2]!,
    objPerSlab: counts[3]!,
    pagesPerSlab: counts[4]!,
    tunables:
      tunables === null || tunables.length < 3
        ? null
        : { limit: tunables[0]!, batchCount: tunables[1]!, sharedFactor: tunables[2]! },
    slabData:
      slabData === null || slabData.length < 3
        ? null
        : { activeSlabs: slabData[0]!, numSlabs: slabData[1]!, sharedAvail: slabData[2]! },
  };
}

export function parseSlabInfo(text: string): SlabInfo {
  const slabs: Slab[] = [];
  let version: string | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const match = VERSION.exec(trimmed);
    if (match !== null) {
      version = match[1] ?? null;
      continue;
    }
    // The `# name <active_objs> …` column legend.
    if (trimmed.startsWith('#')) continue;

    const slab = parseLine(trimmed);
    if (slab !== null) slabs.push(slab);
  }

  return { version, slabs };
}

/**
 * Memory the cache holds, from the slabs it owns rather than the objects in
 * them — this is what the allocator has taken from the page allocator.
 */
export function bytes(slab: Slab): number {
  const slabs = slab.slabData?.numSlabs ?? 0;
  return slabs * slab.pagesPerSlab * PAGE_SIZE;
}

/** Memory the objects in use account for. */
export function activeBytes(slab: Slab): number {
  return slab.activeObjs * slab.objSize;
}

/** Share of the cache's objects that are in use, 0–1. */
export function utilization(slab: Slab): number {
  return slab.numObjs === 0 ? 0 : slab.activeObjs / slab.numObjs;
}

export interface SlabSummary {
  caches: number;
  /** Caches holding no objects at all. */
  empty: number;
  totalBytes: number;
  activeBytes: number;
  activeObjs: number;
  numObjs: number;
  /** Caches by memory held, largest first. */
  largest: Slab[];
}

export function summarize(info: SlabInfo): SlabSummary {
  const { slabs } = info;

  return {
    caches: slabs.length,
    empty: slabs.filter((slab) => slab.numObjs === 0).length,
    totalBytes: slabs.reduce((sum, slab) => sum + bytes(slab), 0),
    activeBytes: slabs.reduce((sum, slab) => sum + activeBytes(slab), 0),
    activeObjs: slabs.reduce((sum, slab) => sum + slab.activeObjs, 0),
    numObjs: slabs.reduce((sum, slab) => sum + slab.numObjs, 0),
    largest: [...slabs].sort((a, b) => bytes(b) - bytes(a) || a.name.localeCompare(b.name)),
  };
}

/**
 * A cache worth a second look: it holds a meaningful amount of memory and most
 * of its objects are free, so the allocator is sitting on pages. Small caches
 * are ignored, since a mostly-free 8 KiB cache is not interesting.
 */
export function isUnderused(slab: Slab, floor = 512 * 1024): boolean {
  return bytes(slab) >= floor && slab.numObjs > 0 && utilization(slab) < 0.5;
}

/** `1.2 MiB` — sizes in this file span bytes to gigabytes. */
export function formatBytes(value: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? size : size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}
