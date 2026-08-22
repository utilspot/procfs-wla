/**
 * Parser for `/proc/ioports`.
 *
 * The I/O port ranges drivers have claimed, one per line, as `start-end : name`:
 *
 *    0000-0cf7 : PCI Bus 0000:00
 *      0060-0060 : keyboard
 *      03f8-03ff : serial
 *
 * The kernel prints this with the same function as `/proc/iomem`, so the shape
 * is the same one: two spaces of indentation per level, a nested range being
 * carved **out of** the one above it, and both bounds **inclusive** — a range
 * covers `end - start + 1` ports. The parser is kept here rather than shared,
 * as each file in this app has its own, but the two do agree by descent.
 *
 * What is different is the space being described. I/O ports are a separate
 * 16-bit address space reached with `in` and `out` rather than by a load or a
 * store, so it is **65536 ports and no more** — a fixed budget small enough
 * that what is claimed and what is left are worth counting. Addresses are
 * printed in four hex digits because of it. See {@link PORT_SPACE}.
 *
 * Ports below `0x0400` are the block the original PC laid out — the interrupt
 * controllers, the timer, the keyboard, the serial and parallel ports — and
 * are still where those devices are found. See {@link isLegacy}.
 *
 * This is an x86 arrangement. An architecture with no I/O port space has an
 * empty file, which is not the same as one where nothing has been claimed, and
 * this parser says nothing about which of the two it is: an empty file simply
 * has no ranges in it.
 *
 * A reader without `CAP_SYS_ADMIN` gets every address replaced by zero rather
 * than the file refused, exactly as with `/proc/iomem` — see
 * {@link addressesHidden}.
 */

/** Ports in the space: it is 16 bits wide, and that is the whole budget. */
export const PORT_SPACE = 0x10000;

/** Ports below this are the block the original PC laid out. */
export const LEGACY_LIMIT = 0x0400;

/** Spaces the kernel indents one level of nesting by. */
export const INDENT = 2;

export interface IoportRange {
  start: number;
  /** Inclusive: the last port in the range, not the one after it. */
  end: number;
  name: string;
  /** Nesting level, 0 for a range that is not inside another. */
  depth: number;
}

export interface IoportsInfo {
  ranges: IoportRange[];
}

/** `  03f8-03ff : serial` */
const LINE = /^(\s*)([0-9a-f]+)-([0-9a-f]+)\s*:\s*(.*)$/i;

export function parseIoports(text: string): IoportsInfo {
  const ranges: IoportRange[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = LINE.exec(line);
    if (match === null) continue;

    const name = (match[4] ?? '').trim();
    if (name === '') continue;

    ranges.push({
      start: Number.parseInt(match[2] ?? '', 16),
      end: Number.parseInt(match[3] ?? '', 16),
      name,
      depth: Math.floor((match[1] ?? '').length / INDENT),
    });
  }

  return { ranges };
}

/** Ports the range covers, both bounds being inclusive. */
export function sizeOf(range: IoportRange): number {
  return range.end < range.start ? 0 : range.end - range.start + 1;
}

/** A port as the kernel writes it: hex, four digits. */
export function formatPort(port: number): string {
  return port.toString(16).padStart(4, '0');
}

/**
 * Whether the range lies entirely in the block the original PC laid out. A
 * range straddling `0x0400` is not claimed for it, since half of it is not.
 */
export function isLegacy(range: IoportRange): boolean {
  return range.end < LEGACY_LIMIT;
}

/**
 * Every port is zero, which is the kernel hiding them from a reader without
 * `CAP_SYS_ADMIN` rather than a machine whose ranges all sit at port zero.
 */
export function addressesHidden(info: IoportsInfo): boolean {
  return info.ranges.length > 0 && info.ranges.every((range) => range.start === 0 && range.end === 0);
}

/** The ranges nested inside no other. */
export function topLevel(info: IoportsInfo): IoportRange[] {
  return info.ranges.filter((range) => range.depth === 0);
}

/**
 * Ports claimed, counting the top-level ranges only: the nested ones are
 * pieces of the range above them, and adding those too would count the same
 * ports twice.
 *
 * Null when the addresses are hidden — a count taken from zeroes would be a
 * fiction, and zero would read as a machine that has claimed nothing.
 */
export function claimedPorts(info: IoportsInfo): number | null {
  if (addressesHidden(info)) return null;

  return topLevel(info).reduce((total, range) => total + sizeOf(range), 0);
}

/** Ports nothing has claimed, out of the 65536 there are. */
export function freePorts(info: IoportsInfo): number | null {
  const claimed = claimedPorts(info);
  return claimed === null ? null : Math.max(0, PORT_SPACE - claimed);
}

export interface IoportsSummary {
  ranges: number;
  topLevel: number;
  /** Null when the addresses are hidden, so nothing can be counted. */
  claimed: number | null;
  free: number | null;
  /** Ranges lying wholly in the block the original PC laid out. */
  legacy: IoportRange[];
  hidden: boolean;
  deepest: number;
}

export function summarize(info: IoportsInfo): IoportsSummary {
  const hidden = addressesHidden(info);

  return {
    ranges: info.ranges.length,
    topLevel: topLevel(info).length,
    claimed: claimedPorts(info),
    free: freePorts(info),
    legacy: hidden ? [] : info.ranges.filter((range) => isLegacy(range)),
    hidden,
    deepest: info.ranges.reduce((deepest, range) => Math.max(deepest, range.depth), 0),
  };
}
