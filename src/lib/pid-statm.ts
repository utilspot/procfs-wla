/**
 * Parser for `/proc/<pid>/statm` — a process's memory in seven numbers, which
 * is the cheap answer to a question `smaps` answers expensively.
 *
 * One line, seven counts, and `array.c` writes them with `seq_put_decimal_ull`
 * straight into the buffer rather than through `seq_printf` — the comment above
 * it says "for quick read", and that is what this file is for. `smaps` walks
 * every mapping and every page table entry; this reads seven counters already
 * kept in `mm_struct`. It is what `ps` and `top` use per process per refresh.
 *
 *     2857280 473086 226958 33153 0 721170 0
 *
 * Four things it is read wrong for:
 *
 *  - **Two of the seven are hardcoded zeros.** Field 5 (`lib`) and field 7
 *    (`dt`) are not measurements of this process — the kernel literally prints
 *    a constant `0` for each, and has since Linux 2.6, the counters behind them
 *    having been removed while the columns stayed for the sake of anything
 *    parsing by position. A reader treating field 5 as "shared library pages"
 *    is reading a number that is zero on every process on every machine. See
 *    {@link UNUSED}.
 *  - **The units are pages, and the file does not say how big a page is.**
 *    Every other memory figure under `/proc` is in kB — `status`, `smaps`,
 *    `meminfo` — and this one is in pages, so the same seven numbers mean
 *    sixteen times as much on a 64 KiB-page kernel as on a 4 KiB one. The
 *    answer is `AT_PAGESZ` in `/proc/<pid>/auxv`, not here. See
 *    {@link PAGE_SIZE}.
 *  - **Three of them are address space and two are resident memory.** `size`,
 *    `text` and `data` measure how much is *mapped*; `resident` and `shared`
 *    measure how much is *in RAM*. So `text + data` is not a part of
 *    `resident`, it is not comparable with it, and it does not add up to
 *    `size` either. See {@link StatmField.kind}.
 *  - **The number nearly everyone wants is not a field.** `shared` is the
 *    file-backed and shmem part of the resident set — `RssFile + RssShmem` —
 *    so the anonymous resident set, the memory this process would have to swap
 *    rather than drop, is `resident - shared`. See {@link anonymous}.
 *
 * Seven zeroes is an answer rather than an empty file: `proc_pid_statm` starts
 * every count at zero and fills them in only `if (mm)`, so a kernel thread —
 * which has no `mm` — prints `0 0 0 0 0 0 0`. That is the opposite of what
 * `/proc/<pid>/environ` and `/proc/<pid>/coredump_filter` do for the same
 * process, which is to print nothing at all. See {@link hasNoMm}.
 *
 * The file is mode 0444 with no `ptrace` check, unlike `/proc/<pid>/io` and
 * `/proc/<pid>/environ`: how much memory a process is using is not treated as
 * a secret, where what it read and what it was started with are.
 */

/**
 * Bytes in a page, which this file needs and does not state. 4 KiB is right on
 * x86-64 and on ARM64 as good as everyone builds it; a kernel with 16 or 64 KiB
 * pages makes every number here mean four or sixteen times as much.
 * `/proc/<pid>/auxv` carries the real answer as `AT_PAGESZ`.
 */
export const PAGE_SIZE = 4096;

/** Whether a count measures mapped address space or memory actually resident. */
export type Measure = 'virtual' | 'resident' | 'unused';

/** One of the seven, in the order `proc_pid_statm` prints them. */
export interface StatmField {
  /** The name `proc(5)` gives it. */
  name: string;
  /** 1-based column, since anything parsing this file parses by position. */
  column: number;
  label: string;
  /** Which of the two measurements it is — or neither, for the two constants. */
  kind: Measure;
  /** What it counts. */
  what: string;
  /** The same quantity in `/proc/<pid>/status`, where there is one. */
  status?: string;
}

/**
 * The seven. Two of them are constants, and saying so is most of what this
 * page is for.
 */
export const FIELDS: readonly StatmField[] = [
  {
    name: 'size',
    column: 1,
    label: 'total program size',
    kind: 'virtual',
    status: 'VmSize',
    what: 'Every page mapped into the address space, whether or not any of it is in RAM — reservations, guard pages and files mapped but never touched included. It is the weakest measure of "memory used" there is, and the largest.',
  },
  {
    name: 'resident',
    column: 2,
    label: 'resident set size',
    kind: 'resident',
    status: 'VmRSS',
    what: 'Pages actually in RAM right now. Shared pages are counted in full for every process mapping them, so adding this up across a machine double-counts heavily.',
  },
  {
    name: 'shared',
    column: 3,
    label: 'resident shared pages',
    kind: 'resident',
    status: 'RssFile + RssShmem',
    what: 'The file-backed and shmem part of the resident set — pages with somewhere to go, so the kernel can drop them under pressure rather than swapping them.',
  },
  {
    name: 'text',
    column: 4,
    label: 'text (code)',
    kind: 'virtual',
    status: 'VmExe',
    what: 'The span of the executable’s code segment, rounded out to whole pages. Address space, not residency: it says how much code is mapped, never how much of it has been run.',
  },
  {
    name: 'lib',
    column: 5,
    label: 'library pages — always zero',
    kind: 'unused',
    what: 'Not a measurement. The kernel prints a constant 0 here and has since Linux 2.6; the column stays only so that anything parsing by position keeps working.',
  },
  {
    name: 'data',
    column: 6,
    label: 'data + stack',
    kind: 'virtual',
    status: 'VmData + VmStk',
    what: 'Pages mapped for data and for the stack, added together. Address space again, so this is what the process may write to rather than what it has written.',
  },
  {
    name: 'dt',
    column: 7,
    label: 'dirty pages — always zero',
    kind: 'unused',
    what: 'Not a measurement either, and zero for the same reason as field 5. Dirty pages are in /proc/<pid>/smaps, a mapping at a time.',
  },
];

/** The two columns that are constants rather than counts. */
export const UNUSED: readonly string[] = FIELDS.filter((f) => f.kind === 'unused').map((f) => f.name);

/** One count as it was read. */
export interface StatmCount {
  field: StatmField;
  /** The count, in pages. */
  pages: number;
}

export interface Statm {
  counts: StatmCount[];
  /** What the file held, with the newline off — so that nothing and something
   * unreadable can be told apart. */
  value: string;
  /** The seven by name, in pages, with anything absent left at zero. */
  size: number;
  resident: number;
  shared: number;
  text: number;
  lib: number;
  data: number;
  dt: number;
  /** Numbers past the seventh, which this file does not have. */
  extra: number[];
  /** Whether all seven were there. */
  complete: boolean;
  /** Whether the line held something that was not an unsigned number. */
  readable: boolean;
  /** Whether the file ended with the newline the kernel writes. */
  terminated: boolean;
  bytes: number;
}

/** `2857280 473086 226958 33153 0 721170 0` — unsigned numbers and spaces. */
const LINE = /^\d+(?:\s+\d+)*$/;

export function parseStatm(text: string): Statm {
  const bytes = new TextEncoder().encode(text).length;
  const terminated = text.endsWith('\n');
  const value = text.trim();
  const readable = value !== '' && LINE.test(value);
  const numbers = readable ? value.split(/\s+/).map(Number) : [];

  const counts = FIELDS.filter((field) => numbers.length >= field.column).map((field) => ({
    field,
    pages: numbers[field.column - 1]!,
  }));

  const at = (name: string): number =>
    counts.find((count) => count.field.name === name)?.pages ?? 0;

  return {
    counts,
    value,
    size: at('size'),
    resident: at('resident'),
    shared: at('shared'),
    text: at('text'),
    lib: at('lib'),
    data: at('data'),
    dt: at('dt'),
    extra: numbers.slice(FIELDS.length),
    complete: numbers.length >= FIELDS.length,
    readable,
    terminated,
    bytes,
  };
}

/** Whether there was nothing in the file at all. */
export function isEmpty(statm: Statm): boolean {
  return statm.value === '';
}

/** Whether it held something that is not the line of numbers this file is. */
export function isUnreadable(statm: Statm): boolean {
  return !statm.readable && !isEmpty(statm);
}

/**
 * Whether this process has no `mm` at all — a kernel thread, or one already
 * gone. `proc_pid_statm` zeroes every count and fills them in only when there
 * is an `mm`, so seven zeroes is what it prints rather than nothing.
 */
export function hasNoMm(statm: Statm): boolean {
  return statm.readable && statm.counts.every((count) => count.pages === 0);
}

/**
 * The anonymous resident set: memory in RAM with no file behind it, which is
 * what a process would have to **swap** rather than drop.
 *
 * `resident - shared`, and the number most readers of this file actually came
 * for — `status` calls it `RssAnon` and this file does not carry it. Never
 * negative on a file the kernel wrote, since `shared` is a part of `resident`.
 */
export function anonymous(statm: Statm): number {
  return Math.max(0, statm.resident - statm.shared);
}

/** Share of the mapped address space that is actually in RAM, or null with none. */
export function residentShare(statm: Statm): number | null {
  return statm.size === 0 ? null : statm.resident / statm.size;
}

/** Share of the resident set that is file-backed, or null where none is resident. */
export function sharedShare(statm: Statm): number | null {
  return statm.resident === 0 ? null : statm.shared / statm.resident;
}

/** The counts of one measurement, in file order. */
export function ofKind(statm: Statm, kind: Measure): StatmCount[] {
  return statm.counts.filter((count) => count.field.kind === kind);
}

/**
 * Whether either constant column is not the zero the kernel writes. A file with
 * something there did not come from `proc_pid_statm`.
 */
export function unusedNotZero(statm: Statm): StatmCount[] {
  return ofKind(statm, 'unused').filter((count) => count.pages !== 0);
}

/**
 * Relationships the kernel's own numbers always hold to: the resident set is
 * part of the address space, and the shared part is part of the resident set. A
 * file breaking one was not read off an `mm_struct`.
 */
export function impossible(statm: Statm): string[] {
  const broken: string[] = [];
  if (!statm.readable) return broken;

  if (statm.resident > statm.size) {
    broken.push('more is resident than is mapped at all');
  }
  if (statm.shared > statm.resident) {
    broken.push('more of the resident set is shared than is resident');
  }
  if (statm.text > statm.size) {
    broken.push('more code is mapped than the whole address space holds');
  }

  return broken;
}

/** Pages as bytes, at a page size the file does not state. */
export function toBytes(pages: number, pageSize: number = PAGE_SIZE): number {
  return pages * pageSize;
}

export interface StatmSummary {
  /** Bytes mapped, at the assumed page size. */
  size: number;
  /** Bytes resident. */
  resident: number;
  /** Bytes resident with a file behind them. */
  shared: number;
  /** Bytes resident with nothing behind them, which is what swaps. */
  anonymous: number;
  residentShare: number | null;
  noMm: boolean;
}

export function summarize(statm: Statm, pageSize: number = PAGE_SIZE): StatmSummary {
  return {
    size: toBytes(statm.size, pageSize),
    resident: toBytes(statm.resident, pageSize),
    shared: toBytes(statm.shared, pageSize),
    anonymous: toBytes(anonymous(statm), pageSize),
    residentShare: residentShare(statm),
    noMm: hasNoMm(statm),
  };
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** `1.4 GiB` — a size from the bytes the pages come to. */
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

/** `473,086`, since a page count gets long enough to be misread. */
export function formatPages(pages: number): string {
  return pages.toLocaleString('en-US');
}

/** `17%`, and `<1%` for a share that is not quite nothing. */
export function formatShare(value: number): string {
  if (value === 0) return '0%';
  if (value >= 0.995) return '100%';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
