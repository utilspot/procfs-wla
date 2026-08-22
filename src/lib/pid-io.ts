/**
 * Parser for `/proc/<pid>/io` — what one process has read and written, counted
 * twice at two different layers.
 *
 * Seven `name: value` lines, in this order and no other:
 *
 *     rchar: 323934931
 *     wchar: 323929600
 *     syscr: 632687
 *     syscw: 632675
 *     read_bytes: 0
 *     write_bytes: 323932160
 *     cancelled_write_bytes: 0
 *
 * The whole of reading this file is knowing that **the first pair and the
 * second pair are not the same measurement of the same thing**. `rchar` and
 * `wchar` are bytes that went through `read()` and `write()` — every one of
 * them, whether they came from a disk, the page cache, a pipe, a socket, a tty
 * or `/proc` itself. `read_bytes` and `write_bytes` are the storage layer's
 * numbers. So a process that read a gigabyte already in cache shows a gigabyte
 * of `rchar` against **zero** `read_bytes`, and that is the ordinary case
 * rather than a fault. `/proc/uid_io/stats` carries these same four counters
 * per uid — they are one struct, `task_io_accounting` — and
 * `src/lib/uid_io-stats.ts` reads them the same way.
 *
 * Five things this file is read wrong for:
 *
 *  - **The two block counters are not taken at the same layer either.**
 *    `read_bytes` is charged at `submit_bio`, so it is what a disk really was
 *    asked for — which is why it comes in multiples of {@link SECTOR_SIZE}, and
 *    why **readahead can push it above `rchar`**: the kernel fetched what the
 *    program never asked for. `write_bytes` is charged in
 *    `account_page_dirtied`, when a page is *dirtied* rather than when it is
 *    written — so it is a promise of I/O rather than a record of it, and it
 *    comes in multiples of {@link PAGE_SIZE}. See {@link withoutDisk}.
 *  - **That promise is why `cancelled_write_bytes` exists, and there is no
 *    cancelled *read*.** Dirty a megabyte and delete the file before writeback
 *    and the disk never sees it: `write_bytes` already counted it, so the
 *    truncate puts it back here instead. The honest figure for what a process
 *    put on a disk is `write_bytes - cancelled_write_bytes`. See
 *    {@link reallyWritten}.
 *  - **`syscr` and `syscw` are calls, not bytes.** They are the only two
 *    figures here that are not a size, and the ratio to `rchar` is the useful
 *    thing about them: a process with millions of calls and little traffic is
 *    reading a byte at a time. See {@link averageRead}.
 *  - **It is the whole thread group, dead threads included.** The `tgid` file
 *    sums every thread's counters and the accumulated total of the ones that
 *    have already exited; `/proc/<pid>/task/<tid>/io` is the one thread.
 *  - **It is not world-readable.** Mode 0400 with a `ptrace_may_access` check
 *    on top, like `/proc/<pid>/environ` and unlike almost everything else about
 *    a process. Byte counts leak: the length of what somebody typed at a tty is
 *    in here. Reading another user's is `EACCES` — the 403 the page reports.
 *
 * Every counter is cumulative from the process's first instruction and never
 * goes down. The file exists only on a `CONFIG_TASK_IO_ACCOUNTING` kernel, and
 * `rchar` through `syscw` need `CONFIG_TASK_XACCT` besides; distributions build
 * both, and a kernel without them has no file here at all rather than a file of
 * zeroes. Zeroes mean a process that has genuinely done nothing — see
 * {@link isIdle}.
 */

/** What the block layer counts in, which is why `read_bytes` is round. */
export const SECTOR_SIZE = 512;

/**
 * What `write_bytes` counts in: it is charged a page at a time as pages are
 * dirtied. 4 KiB is right on x86 and on ARM64 as distributions build it.
 */
export const PAGE_SIZE = 4096;

/** Which measurement a counter belongs to, which is the whole point of the file. */
export type Layer = 'syscall' | 'block';

/** One of the seven, and what it actually counts. */
export interface IoField {
  /** The name as the kernel writes it. */
  name: string;
  /** A short label for a table. */
  label: string;
  /** Which of the two measurements it is. */
  layer: Layer;
  /** Calls rather than bytes, for the two that are. */
  calls?: boolean;
  /** What it counts, and what it does not. */
  what: string;
}

/**
 * The seven, in the order `do_io_accounting` prints them.
 *
 * The order matters to a reader: the four syscall-level counters come first and
 * the three block-level ones after, so the file is already grouped by the
 * distinction that makes it confusing.
 */
export const FIELDS: readonly IoField[] = [
  {
    name: 'rchar',
    label: 'bytes through read()',
    layer: 'syscall',
    what: 'Everything the program read, from wherever it came — a disk, the page cache, a pipe, a socket, a tty, or /proc. Nothing here says a disk was involved.',
  },
  {
    name: 'wchar',
    label: 'bytes through write()',
    layer: 'syscall',
    what: 'Everything the program wrote, to wherever it went. A write to a pipe or a terminal counts here and can never appear below.',
  },
  {
    name: 'syscr',
    label: 'read calls',
    layer: 'syscall',
    calls: true,
    what: 'How many read(), pread() and readv() calls were made — a count of calls, not of bytes. Against rchar it gives the average size of a read.',
  },
  {
    name: 'syscw',
    label: 'write calls',
    layer: 'syscall',
    calls: true,
    what: 'The same for write(). A program with far more calls than traffic is going to the kernel far more often than it needs to.',
  },
  {
    name: 'read_bytes',
    label: 'bytes fetched from storage',
    layer: 'block',
    what: 'Charged at submit_bio, so this is what a disk really was asked for. It can exceed rchar, because readahead fetches what the program has not asked for and may never want.',
  },
  {
    name: 'write_bytes',
    label: 'bytes promised to storage',
    layer: 'block',
    what: 'Charged when a page is dirtied rather than when it is written, so it is a promise of I/O rather than a record of one — which is what makes the counter below possible.',
  },
  {
    name: 'cancelled_write_bytes',
    label: 'bytes promised and then withdrawn',
    layer: 'block',
    what: 'Dirty pages thrown away before writeback — a file truncated or deleted after being written. The disk never saw these, so the real figure is write_bytes less this.',
  },
];

/** The counters by name, for the arithmetic, with anything absent left at zero. */
export interface IoCounts {
  rchar: number;
  wchar: number;
  syscr: number;
  syscw: number;
  read_bytes: number;
  write_bytes: number;
  cancelled_write_bytes: number;
}

/** One line of the file as it was read. */
export interface IoCounter {
  name: string;
  value: number;
  /** 1-based line it was on, since the order is fixed and worth checking. */
  line: number;
  /** What it is, or null for a name this app does not know. */
  field: IoField | null;
}

export interface ProcessIo {
  /** The lines that parsed, in file order. */
  counters: IoCounter[];
  /** The known counters by name, absent ones left at zero. */
  counts: IoCounts;
  /** Names the kernel printed that this app has no entry for — a newer kernel. */
  unknown: string[];
  /** Known names the file did not carry at all. */
  missing: string[];
  /** Lines that were not `name: number`. */
  malformed: string[];
  /** Whether the seven came in the order the kernel prints them. */
  ordered: boolean;
  /** Bytes the file held. */
  bytes: number;
}

/** `rchar: 323934931` — a name, a colon, and one unsigned number. */
const LINE = /^([a-z_]+):\s+(\d+)$/;

const ZERO: IoCounts = {
  rchar: 0,
  wchar: 0,
  syscr: 0,
  syscw: 0,
  read_bytes: 0,
  write_bytes: 0,
  cancelled_write_bytes: 0,
};

export function parsePidIo(text: string): ProcessIo {
  const bytes = new TextEncoder().encode(text).length;
  const counters: IoCounter[] = [];
  const counts: IoCounts = { ...ZERO };
  const unknown: string[] = [];
  const malformed: string[] = [];
  const seen = new Set<string>();

  let line = 0;
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;

    line += 1;
    const match = LINE.exec(trimmed);
    if (match === null) {
      malformed.push(trimmed);
      continue;
    }

    const [, name, value] = match as unknown as [string, string, string];
    const field = FIELDS.find((candidate) => candidate.name === name) ?? null;

    counters.push({ name, value: Number(value), line, field });
    seen.add(name);

    if (field === null) unknown.push(name);
    else counts[name as keyof IoCounts] = Number(value);
  }

  // The order is fixed — `do_io_accounting` prints one `seq_printf` after
  // another — so a file in another order was assembled by something else.
  const known = counters.filter((counter) => counter.field !== null).map((counter) => counter.name);
  const expected = FIELDS.map((field) => field.name).filter((name) => seen.has(name));

  return {
    counters,
    counts,
    unknown,
    missing: FIELDS.map((field) => field.name).filter((name) => !seen.has(name)),
    malformed,
    ordered: known.join(',') === expected.join(','),
    bytes,
  };
}

/** Whether the file held nothing at all. */
export function isEmpty(io: ProcessIo): boolean {
  return io.counters.length === 0 && io.malformed.length === 0;
}

/** Whether every counter is zero: a process that has genuinely done no I/O. */
export function isIdle(io: ProcessIo): boolean {
  return Object.values(io.counts).every((value) => value === 0);
}

/** Bytes through the two calls, which is what the program asked for. */
export function charTotal(io: ProcessIo): number {
  return io.counts.rchar + io.counts.wchar;
}

/** Bytes the storage layer was told about, which is what a disk would notice. */
export function blockTotal(io: ProcessIo): number {
  return io.counts.read_bytes + io.counts.write_bytes;
}

/**
 * Bytes read without a disk being touched: what the program asked for, less
 * what the block layer fetched.
 *
 * The page cache, mostly — and pipes, sockets, ttys and `/proc`, none of which
 * have a disk behind them at all. **Negative where readahead fetched more than
 * the program ever asked for**, which is a real state rather than a parse
 * error; {@link overRead} is the same fact the other way up.
 */
export function withoutDisk(io: ProcessIo): number {
  return io.counts.rchar - io.counts.read_bytes;
}

/** Whether the block layer fetched more than this process asked for. */
export function overRead(io: ProcessIo): boolean {
  return io.counts.read_bytes > io.counts.rchar;
}

/**
 * What this process really put on a disk: the bytes it promised, less the ones
 * it withdrew by throwing the dirty pages away.
 *
 * `write_bytes` is charged when a page is dirtied, so a program that writes a
 * megabyte to a temporary file and deletes it has a megabyte in `write_bytes`
 * that no disk ever saw. The truncate puts the same figure into
 * `cancelled_write_bytes` rather than subtracting it, so that both the promise
 * and the withdrawal stay visible — and this is the subtraction the file
 * deliberately does not do for you.
 */
export function reallyWritten(io: ProcessIo): number {
  return Math.max(0, io.counts.write_bytes - io.counts.cancelled_write_bytes);
}

/** Whether any promised write was withdrawn again. */
export function hasCancelled(io: ProcessIo): boolean {
  return io.counts.cancelled_write_bytes > 0;
}

/**
 * The share of promised writes that were withdrawn, or null where nothing was
 * promised. Approaching 1 is a process whose writes almost all went to files it
 * then deleted — a build, a test run, anything working through a scratch file.
 */
export function cancelledShare(io: ProcessIo): number | null {
  const { write_bytes: promised, cancelled_write_bytes: cancelled } = io.counts;
  return promised === 0 ? null : Math.min(1, cancelled / promised);
}

/**
 * Whether more was withdrawn than was ever promised, which the counters should
 * not be able to say. They are updated without a lock between them, so a small
 * excess is a race; a large one is a file that did not come from a kernel.
 */
export function overCancelled(io: ProcessIo): boolean {
  return io.counts.cancelled_write_bytes > io.counts.write_bytes;
}

/** Average bytes per `read()`, or null where none were made. */
export function averageRead(io: ProcessIo): number | null {
  return io.counts.syscr === 0 ? null : io.counts.rchar / io.counts.syscr;
}

/** Average bytes per `write()`, or null where none were made. */
export function averageWrite(io: ProcessIo): number | null {
  return io.counts.syscw === 0 ? null : io.counts.wchar / io.counts.syscw;
}

/**
 * Whether a block counter is not the round number its layer makes it: bios come
 * in whole sectors and dirty pages in whole pages. A counter that is neither
 * was reformatted on the way here.
 */
export function isUnaligned(io: ProcessIo): boolean {
  return (
    io.counts.read_bytes % SECTOR_SIZE !== 0 || io.counts.write_bytes % PAGE_SIZE !== 0
  );
}

/** The counters of one layer, in file order. */
export function inLayer(io: ProcessIo, layer: Layer): IoCounter[] {
  return io.counters.filter((counter) => counter.field?.layer === layer);
}

export interface IoSummary {
  /** Bytes through read() and write(). */
  asked: number;
  /** Bytes the storage layer was told about. */
  storage: number;
  /** Read without a disk — negative where readahead over-fetched. */
  cached: number;
  /** What really reached a disk, cancellations taken off. */
  written: number;
  /** Calls made, both directions. */
  calls: number;
  averageRead: number | null;
  averageWrite: number | null;
  idle: boolean;
  overRead: boolean;
  cancelled: boolean;
}

export function summarize(io: ProcessIo): IoSummary {
  return {
    asked: charTotal(io),
    storage: blockTotal(io),
    cached: withoutDisk(io),
    written: reallyWritten(io),
    calls: io.counts.syscr + io.counts.syscw,
    averageRead: averageRead(io),
    averageWrite: averageWrite(io),
    idle: isIdle(io),
    overRead: overRead(io),
    cancelled: hasCancelled(io),
  };
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** `1.4 GiB` — these counters run from nothing to terabytes on a long uptime. */
export function formatBytes(value: number): string {
  const sign = value < 0 ? '-' : '';
  let size = Math.abs(value);
  if (size === 0) return '0 B';

  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${sign}${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}

/** `632,687`, since a call count gets long enough to be misread. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** `61%`, for the share of writes withdrawn. */
export function formatShare(value: number): string {
  return `${Math.round(value * 100)}%`;
}
