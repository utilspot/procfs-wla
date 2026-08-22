/**
 * Parser for `/proc/scsi/sg/allow_dio`.
 *
 * One number, `sg_allow_dio`, printed as `"%d\n"` — and it is a **gate rather
 * than a switch**. Direct I/O is asked for per request: a program sets
 * {@link REQUEST_FLAG} on the command it sends, and only if this file is 1 does
 * the driver put the transfer into that program's own pages instead of copying
 * it through the descriptor's reserved buffer.
 *
 * So neither half is enough on its own, and **neither half fails loudly**. With
 * this at 0 a request asking for direct I/O still runs: it goes the copy way
 * and nothing says so at the time. What did happen comes back afterwards, in
 * the `info` field the header spells out — {@link INFO_MASK} over
 * {@link INFO_VALUES} — and that is the same bit `/proc/scsi/sg/debug` reads
 * when it prints `dio>>` beside a request. A machine where that prefix never
 * appears is usually this file, at its default.
 *
 * That default is 0 ({@link DEFAULT}), and there are three ways it can be
 * otherwise: the module parameter `sg.allow_dio=`, a write here — which wants
 * both `CAP_SYS_ADMIN` and `CAP_SYS_RAWIO` — and nothing else. A write is
 * **normalised**: anything not zero is stored as 1, so this file can only print
 * 0 or 1, and anything else in it came from somewhere this parser cannot
 * account for. See {@link isUnexpected}.
 */

/** What a program sets on a request to ask for direct I/O, from `<scsi/sg.h>`. */
export const REQUEST_FLAG = 'SG_FLAG_DIRECT_IO';

/** Where the answer comes back: `hp->info` masked with this. */
export const INFO_MASK = 'SG_INFO_DIRECT_IO_MASK';

/** The three answers that mask can hold, with the values the header gives them. */
export const INFO_VALUES = [
  { value: 0x0, name: 'SG_INFO_INDIRECT_IO', what: 'the data went through kernel buffers, or there was none to move' },
  { value: 0x2, name: 'SG_INFO_DIRECT_IO', what: 'direct I/O was asked for and done' },
  { value: 0x4, name: 'SG_INFO_MIXED_IO', what: 'part of it went directly and part through a buffer' },
];

/** `SG_ALLOW_DIO_DEF` — off, which is what nearly every machine reads. */
export const DEFAULT = 0;

/** What the module parameter is called, for the other way of setting it. */
export const MODULE_PARAM = 'sg.allow_dio=';

export interface AllowDio {
  /** The number as printed, which the write path only ever makes 0 or 1. */
  value: number;
  /** The line as it was read. */
  raw: string;
}

const VALUE = /^(\d+)$/;

/** Parses the file, or null for one that does not hold a single number. */
export function parseAllowDio(text: string): AllowDio | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length !== 1) return null;

  const match = VALUE.exec(lines[0]!.trim());
  if (match === null) return null;

  return { value: Number(match[1]), raw: lines[0]!.replace(/\s+$/, '') };
}

/** Whether direct I/O is permitted at all, which is the whole of the file. */
export function isAllowed(dio: AllowDio): boolean {
  return dio.value !== 0;
}

/** Whether it is at the value the driver starts with. */
export function isDefault(dio: AllowDio): boolean {
  return dio.value === DEFAULT;
}

/**
 * Whether the number is one the write path could not have stored: it normalises
 * anything not zero to 1, so a 2 here came from somewhere else — a module
 * parameter on an older driver, or a kernel that is not this one.
 */
export function isUnexpected(dio: AllowDio): boolean {
  return dio.value > 1;
}

export interface AllowDioSummary {
  value: number;
  allowed: boolean;
  isDefault: boolean;
  unexpected: boolean;
  /** What a request asking for direct I/O will actually get. */
  outcome: string;
}

export function summarize(dio: AllowDio): AllowDioSummary {
  const allowed = isAllowed(dio);

  return {
    value: dio.value,
    allowed,
    isDefault: isDefault(dio),
    unexpected: isUnexpected(dio),
    outcome: allowed
      ? 'a request that asks for direct I/O can get it'
      : 'a request that asks for direct I/O is copied through the reserved buffer instead, and is not told',
  };
}
