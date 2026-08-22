/**
 * Parser for `/proc/<pid>/coredump_filter` — which of a process's mappings get
 * written into its core file, as nine bits in one hex number.
 *
 * One line, and that is the whole file:
 *
 *   00000033
 *
 * `proc_coredump_filter_read` in `fs/proc/base.c` prints it with `%08lx` and a
 * newline: **eight lowercase hex digits, zero-padded**, whatever the value is.
 * The number it prints is `(mm->flags & MMF_DUMP_FILTER_MASK) >>
 * MMF_DUMP_FILTER_SHIFT` — the flags word shifted down by {@link SHIFT}, since
 * the two bits below the filter are `MMF_DUMPABLE` and `MMF_DUMP_SECURELY` and
 * belong to a different question. So bit 0 here is bit 2 of `mm->flags`.
 *
 * Five things it is read wrong for:
 *
 *  - **It does not decide whether there is a core at all.** `RLIMIT_CORE`
 *    decides that, `/proc/sys/kernel/core_pattern` decides where it goes, and
 *    `MMF_DUMPABLE` — `/proc/sys/fs/suid_dumpable` and the credentials a
 *    process gained — decides whether one is allowed. This file only decides
 *    what goes *inside* one that is already being written.
 *  - **The value is hex with no `0x`, and a write is parsed with base 0.** The
 *    kernel reads a write with `kstrtouint_from_user(…, 0, …)`, where a leading
 *    zero means **octal** — and every value this file prints has leading
 *    zeroes. So handing the file its own output straight back does not set the
 *    value it already had: `echo 00000033 >` sets `0000001b`. See
 *    {@link roundTrip}.
 *  - **Bit 4 is only worth anything while bit 2 is clear.** Bit 2 dumps
 *    file-backed private mappings whole, headers and all, so with both set the
 *    header bit decides nothing. The kernel's own default has 4 without 2 for
 *    exactly that reason: enough of each mapped library for a debugger to
 *    identify it, without the library itself. See {@link BITS}.
 *  - **A write cannot set anything above the nine.** `proc_coredump_filter_write`
 *    walks `MMF_DUMP_FILTER_BITS` bits and sets or clears each one, so bits
 *    above them are dropped rather than refused: `echo 0xffffffff >` leaves
 *    `000001ff` behind. A file holding more than that was not written through
 *    this interface. See {@link CoredumpFilter.unknown}.
 *  - **It is inherited, which is the only way to set it for a program that has
 *    not started.** `mm_init` copies `MMF_INIT_MASK` — the dumpable bits and
 *    this filter — from the parent, and `execve` builds the new `mm` the same
 *    way, so a shell that writes its own filter hands it to everything it then
 *    runs.
 *
 * An empty file is not an error: the read takes `get_task_mm` first, so a
 * kernel thread and a process already gone print nothing at all. The file
 * exists only on a `CONFIG_ELF_CORE` kernel, and is mode 0644 — every user
 * reads it, and only the owner writes it, which is the opposite way round from
 * `/proc/<pid>/environ` beside it. See {@link isEmpty}.
 */

/** Hex digits `%08lx` writes, however small the value is. */
export const WIDTH = 8;

/** `MMF_DUMP_FILTER_BITS` — the bits the write path walks, and this file has. */
export const FILTER_BITS = 9;

/** Every bit a write can set, which is what one above them is dropped against. */
export const FILTER_MASK = (1 << FILTER_BITS) - 1;

/**
 * `MMF_DUMP_FILTER_SHIFT` — where the filter sits in `mm->flags`, above the two
 * `MMF_DUMPABLE` bits that answer a different question. Bit 0 here is bit 2
 * there, which is why the kernel constant for it is `MMF_DUMP_ANON_PRIVATE = 2`.
 */
export const SHIFT = 2;

/** `MMF_DUMP_FILTER_DEFAULT`, shifted down: what a process starts with. */
export const DEFAULT_MASK = 0x33;

/** One of the nine bits, and what setting it puts in the core. */
export interface FilterBit {
  /** Its place in this file, 0 to 8. */
  bit: number;
  /** The bit as a number, for the arithmetic the page shows. */
  mask: number;
  /** The kernel's name for it, whose number is this one plus {@link SHIFT}. */
  flag: string;
  /** What kind of mapping it covers. */
  what: string;
  /** What setting it costs and buys. */
  note: string;
  /** Whether {@link DEFAULT_MASK} has it. */
  standard: boolean;
}

/**
 * The nine bits, in file order, as `Documentation/filesystems/proc.rst` gives
 * them and `vma_dump_size` in `fs/binfmt_elf.c` acts on them.
 *
 * Two things the table cannot say in a column. **Bits 0 to 4 have nothing to do
 * with huge pages**: a hugetlb mapping is decided by bits 5 and 6 alone,
 * whether it is anonymous or file-backed. And **nothing here can force a
 * mapping the kernel will not dump** — `VM_DONTDUMP`, which `madvise(…,
 * MADV_DONTDUMP)` sets and the kernel puts on its own special mappings, wins
 * over every bit below.
 */
export const BITS: readonly FilterBit[] = [
  {
    bit: 0,
    mask: 1 << 0,
    flag: 'MMF_DUMP_ANON_PRIVATE',
    what: 'anonymous private',
    note: 'The heap, the stacks and every private allocation — where a program keeps what it is working on, and the one bit a backtrace needs.',
    standard: true,
  },
  {
    bit: 1,
    mask: 1 << 1,
    flag: 'MMF_DUMP_ANON_SHARED',
    what: 'anonymous shared',
    note: 'Memory shared with another process and backed by no file: a MAP_SHARED|MAP_ANONYMOUS segment, or the shared memory a database keeps its buffers in.',
    standard: true,
  },
  {
    bit: 2,
    mask: 1 << 2,
    flag: 'MMF_DUMP_MAPPED_PRIVATE',
    what: 'file-backed private',
    note: 'Every mapped file, the executable and its libraries included. Off by default because the pages are already on disk — and it is what makes bit 4 pointless while it is on.',
    standard: false,
  },
  {
    bit: 3,
    mask: 1 << 3,
    flag: 'MMF_DUMP_MAPPED_SHARED',
    what: 'file-backed shared',
    note: 'A file mapped MAP_SHARED, which the writes have already reached. Dumping it copies a file that is still there into a core that is about to be read once.',
    standard: false,
  },
  {
    bit: 4,
    mask: 1 << 4,
    flag: 'MMF_DUMP_ELF_HEADERS',
    what: 'ELF headers of file-backed private',
    note: 'The first page of each mapped file rather than the file: enough for a debugger to find the build id of every library and load its symbols from disk. Effective only while bit 2 is clear, which is why the default has it and not bit 2.',
    standard: true,
  },
  {
    bit: 5,
    mask: 1 << 5,
    flag: 'MMF_DUMP_HUGETLB_PRIVATE',
    what: 'private huge pages',
    note: 'hugetlb mappings this process has to itself. Huge pages are decided here and not by bits 0 to 4, whatever else those say.',
    standard: true,
  },
  {
    bit: 6,
    mask: 1 << 6,
    flag: 'MMF_DUMP_HUGETLB_SHARED',
    what: 'shared huge pages',
    note: 'hugetlb mappings shared with other processes — usually the largest thing on the machine, and off by default for that reason.',
    standard: false,
  },
  {
    bit: 7,
    mask: 1 << 7,
    flag: 'MMF_DUMP_DAX_PRIVATE',
    what: 'private DAX pages',
    note: 'Persistent memory mapped straight from the device with no page cache in between. Nothing on a machine without pmem has one.',
    standard: false,
  },
  {
    bit: 8,
    mask: 1 << 8,
    flag: 'MMF_DUMP_DAX_SHARED',
    what: 'shared DAX pages',
    note: 'The same, shared — a file on a DAX filesystem mapped by more than one process. This bit and the one before it are why the file has nine and not seven.',
    standard: false,
  },
];

/** One of the nine as this file has it. */
export interface BitState extends FilterBit {
  set: boolean;
}

export interface CoredumpFilter {
  /** The file exactly as it was read. */
  raw: string;
  /** What it held, with the newline off. */
  value: string;
  /** Whether that is a number this file could hold at all. */
  readable: boolean;
  /** The whole number it spells, bits above the nine included. */
  mask: number;
  /** The nine, in file order. */
  bits: BitState[];
  /** Bit positions above the eighth that are set, which a write cannot make. */
  unknown: number[];
  /**
   * Whether it is written the way `%08lx` writes: eight digits, lower case.
   * False says something between here and the kernel reformatted it.
   */
  printed: boolean;
  /** Whether the file ended with a newline. The kernel writes one. */
  terminated: boolean;
  /** Bytes the file held. */
  bytes: number;
}

/** `00000033`, `1ff`, `0` — hex digits and nothing else. */
const HEX = /^[0-9a-f]+$/i;

/** Exactly what `%08lx` produces, which is what an untouched read looks like. */
const PRINTED = /^[0-9a-f]{8}$/;

export function parseCoredumpFilter(text: string): CoredumpFilter {
  const bytes = new TextEncoder().encode(text).length;
  const terminated = text.endsWith('\n');
  const value = text.trim();
  const readable = HEX.test(value);
  const mask = readable ? Number.parseInt(value, 16) : 0;

  const unknown: number[] = [];
  // Only the bits a write can never set. `mask >>> 9` would lose nothing here —
  // eight hex digits is a 32-bit number — but the bit's own place is what the
  // page names, so the walk keeps it.
  for (let bit = FILTER_BITS; bit < 32; bit += 1) {
    if (readable && (mask & (2 ** bit)) !== 0) unknown.push(bit);
  }

  return {
    raw: text,
    value,
    readable,
    mask,
    bits: BITS.map((entry) => ({ ...entry, set: readable && (mask & entry.mask) !== 0 })),
    unknown,
    printed: PRINTED.test(value),
    terminated,
    bytes,
  };
}

/** Whether there is nothing in the file: no `mm`, so nothing to print from. */
export function isEmpty(filter: CoredumpFilter): boolean {
  return filter.value === '';
}

/** Whether it held something that is not the number the kernel prints. */
export function isUnreadable(filter: CoredumpFilter): boolean {
  return !filter.readable && !isEmpty(filter);
}

/** The nine bits as a number, with anything above them dropped as a write would. */
export function filterMask(filter: CoredumpFilter): number {
  return filter.mask & FILTER_MASK;
}

/** The bits that are on, which is what a core would actually hold. */
export function setBits(filter: CoredumpFilter): BitState[] {
  return filter.bits.filter((bit) => bit.set);
}

/** Whether this is the filter a process is given when nothing has written one. */
export function isDefault(filter: CoredumpFilter): boolean {
  return filter.readable && filterMask(filter) === DEFAULT_MASK;
}

/** Whether no mapping at all would be written — registers and notes only. */
export function isNothing(filter: CoredumpFilter): boolean {
  return filter.readable && filterMask(filter) === 0;
}

/** Whether every kind of mapping would be, which is `0x1ff`. */
export function isEverything(filter: CoredumpFilter): boolean {
  return filter.readable && filterMask(filter) === FILTER_MASK;
}

/**
 * Whether bit 4 is set behind a bit 2 that already covers it: the whole
 * file-backed private mapping is being dumped, so asking for its first page as
 * well decides nothing. Not a fault — just a bit that is doing no work.
 */
export function headersRedundant(filter: CoredumpFilter): boolean {
  return filter.bits[2]!.set && filter.bits[4]!.set;
}

/**
 * Whether a core would be hard to make sense of: the mapped files are out and
 * so are their headers, so a debugger has nothing to match the addresses in the
 * backtrace against and no build id to find the symbols by.
 */
export function unsymbolisable(filter: CoredumpFilter): boolean {
  return filter.readable && !filter.bits[2]!.set && !filter.bits[4]!.set;
}

/** How a filter stands against the one the kernel starts every process with. */
export type AgainstDefault = 'default' | 'narrower' | 'wider' | 'different';

/**
 * Whether this filter is the default, a subset of it, a superset, or neither —
 * which is the one thing worth saying about a number that is not `00000033`.
 */
export function againstDefault(filter: CoredumpFilter): AgainstDefault {
  const mask = filterMask(filter);
  if (mask === DEFAULT_MASK) return 'default';
  if ((mask & DEFAULT_MASK) === mask) return 'narrower';
  if ((mask & DEFAULT_MASK) === DEFAULT_MASK) return 'wider';
  return 'different';
}

/** Bits the default has that this filter does not, in file order. */
export function missingFromDefault(filter: CoredumpFilter): BitState[] {
  return filter.bits.filter((bit) => bit.standard && !bit.set);
}

/** And the ones it has that the default does not. */
export function beyondDefault(filter: CoredumpFilter): BitState[] {
  return filter.bits.filter((bit) => !bit.standard && bit.set);
}

/** A number as this file writes it: `%08lx`. */
export function formatMask(mask: number): string {
  return mask.toString(16).padStart(WIDTH, '0');
}

/** What a write of the file's own text would do to it. See {@link roundTrip}. */
export interface RoundTrip {
  /** The text `cat` would hand back to `echo`. */
  text: string;
  /** The base `kstrtouint(…, 0, …)` reads it in, from its first characters. */
  base: 8 | 10 | 16;
  /** What the file would hold afterwards, or null where the write is refused. */
  mask: number | null;
  /** Whether that is the value it already holds. */
  same: boolean;
}

/** Digits each base accepts, which is what decides between a value and `EINVAL`. */
const ACCEPTS: Record<number, RegExp> = { 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9a-f]+$/i };

/**
 * What `echo $(cat coredump_filter) > coredump_filter` would leave behind.
 *
 * The read prints hex with no `0x` in front of it and the write is parsed with
 * base 0, where `_parse_integer_fixup_radix` reads a leading zero as **octal**
 * — and `%08lx` puts leading zeroes on nearly every value this file can hold.
 * So the file's own output is not something it will take back:
 *
 *  - `00000033` is read as octal 33, which is `0000001b`. The write is accepted
 *    and the filter is now a different one.
 *  - `000001ff` has an `f` in it, which is not an octal digit, so the write is
 *    refused with `EINVAL` and the filter is left alone.
 *
 * Null for a file with nothing readable in it, where the question does not
 * arise.
 */
export function roundTrip(filter: CoredumpFilter): RoundTrip | null {
  if (!filter.readable) return null;

  const text = filter.value;
  const base = /^0x/i.test(text) ? 16 : text.startsWith('0') ? 8 : 10;
  const digits = base === 16 ? text.slice(2) : text;

  // Anything the base does not accept stops the parse, and `kstrtouint` answers
  // `EINVAL` rather than taking the digits it managed.
  const parsed = ACCEPTS[base]!.test(digits) ? Number.parseInt(digits, base) : null;

  // A write sets nine bits and drops the rest, so what lands is never wider.
  const mask = parsed === null ? null : parsed & FILTER_MASK;

  return { text, base, mask, same: mask === filterMask(filter) };
}
