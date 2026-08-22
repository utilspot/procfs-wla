/**
 * Parser for `/proc/meminfo`.
 *
 * A field per line, name then value, and **usually** a unit:
 *
 *    MemTotal:       16316776 kB
 *    HugePages_Total:       0
 *
 * Two things about those units matter more than anything else in the file.
 *
 * The unit written `kB` is **KiB**: the kernel shifts a page count into units
 * of 1024 bytes and then labels it with the SI symbol for 1000. Every size
 * here is a multiple of 1024, so {@link bytesOf} multiplies by that and the
 * page shows real sizes rather than repeating the label.
 *
 * And a handful of fields carry **no unit at all** — the `HugePages_*` ones
 * are counts of pages, not sizes. Reading `HugePages_Total: 32768` as 32768 kB
 * would be wrong by whatever `Hugepagesize` happens to be, which is the point
 * of {@link MemField.unit} being null rather than assumed.
 *
 * Which fields appear depends on the kernel version and the configuration —
 * `MemAvailable` arrived in 3.14, `KReclaimable` much later, and a 32-bit
 * kernel adds the HighMem and LowMem split. Nothing here requires a field to
 * be present: everything derived returns null when what it needs is missing.
 */

/** What the kernel prints for a size, meaning 1024 bytes rather than 1000. */
export const KB = 'kB';

/** What the well-known fields mean. Anything absent is still shown, unexplained. */
export const FIELDS: Readonly<Record<string, string>> = {
  MemTotal: 'Memory the kernel has to hand out, after the firmware and the kernel image',
  MemFree: 'Memory holding nothing at all — not the same as memory available',
  MemAvailable:
    'The kernel’s own estimate of what a new program could get without swapping. Not a sum of other fields',
  Buffers: 'Page cache for block devices themselves — metadata rather than file contents',
  Cached: 'File contents held in the page cache, including tmpfs, which cannot simply be dropped',
  SwapCached: 'Pages that are both in swap and in memory, so swapping them out again is free',
  Active: 'Recently used, and not the first thing the kernel will reclaim',
  Inactive: 'Not used recently, and the first place the kernel looks when it needs memory',
  Unevictable: 'Pages that cannot be reclaimed at all, such as those locked by mlock',
  Mlocked: 'Pages a program has asked the kernel never to swap out',
  SwapTotal: 'Swap space configured, across every device and file',
  SwapFree: 'Swap holding nothing',
  Dirty: 'Written by a program and not yet on disk',
  Writeback: 'Being written back to disk at this moment',
  AnonPages: 'Memory belonging to programs rather than to files — heaps and stacks',
  Mapped: 'Files mapped into a process, including every program’s own code',
  Shmem: 'tmpfs and shared memory. Counted inside Cached, and not reclaimable by dropping caches',
  KReclaimable: 'Kernel memory the kernel could give back under pressure, slab and otherwise',
  Slab: 'Kernel data structures: SReclaimable plus SUnreclaim',
  SReclaimable: 'Slab the kernel can give back — mostly caches of directory entries and inodes',
  SUnreclaim: 'Slab the kernel cannot give back while it is in use',
  KernelStack: 'Kernel stacks, one per thread on the machine',
  PageTables: 'The tables mapping virtual addresses to physical ones',
  CommitLimit: 'How much the kernel will promise, when strict overcommit accounting is on',
  Committed_AS:
    'How much has been promised. It may exceed the limit, which only matters under strict overcommit',
  VmallocTotal: 'The size of the kernel’s virtual address space for vmalloc, not memory in use',
  VmallocUsed: 'Kernel memory allocated through vmalloc',
  HugePages_Total: 'Huge pages reserved. A count of pages, not a size',
  HugePages_Free: 'Reserved huge pages nothing is using yet. A count',
  HugePages_Rsvd: 'Huge pages promised but not yet touched. A count',
  HugePages_Surp: 'Huge pages beyond the configured pool. A count',
  Hugepagesize: 'How large one huge page is on this machine',
  Hugetlb: 'Memory held by the huge page pool altogether',
  HighTotal: 'On a 32-bit kernel, memory above what it can map directly',
  HighFree: 'Free memory in the high zone',
  LowTotal: 'Memory the kernel can map directly, and the only place its own structures live',
  LowFree: 'Free memory in the low zone',
  DirectMap4k: 'Kernel address space mapped with ordinary pages',
  DirectMap2M: 'Kernel address space mapped with 2 MiB pages',
  DirectMap1G: 'Kernel address space mapped with 1 GiB pages',
};

export interface MemField {
  name: string;
  /** The number as printed, in whatever unit the line carried. */
  value: number;
  /** `kB`, or null for a field that is a count rather than a size. */
  unit: string | null;
}

export interface MeminfoInfo {
  /** Fields in the order the kernel printed them. */
  fields: MemField[];
}

/** `MemTotal:       16316776 kB` and `HugePages_Total:       0` */
const LINE = /^(\S+):\s+(\d+)(?:\s+(\S+))?\s*$/;

export function parseMeminfo(text: string): MeminfoInfo {
  const fields: MemField[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = LINE.exec(line);
    if (match === null) continue;

    fields.push({
      name: match[1] ?? '',
      value: Number(match[2]),
      unit: match[3] ?? null,
    });
  }

  return { fields };
}

/** What a field means, or null for one this table has no note for. */
export function describeField(name: string): string | null {
  return FIELDS[name] ?? null;
}

/** The field by name, or null when this kernel did not print it. */
export function fieldOf(info: MeminfoInfo, name: string): MemField | null {
  return info.fields.find((field) => field.name === name) ?? null;
}

/**
 * A field in bytes. Null when the field is missing, and null when it carries
 * no unit — a count of huge pages is not a quantity of memory, and turning one
 * into bytes would invent a number.
 */
export function bytesOf(info: MeminfoInfo, name: string): number | null {
  const field = fieldOf(info, name);
  if (field === null || field.unit === null) return null;

  // The kernel writes kB and means KiB.
  return field.value * 1024;
}

/** A count, for the fields that are counts. Null when the field is a size. */
export function countOf(info: MeminfoInfo, name: string): number | null {
  const field = fieldOf(info, name);
  return field === null || field.unit !== null ? null : field.value;
}

/** Whether the field is a count of pages rather than an amount of memory. */
export function isCount(field: MemField): boolean {
  return field.unit === null;
}

export interface MemoryTotals {
  total: number | null;
  free: number | null;
  /** The kernel's estimate. Absent before Linux 3.14. */
  available: number | null;
  buffers: number | null;
  cached: number | null;
  /** Buffers, page cache and the slab the kernel could give back. */
  buffersAndCache: number | null;
  /**
   * What `free(1)` calls used: everything that is neither free nor cache.
   * This is arithmetic over the other fields, not something the kernel says.
   */
  used: number | null;
  swapTotal: number | null;
  swapFree: number | null;
  swapUsed: number | null;
}

export function totals(info: MeminfoInfo): MemoryTotals {
  const total = bytesOf(info, 'MemTotal');
  const free = bytesOf(info, 'MemFree');
  const buffers = bytesOf(info, 'Buffers');
  const cached = bytesOf(info, 'Cached');
  const reclaimable = bytesOf(info, 'SReclaimable');
  const swapTotal = bytesOf(info, 'SwapTotal');
  const swapFree = bytesOf(info, 'SwapFree');

  const buffersAndCache =
    buffers === null && cached === null
      ? null
      : (buffers ?? 0) + (cached ?? 0) + (reclaimable ?? 0);

  return {
    total,
    free,
    available: bytesOf(info, 'MemAvailable'),
    buffers,
    cached,
    buffersAndCache,
    used:
      total === null || free === null || buffersAndCache === null
        ? null
        : Math.max(0, total - free - buffersAndCache),
    swapTotal,
    swapFree,
    swapUsed: swapTotal === null || swapFree === null ? null : swapTotal - swapFree,
  };
}

export interface HugePages {
  /** Pages reserved, as a count. */
  total: number;
  free: number | null;
  /** One page's size in bytes, when the kernel said. */
  pageBytes: number | null;
  /** The pool altogether, from the count and the size. */
  poolBytes: number | null;
}

/**
 * The huge page pool, or null when this kernel reserves none. The count and
 * the size are separate fields, and only together do they mean an amount of
 * memory.
 */
export function hugePages(info: MeminfoInfo): HugePages | null {
  const total = countOf(info, 'HugePages_Total');
  if (total === null || total === 0) return null;

  const pageBytes = bytesOf(info, 'Hugepagesize');

  return {
    total,
    free: countOf(info, 'HugePages_Free'),
    pageBytes,
    poolBytes: pageBytes === null ? null : total * pageBytes,
  };
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** Binary units, since every size in this file is one. */
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

/** A share of the total, or null when either side is missing. */
export function shareOf(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole === 0) return null;
  return part / whole;
}

export interface MeminfoSummary {
  fields: number;
  totals: MemoryTotals;
  hugePages: HugePages | null;
  /** Share of memory in use by free(1)'s reckoning. */
  usedShare: number | null;
  /** Share the kernel reckons a new program could still get. */
  availableShare: number | null;
  swapShare: number | null;
}

export function summarize(info: MeminfoInfo): MeminfoSummary {
  const memory = totals(info);

  return {
    fields: info.fields.length,
    totals: memory,
    hugePages: hugePages(info),
    usedShare: shareOf(memory.used, memory.total),
    availableShare: shareOf(memory.available, memory.total),
    swapShare: shareOf(memory.swapUsed, memory.swapTotal),
  };
}
