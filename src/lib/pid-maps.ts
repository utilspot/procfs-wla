/**
 * Parser for `/proc/<pid>/maps` — every region of a process's address space,
 * one line each.
 *
 * The cheap half of a pair: `/proc/<pid>/smaps` is **this file with the
 * accounting filled in**, a block per mapping opening with the very line this
 * one prints. So the line is parsed by `parseMapLine` in `src/lib/smaps.ts`,
 * once, for both pages — and what a mapping *is* comes from there too. Reading
 * `smaps` walks every page table entry; reading this walks the list of regions
 * and stops. That is the whole difference, and it is why `pmap` and every
 * leak-hunting script start here.
 *
 *     7f4a1c000000-7f4a1c021000 rw-p 00000000 00:00 0                    [heap]
 *     ^ start-end               ^perms ^offset ^dev  ^inode              ^path
 *
 * Five things it is read wrong for:
 *
 *  - **The fourth character of `perms` is not a permission.** `rwx` are, and
 *    the one after them is `p` or `s` — **private or shared**, the mapping's
 *    type rather than an access bit. A reader taking `rw-p` for four flags has
 *    mistaken the most important character in the line for a fourth kind of
 *    write. See {@link isShared}.
 *  - **It says nothing whatever about memory.** Every figure here is *address
 *    space*: a mapping can span a gigabyte and hold nothing, which is exactly
 *    what a `---p` reservation is for. How much is in RAM is `smaps`, and it
 *    is not cheap to ask. See {@link sizeOf}.
 *  - **`(deleted)` is the kernel talking, not part of the name.** The file
 *    behind the mapping has been unlinked — replaced by a package upgrade,
 *    most often — while the process goes on running the copy it mapped. It is
 *    the answer to why a service is still using a library that was patched an
 *    hour ago. See {@link isDeleted}.
 *  - **The path is not always a path.** It may be empty, for anonymous memory
 *    nobody named; a bracketed name the kernel made up, `[heap]`, `[stack]`,
 *    `[vdso]`; or a real path with a byte escaped as `\\012`, since a newline
 *    in a filename cannot be printed in a line-oriented file. See
 *    {@link decodePath}.
 *  - **`[stack]` marks one stack, and a process may have many.** It is the
 *    *main* thread's; every other thread's is an ordinary anonymous mapping
 *    with nothing to mark it, the `[stack:tid]` form having been dropped in
 *    Linux 4.5. So a threaded process shows one `[stack]` and a crowd of
 *    unnamed regions that are also stacks.
 *
 * The gaps between mappings are unmapped address space — the file lists what
 * exists and says nothing about the holes, which on a 64-bit process are very
 * nearly all of it. See {@link gapBefore}.
 *
 * Mode 0444, but opening it takes `PTRACE_MODE_READ` through `proc_mem_open`,
 * so another user's is `EPERM` — the 403 the page reports — despite what the
 * mode bits suggest.
 */
import {
  isExecutable,
  isReadable,
  isShared,
  isWritable,
  isWritableExecutable,
  kindOf,
  KINDS,
  labelOf,
  parseMapLine,
  type Mapping,
  type MappingKind,
} from './smaps';

// What a mapping is does not change between the file that lists them and the
// file that costs them, so the shape and the reading of it are `smaps`'s.
export {
  isExecutable,
  isReadable,
  isShared,
  isWritable,
  isWritableExecutable,
  kindOf,
  KINDS,
  labelOf,
  type Mapping,
  type MappingKind,
};

export interface ProcessMaps {
  mappings: Mapping[];
  /** Lines that were not a mapping. */
  malformed: string[];
  /** What the file held, with the trailing newline off. */
  value: string;
  bytes: number;
}

export function parsePidMaps(text: string): ProcessMaps {
  const mappings: Mapping[] = [];
  const malformed: string[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed === '') continue;

    const mapping = parseMapLine(trimmed);
    if (mapping === null) malformed.push(trimmed);
    else mappings.push(mapping);
  }

  return { mappings, malformed, value: text.replace(/\n+$/, ''), bytes: new TextEncoder().encode(text).length };
}

/** Whether the file held nothing — a kernel thread, which has no `mm` to walk. */
export function isEmpty(maps: ProcessMaps): boolean {
  return maps.value === '';
}

/** The address a mapping starts at, as a number. */
export function startOf(mapping: Mapping): number {
  return Number.parseInt(mapping.start, 16);
}

/** And where it ends — exclusive, as the kernel prints it. */
export function endOf(mapping: Mapping): number {
  return Number.parseInt(mapping.end, 16);
}

/**
 * Bytes of **address space** the mapping covers. Not memory: the whole point of
 * the file is that it does not know how much of this is real.
 */
export function sizeOf(mapping: Mapping): number {
  return endOf(mapping) - startOf(mapping);
}

/** Address space across every mapping, which is roughly `VmSize`. */
export function totalSize(maps: ProcessMaps): number {
  return maps.mappings.reduce((total, mapping) => total + sizeOf(mapping), 0);
}

/** ` (deleted)`, which the kernel appends and is not part of the filename. */
const DELETED = / \(deleted\)$/;

/**
 * Whether the file behind this mapping has been unlinked while the mapping
 * lives on — a library replaced under a running process, most often.
 */
export function isDeleted(mapping: Mapping): boolean {
  return DELETED.test(mapping.path);
}

/**
 * The path with the kernel's `(deleted)` taken off and its octal escapes
 * undone. `seq_file_path` escapes any byte that would break the line — a
 * newline becomes `\012` — so a filename holding one arrives encoded.
 */
export function decodePath(mapping: Mapping): string {
  return mapping.path
    .replace(DELETED, '')
    .replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

/** Whether the path carried an escape, which means the real name holds that byte. */
export function hasEscape(mapping: Mapping): boolean {
  return /\\[0-7]{3}/.test(mapping.path);
}

/**
 * Whether a real file is behind this mapping, which the device and inode say
 * even where the path does not: an anonymous region prints `00:00 0`.
 */
export function isFileBacked(mapping: Mapping): boolean {
  return mapping.inode !== 0 || !/^0+:0+$/.test(mapping.dev);
}

/**
 * Whether this is a reservation: mapped, and readable by nobody. An allocator
 * takes a large `---p` range so it can hand out pieces of it later, and until
 * it does the range costs nothing but address space.
 */
export function isReservation(mapping: Mapping): boolean {
  return mapping.perms.startsWith('---');
}

/** Unmapped bytes between this mapping and the one before it, if any. */
export function gapBefore(maps: ProcessMaps, index: number): number {
  if (index === 0) return 0;
  return startOf(maps.mappings[index]!) - endOf(maps.mappings[index - 1]!);
}

/** Whether the mappings run in ascending order, which is the only order the kernel walks. */
export function isOrdered(maps: ProcessMaps): boolean {
  return maps.mappings.every(
    (mapping, index) => index === 0 || startOf(mapping) >= endOf(maps.mappings[index - 1]!),
  );
}

/** Mappings that overlap, which one address space cannot hold. */
export function overlaps(maps: ProcessMaps): Mapping[] {
  return maps.mappings.filter(
    (mapping, index) => index > 0 && startOf(mapping) < endOf(maps.mappings[index - 1]!),
  );
}

/** Mappings both writable and executable, which is worth a second look. */
export function writableExecutable(maps: ProcessMaps): Mapping[] {
  return maps.mappings.filter(isWritableExecutable);
}

/** Mappings whose backing file has been unlinked. */
export function deleted(maps: ProcessMaps): Mapping[] {
  return maps.mappings.filter(isDeleted);
}

/** The distinct files mapped, by the path the kernel printed. */
export function files(maps: ProcessMaps): string[] {
  return [...new Set(maps.mappings.filter(isFileBacked).map((mapping) => decodePath(mapping)))];
}

export interface KindTotal {
  kind: MappingKind;
  count: number;
  /** Address space of that kind, in bytes. */
  bytes: number;
}

/** Address space by kind of mapping, largest first. */
export function byKind(maps: ProcessMaps): KindTotal[] {
  const totals = new Map<MappingKind, KindTotal>();

  for (const mapping of maps.mappings) {
    const kind = kindOf(mapping);
    const entry = totals.get(kind) ?? { kind, count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += sizeOf(mapping);
    totals.set(kind, entry);
  }

  return [...totals.values()].sort((a, b) => b.bytes - a.bytes || a.kind.localeCompare(b.kind));
}

export interface MapsSummary {
  mappings: number;
  /** Total address space, in bytes. */
  bytes: number;
  /** The largest single mapping. */
  largest: Mapping | null;
  files: number;
  deleted: number;
  writableExecutable: number;
  reservations: number;
  ordered: boolean;
}

export function summarize(maps: ProcessMaps): MapsSummary {
  const largest = [...maps.mappings].sort(
    (a, b) => sizeOf(b) - sizeOf(a) || startOf(a) - startOf(b),
  )[0];

  return {
    mappings: maps.mappings.length,
    bytes: totalSize(maps),
    largest: largest ?? null,
    files: files(maps).length,
    deleted: deleted(maps).length,
    writableExecutable: writableExecutable(maps).length,
    reservations: maps.mappings.filter(isReservation).length,
    ordered: isOrdered(maps),
  };
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** `132 KiB`, `1.4 GiB` — a size from the bytes two addresses are apart. */
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

/** What each character of `perms` means, in the order the kernel writes them. */
export function describePerms(mapping: Mapping): string[] {
  const [r, w, x, type] = [...mapping.perms];

  return [
    r === 'r' ? 'readable' : 'not readable',
    w === 'w' ? 'writable' : 'not writable',
    x === 'x' ? 'executable' : 'not executable',
    type === 's'
      ? 'shared — writes go through to whatever backs it'
      : 'private — a write copies the page first',
  ];
}
