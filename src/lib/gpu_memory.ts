/**
 * Parser for `/proc/gpu_memory`.
 *
 * The other half of what the Mali `kbase` driver publishes about itself — see
 * `src/lib/gpu_load.ts` for the first, which is time rather than memory. Like
 * it, this is a **vendor file**: nothing in mainline Linux creates it, `mali0`
 * is the driver's device, and a machine without that driver has no such entry.
 *
 * A device line, a column header, and a line per process holding GPU memory:
 *
 *     mali0                  40318
 *       TGID        PID       PAGE_NUM
 *          19561      19561       4593
 *          11665      11688        108
 *          11620      11620      33459
 *           8043       8251       2158
 *
 * The columns are right-aligned into a width nothing else here uses, which is
 * the only reason the file looks like a table rather than three numbers a line.
 *
 * **Everything is counted in pages, and the file does not say how big one is.**
 * `PAGE_NUM` is a count, and the device's number is one too — the bytes on this
 * page are worked out at {@link PAGE_SIZE}, which is what a Mali driver
 * allocates in, and are marked as the derived figure they are. A kernel built
 * with 16K or 64K pages would make every byte figure here wrong by that factor
 * while every page count stayed right, which is why the count is the column and
 * the size is beside it.
 *
 * Two things to know, one of them the opposite of the load file's:
 *
 *  - **The device line usually is the total of the rows**, unlike
 *    `/proc/gpu_load`, where the two counters are kept separately. Here they
 *    are the same accounting seen twice, so a difference means pages the driver
 *    holds that no process's row claims — see {@link unaccounted}. Neither is
 *    assumed: the sum is worked out and compared.
 *  - **`TGID` and `PID` are not the same column twice.** As in the load file,
 *    `TGID` is the process and `PID` is the thread inside it that opened the
 *    device, so a row where they differ belongs to a thread rather than to a
 *    second process. See {@link isThread}.
 */

/**
 * Bytes in a page, for turning the counts into sizes.
 *
 * The file says pages and never says this, so it is an assumption rather than a
 * reading: 4 KiB is what a Mali driver allocates in. Every byte figure this
 * module returns is that assumption applied, and the page counts are what the
 * file actually holds.
 */
export const PAGE_SIZE = 4096;

/** The first line: the device, and the pages it is holding altogether. */
export interface GpuMemoryDevice {
  /** What the driver calls it, `mali0`. */
  name: string;
  pages: number;
}

/** One line under the header: a process, and the pages its rows account for. */
export interface GpuMemoryProcess {
  /** The process holding the memory. */
  tgid: number;
  /** The thread inside it that opened the device. */
  pid: number;
  pages: number;
}

export interface GpuMemory {
  /** Null in a file with no device line, which is not a file of this kind. */
  device: GpuMemoryDevice | null;
  processes: GpuMemoryProcess[];
}

/** `mali0                  40318` */
const DEVICE = /^(\S+)\s+(\d+)\s*$/;

/** `     19561      19561       4593` — three numbers, and nothing else. */
const PROCESS = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/;

/** The line naming the columns, which matches neither of the two above. */
const HEADER = /^\s*TGID\s+PID\s+PAGE_NUM\b/i;

export function parseGpuMemory(text: string): GpuMemory {
  let device: GpuMemoryDevice | null = null;
  const processes: GpuMemoryProcess[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '' || HEADER.test(line)) continue;

    const row = PROCESS.exec(line);
    if (row !== null) {
      processes.push({ tgid: Number(row[1]), pid: Number(row[2]), pages: Number(row[3]) });
      continue;
    }

    const gpu = DEVICE.exec(line);
    // The first one wins: a second device line would be another device, and
    // this file is one driver's.
    if (gpu !== null) device ??= { name: gpu[1]!, pages: Number(gpu[2]) };
  }

  return { device, processes };
}

/** A count of pages as the bytes it stands for, at {@link PAGE_SIZE}. */
export function bytes(pages: number): number {
  return pages * PAGE_SIZE;
}

/**
 * Whether the thread that opened the device is not the process's main one,
 * which is what `TGID` differing from `PID` means.
 */
export function isThread(entry: GpuMemoryProcess): boolean {
  return entry.tgid !== entry.pid;
}

/** Pages claimed by the rows, which is what the device line is usually holding. */
export function accounted(memory: GpuMemory): number {
  return memory.processes.reduce((total, entry) => total + entry.pages, 0);
}

/**
 * Pages the device is holding that no row claims — the driver's own, or a
 * process gone since the counts were taken.
 *
 * Zero where the two agree, which is the ordinary case, and **negative is
 * possible**: rows claiming more than the device says it holds is what a file
 * read while allocations were moving can print, and is reported rather than
 * clamped away.
 */
export function unaccounted(memory: GpuMemory): number | null {
  if (memory.device === null) return null;
  return memory.device.pages - accounted(memory);
}

/** Whether the rows add up to exactly what the device line says. */
export function matchesDevice(memory: GpuMemory): boolean {
  return unaccounted(memory) === 0;
}

/**
 * A row's share of what the device is holding, from 0 to 1 — null where the
 * device holds nothing, which is a share of nothing rather than a zero.
 */
export function share(entry: GpuMemoryProcess, device: GpuMemoryDevice): number | null {
  return device.pages === 0 ? null : entry.pages / device.pages;
}

/** The rows by the memory each holds, largest first. */
export function byPages(memory: GpuMemory): GpuMemoryProcess[] {
  return [...memory.processes].sort((a, b) => b.pages - a.pages || a.tgid - b.tgid);
}

export interface GpuMemorySummary {
  rows: number;
  /** Processes behind them, which is fewer where one holds several rows. */
  processes: number;
  /** Rows belonging to a thread rather than to the process's main one. */
  threads: number;
  /** Pages the rows claim, and the same as bytes. */
  pages: number;
  /** The row holding the most, or null where there are none. */
  largest: GpuMemoryProcess | null;
}

export function summarize(memory: GpuMemory): GpuMemorySummary {
  return {
    rows: memory.processes.length,
    processes: new Set(memory.processes.map((entry) => entry.tgid)).size,
    threads: memory.processes.filter(isThread).length,
    pages: accounted(memory),
    largest: byPages(memory)[0] ?? null,
  };
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** Binary units, since these are pages of memory rather than a disk capacity. */
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

/** `94%`, and `<1%` for a share that is not quite nothing. */
export function formatShare(value: number): string {
  if (value === 0) return '0%';
  if (value >= 0.995) return '100%';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
