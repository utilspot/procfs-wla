/**
 * Parser for `/proc/swaps`.
 *
 * A header and a line per active swap area:
 *
 *   Filename                                Type            Size    Used    Priority
 *   /dev/nvme0n1p3                          partition       8388604 1743872 -2
 *   /swapfile                               file            2097148 1884416 -3
 *
 * Five fields, and three of them are not what they look like:
 *
 * - **Size and Used are KiB**, with no unit printed to say so, and both are
 *   the area's own accounting rather than the file or partition's size. Size
 *   is a page short of the real thing — the first page holds the swap header,
 *   which is why an 8 GiB file reports 8388604 KiB rather than 8388608. See
 *   {@link HEADER_PAGE_KIB}.
 * - **Used counts allocated slots, not pages that are only on disk.** A page
 *   swapped back in keeps its slot until something frees the entry, so this
 *   figure includes pages that are in memory again.
 * - **Priority is used highest-first**, and a negative one was assigned by the
 *   kernel rather than asked for: it counts downwards as each area is swapped
 *   on, so the negatives read as the order they were added. Areas sharing a
 *   priority are used **round-robin**, which is the only way to stripe swap
 *   across two devices. See {@link priorityGroups}.
 *
 * The filename is escaped the way `/proc/mounts` escapes its paths — space,
 * tab, newline and backslash as octal — so a swap file at a path with a space
 * in it arrives as `/mnt/data/swap\040file`. Splitting the line on whitespace
 * is safe precisely because of that escaping.
 *
 * A file with the header and nothing under it is a machine with no swap, which
 * is ordinary rather than broken; a file without even the header is not this
 * file. {@link Swaps} keeps the two apart.
 */

export type SwapType = 'partition' | 'file';

export interface SwapArea {
  /** The path, with the kernel's octal escapes undone. */
  filename: string;
  /** `partition` for a block device, `file` for a swap file. */
  type: SwapType | string;
  /** The area's usable size in KiB — a page less than what backs it. */
  sizeKib: number;
  /** Slots in use, in KiB. Includes slots held for pages back in memory. */
  usedKib: number;
  /** Higher is used first. A negative one was the kernel's own choice. */
  priority: number;
}

export interface Swaps {
  /** Whether the file's header line was there, which says it is this file. */
  header: boolean;
  areas: SwapArea[];
}

/**
 * The swap header takes the area's first page, so Size is that much less than
 * the file or partition it came from. 4 KiB is assumed, as elsewhere in this
 * app; a 64K-page kernel loses that much more.
 */
export const HEADER_PAGE_KIB = 4;

const ESCAPES: Record<string, string> = {
  '040': ' ',
  '011': '\t',
  '012': '\n',
  '134': '\\',
};

/** Turns the kernel's octal escapes back into the characters they stand for. */
export function unescapePath(value: string): string {
  return value.replace(/\\(\d{3})/g, (match, octal: string) => ESCAPES[octal] ?? match);
}

export function parseSwaps(text: string): Swaps {
  const swaps: Swaps = { header: false, areas: [] };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    if (trimmed.startsWith('Filename')) {
      swaps.header = true;
      continue;
    }

    const [filename, type, size, used, priority] = trimmed.split(/\s+/);
    // Every field is printed for every area, so a short line is not one.
    if (filename === undefined || type === undefined) continue;
    if (!/^\d+$/.test(size ?? '') || !/^\d+$/.test(used ?? '')) continue;

    swaps.areas.push({
      filename: unescapePath(filename),
      type,
      sizeKib: Number(size),
      usedKib: Number(used),
      // An area always has a priority, but do not invent a zero — which would
      // read as a deliberate one — if a kernel ever leaves it off.
      priority: /^-?\d+$/.test(priority ?? '') ? Number(priority) : 0,
    });
  }

  return swaps;
}

/** Slots still free in this area, in KiB. */
export function freeKib(area: SwapArea): number {
  return Math.max(0, area.sizeKib - area.usedKib);
}

/** How much of this area is spoken for, 0–1. */
export function usedShare(area: SwapArea): number {
  return area.sizeKib === 0 ? 0 : area.usedKib / area.sizeKib;
}

/**
 * Whether the kernel picked this priority rather than being told one. It
 * counts downwards from area to area, so the negatives are the order they were
 * swapped on rather than a ranking anyone chose.
 */
export function isAutoPriority(area: SwapArea): boolean {
  return area.priority < 0;
}

/** A zram device: swap into compressed RAM, which is not a disk at all. */
export function isZram(area: SwapArea): boolean {
  return /^\/dev\/zram\d+$/.test(area.filename);
}

/** What this area really is, beyond `partition` or `file`. */
export function describeArea(area: SwapArea): string {
  if (isZram(area)) {
    return 'Compressed memory, not a disk — swapping here costs CPU rather than I/O';
  }
  if (area.type === 'file') {
    return 'A file on a mounted filesystem, written through the blocks it already occupies';
  }
  if (area.type === 'partition') {
    return 'A block device given over to swap, written to directly';
  }
  return 'A kind of area this page has no note for';
}

/** Areas sharing one priority, which the kernel fills together. */
export interface PriorityGroup {
  priority: number;
  areas: SwapArea[];
  /** More than one area here, so the kernel alternates between them. */
  striped: boolean;
}

/**
 * The areas grouped by priority, highest first — which is the order swap is
 * actually filled in: everything at one priority is used, round-robin, before
 * anything at the next one down is touched.
 */
export function priorityGroups(areas: readonly SwapArea[]): PriorityGroup[] {
  const grouped = new Map<number, SwapArea[]>();

  for (const area of areas) {
    const existing = grouped.get(area.priority);
    if (existing === undefined) grouped.set(area.priority, [area]);
    else existing.push(area);
  }

  return Array.from(grouped, ([priority, group]) => ({
    priority,
    areas: group,
    striped: group.length > 1,
  })).sort((a, b) => b.priority - a.priority);
}

/** Past this much of all swap being spoken for, the machine is in trouble. */
export const NEARLY_FULL = 0.9;

export interface SwapsSummary {
  areas: number;
  totalKib: number;
  usedKib: number;
  freeKib: number;
  /** How much of all swap is spoken for, 0–1. */
  usedShare: number;
  /** Fill order: the priority groups, highest first. */
  groups: PriorityGroup[];
  /** Groups holding more than one area, which are striped across. */
  striped: PriorityGroup[];
  /** True once so little swap is left that the next burst has nowhere to go. */
  nearlyFull: boolean;
}

export function summarize(swaps: Swaps): SwapsSummary {
  const { areas } = swaps;

  const totalKib = areas.reduce((total, area) => total + area.sizeKib, 0);
  const usedKib = areas.reduce((total, area) => total + area.usedKib, 0);
  const groups = priorityGroups(areas);
  const share = totalKib === 0 ? 0 : usedKib / totalKib;

  return {
    areas: areas.length,
    totalKib,
    usedKib,
    freeKib: Math.max(0, totalKib - usedKib),
    usedShare: share,
    groups,
    striped: groups.filter((group) => group.striped),
    nearlyFull: areas.length > 0 && share >= NEARLY_FULL,
  };
}

const UNITS = ['KiB', 'MiB', 'GiB', 'TiB'];

/** Binary units from a KiB figure, since that is what the file counts in. */
export function formatKib(value: number): string {
  if (value === 0) return '0';

  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}

/** `21%`, and `<1%` for an area that is not quite untouched. */
export function formatShare(value: number): string {
  if (value === 0) return '0%';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
