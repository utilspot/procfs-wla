/**
 * Parser for `/proc/scsi/sg/def_reserved_size`.
 *
 * One number, `sg_big_buff`, printed by `sg_proc_seq_show_dressz` as `"%d\n"`:
 *
 *     32768
 *
 * It is the size in bytes of the **reserved buffer** a newly opened
 * `/dev/sg*` gets — memory the driver holds for that descriptor so a transfer
 * has somewhere to land without an allocation at command time. The number is a
 * *default*, and that is the whole of what this file is about: writing here
 * changes what the **next** open gets and nothing about a descriptor already
 * open. A program moves its own with the {@link SET_IOCTL} ioctl and reads it
 * back with {@link GET_IOCTL}, which is the only way to change one in flight.
 *
 * Three things set it, in this order:
 *
 * 1. **The compiled default**, {@link DEFAULT} — `SG_DEF_RESERVED_SIZE` in
 *    `include/scsi/sg.h`, which is spelled `SG_SCATTER_SZ`, which is spelled
 *    `{@link DEFAULT_SPELLING}`. Eight pages, as pages were when it was
 *    written; the header notes that `PAGE_SIZE` is *not available to user*, so
 *    the number is fixed at {@link DEFAULT} whatever this machine's pages are.
 * 2. **The module parameter**, `def_reserved_size`, taken at load.
 * 3. **This file**, at runtime — and the write path is the fussy one: it wants
 *    a process holding both `CAP_SYS_ADMIN` and `CAP_SYS_RAWIO`, and it refuses
 *    anything above {@link MAX_WRITABLE}, one megabyte, which is a limit on the
 *    *write* rather than on the value. A number larger than that is not
 *    impossible here — it is only impossible to have got here this way. See
 *    {@link isAboveWritableCeiling}.
 */

/** `SG_DEF_RESERVED_SIZE`, the size a driver with nothing said to it uses. */
export const DEFAULT = 32768;

/** How the header spells that number, which is where its shape comes from. */
export const DEFAULT_SPELLING = '8 * 4096';

/** The largest value the write path will take: one megabyte, hard-coded. */
export const MAX_WRITABLE = 1048576;

/** What a program calls to move its own descriptor's reserve. */
export const SET_IOCTL = 'SG_SET_RESERVED_SIZE';

/** And to read back what it actually got, which need not be what it asked for. */
export const GET_IOCTL = 'SG_GET_RESERVED_SIZE';

export interface ReservedSize {
  /** The bytes, as printed. */
  bytes: number;
  /** The line as it was read. */
  raw: string;
}

/** One number on one line, and nothing else in the file. */
const VALUE = /^(\d+)$/;

/** Parses the file, or null for one that does not hold a single number. */
export function parseDefReservedSize(text: string): ReservedSize | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length !== 1) return null;

  const match = VALUE.exec(lines[0]!.trim());
  if (match === null) return null;

  return { bytes: Number(match[1]), raw: lines[0]!.replace(/\s+$/, '') };
}

/** Whether this is the size the driver starts with, nothing having said otherwise. */
export function isDefault(size: ReservedSize): boolean {
  return size.bytes === DEFAULT;
}

/**
 * Whether the value is larger than the write path would have taken, which means
 * it did not come from this file: the module parameter is not clamped, and an
 * older driver may not have been either.
 */
export function isAboveWritableCeiling(size: ReservedSize): boolean {
  return size.bytes > MAX_WRITABLE;
}

/**
 * Whether the driver keeps no reserve at all, which is allowed: every transfer
 * then finds its memory when the command is made rather than when the
 * descriptor is opened.
 */
export function isZero(size: ReservedSize): boolean {
  return size.bytes === 0;
}

/** The value against the default, as a ratio — 1 where it has not been touched. */
export function timesDefault(size: ReservedSize): number {
  return size.bytes / DEFAULT;
}

/** Bytes in the units a reader thinks in, which for these sizes is KiB and MiB. */
export function formatBytes(value: number): string {
  if (value === 0) return '0';
  if (value % (1024 * 1024) === 0) return `${value / (1024 * 1024)} MiB`;
  if (value % 1024 === 0) return `${value / 1024} KiB`;
  return `${value} B`;
}

/** How many whole 4 KiB pages the value is, which is how the default was chosen. */
export function pagesOf(value: number, pageSize = 4096): number {
  return value / pageSize;
}

export interface ReservedSizeSummary {
  bytes: number;
  /** The same in KiB or MiB, for a reader. */
  readable: string;
  isDefault: boolean;
  isZero: boolean;
  aboveCeiling: boolean;
  /** How it compares with the compiled default. */
  timesDefault: number;
  /** Whole 4 KiB pages, or null where it is not a whole number of them. */
  pages: number | null;
}

export function summarize(size: ReservedSize): ReservedSizeSummary {
  const pages = pagesOf(size.bytes);

  return {
    bytes: size.bytes,
    readable: formatBytes(size.bytes),
    isDefault: isDefault(size),
    isZero: isZero(size),
    aboveCeiling: isAboveWritableCeiling(size),
    timesDefault: timesDefault(size),
    pages: Number.isInteger(pages) ? pages : null,
  };
}
