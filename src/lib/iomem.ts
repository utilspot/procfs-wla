/**
 * Parser for `/proc/iomem`.
 *
 * The physical address map, one range per line, as `start-end : name`:
 *
 *    00100000-09afffff : System RAM
 *      01000000-01e00fff : Kernel code
 *    fed00000-fed003ff : HPET 0
 *
 * Indentation is structure, two spaces per level: a nested line is a range
 * **carved out of the one above it**, so `Kernel code` is part of that `System
 * RAM` range rather than another region beside it. Anything totting up memory
 * has to count the top level only, or it counts the same bytes twice — see
 * {@link systemRamBytes}.
 *
 * Both bounds are **inclusive**, so a range covers `end - start + 1` bytes and
 * `00000000-00000fff` is 4 KiB rather than 4095 bytes. See {@link sizeOf}.
 *
 * Addresses are printed zero-padded to at least 8 hex digits, and a machine
 * with memory above 4 GiB simply prints more of them. They are parsed as
 * numbers, which is exact below 2^53 — a physical address space no machine
 * comes close to.
 *
 * A reader without `CAP_SYS_ADMIN` gets every address replaced by zero rather
 * than being refused the file, so the map arrives with its shape and names
 * intact and nothing else. That is a different thing from an empty map, and
 * {@link addressesHidden} is what tells them apart.
 */

/** Spaces the kernel indents one level of nesting by. */
export const INDENT = 2;

/** The name the kernel gives the ranges that hold usable memory. */
export const SYSTEM_RAM = 'System RAM';

export interface IomemRegion {
  start: number;
  /** Inclusive: the last address in the range, not the one after it. */
  end: number;
  name: string;
  /** Nesting level, 0 for a range that is not inside another. */
  depth: number;
}

export interface IomemInfo {
  regions: IomemRegion[];
}

/** `  000f0000-000fffff : System ROM` */
const LINE = /^(\s*)([0-9a-f]+)-([0-9a-f]+)\s*:\s*(.*)$/i;

export function parseIomem(text: string): IomemInfo {
  const regions: IomemRegion[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = LINE.exec(line);
    if (match === null) continue;

    const name = (match[4] ?? '').trim();
    if (name === '') continue;

    regions.push({
      start: Number.parseInt(match[2] ?? '', 16),
      end: Number.parseInt(match[3] ?? '', 16),
      name,
      depth: Math.floor((match[1] ?? '').length / INDENT),
    });
  }

  return { regions };
}

/** Bytes the range covers, both bounds being inclusive. */
export function sizeOf(region: IomemRegion): number {
  return region.end < region.start ? 0 : region.end - region.start + 1;
}

/** An address as the kernel writes it: hex, zero-padded to at least 8 digits. */
export function formatAddress(address: number): string {
  return address.toString(16).padStart(8, '0');
}

/** Usable memory, as opposed to firmware or a device's registers. */
export function isRam(region: IomemRegion): boolean {
  return region.name === SYSTEM_RAM;
}

/**
 * Every address is zero, which is the kernel hiding them from a reader without
 * `CAP_SYS_ADMIN` rather than a machine whose memory starts and ends nowhere.
 * An empty file is not this: there is nothing to hide in it.
 */
export function addressesHidden(info: IomemInfo): boolean {
  return (
    info.regions.length > 0 &&
    info.regions.every((region) => region.start === 0 && region.end === 0)
  );
}

/**
 * Usable memory, counting the top-level ranges only. The nested lines are
 * pieces of the range above them — the kernel image sits inside `System RAM` —
 * so adding everything named `System RAM` at every depth would count those
 * bytes twice.
 *
 * Zero when the addresses are hidden, since a size worked out from zeroes
 * would be a fiction.
 */
export function systemRamBytes(info: IomemInfo): number {
  if (addressesHidden(info)) return 0;

  return info.regions
    .filter((region) => region.depth === 0 && isRam(region))
    .reduce((total, region) => total + sizeOf(region), 0);
}

/** The highest address the map reaches, or null when there is nothing in it. */
export function topAddress(info: IomemInfo): number | null {
  if (info.regions.length === 0) return null;
  return Math.max(...info.regions.map((region) => region.end));
}

/** The regions nested inside no other. */
export function topLevel(info: IomemInfo): IomemRegion[] {
  return info.regions.filter((region) => region.depth === 0);
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** Binary units, since this is address space rather than a disk capacity. */
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

export interface IomemSummary {
  regions: number;
  topLevel: number;
  /** Usable memory across the top-level `System RAM` ranges. */
  ramBytes: number;
  /** Those ranges themselves, in the order the map lists them. */
  ram: IomemRegion[];
  /** True when the file was read without the privilege to see addresses. */
  hidden: boolean;
  topAddress: number | null;
  deepest: number;
}

export function summarize(info: IomemInfo): IomemSummary {
  const hidden = addressesHidden(info);

  return {
    regions: info.regions.length,
    topLevel: topLevel(info).length,
    ramBytes: systemRamBytes(info),
    ram: topLevel(info).filter((region) => isRam(region)),
    hidden,
    topAddress: hidden ? null : topAddress(info),
    deepest: info.regions.reduce((deepest, region) => Math.max(deepest, region.depth), 0),
  };
}
