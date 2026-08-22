/**
 * Parser for `/proc/gpu_load`.
 *
 * A **vendor file**, not one of the kernel's own: nothing in mainline Linux
 * creates it, and the name `mali0` on its first line is the Mali `kbase`
 * driver's device — the same `mali0` that `/dev/mali0` is. A machine without
 * that driver has no such file, and the page reports the 404 the backend gives
 * it.
 *
 * Three lines of shape, and then a line per GPU context:
 *
 *     mali0: 395061345792 535991866112
 *     id tgid pid total_active_duration_ns total_inactive_duration_ns
 *     0 0 0 21527740 0
 *     12 19561 19561 6239059548 39737130276
 *     2 11620 11620 5845115345720 6467620158574
 *
 * The first line is **the device**: its name, and how long it has been active
 * and inactive. The second names the columns of everything under it, and each
 * line after that is one context — a `kbase` context, which is what a process
 * gets when it opens the device — with the same two durations of its own.
 *
 * Everything is in **nanoseconds**, which the column names say and the device
 * line does not: the numbers are large enough that reading them as anything
 * else gives an answer that looks plausible and is out by a factor of a
 * thousand or a billion. What they are useful for is the ratio between them —
 * see {@link utilization} — since active plus inactive is the span the counter
 * has been running, not a wall clock anyone chose.
 *
 * Two things read wrong at first glance:
 *
 *  - **The device line is not the total of the rows.** In the capture above the
 *    contexts add up to hours against the device's fifteen minutes. The two are
 *    counted separately — one per device and one per context, each starting
 *    whenever that thing did — so neither is a breakdown of the other, and this
 *    module keeps them apart rather than checking one against the other. See
 *    {@link exceedsDevice}.
 *  - **`tgid` and `pid` are not the same column twice.** `tgid` is the process
 *    and `pid` is the thread inside it that opened the device, so a row where
 *    they differ is a context belonging to a thread rather than to the main one
 *    — and two rows with the same `tgid` are one process holding two contexts.
 *    See {@link isThread}.
 *
 * The row with `id`, `tgid` and `pid` all zero is the driver's own context
 * rather than any process's, and it is usually the one with **no inactive time
 * at all** — which makes its share of the GPU 100% while meaning nothing of the
 * sort. See {@link isKernelContext} and {@link hasNoIdle}.
 */

/** The first line: the device, and the two durations it keeps for itself. */
export interface GpuDevice {
  /** What the driver calls it, `mali0`. */
  name: string;
  /** Nanoseconds the device has been active. */
  active: number;
  /** And inactive, which with the above is the span the counter has run. */
  inactive: number;
}

/** One line under the header: a context, and the two durations it keeps. */
export interface GpuContext {
  /** The driver's own id for the context, unique while it is open. */
  id: number;
  /** The process that holds it. */
  tgid: number;
  /** The thread inside that process which opened the device. */
  pid: number;
  active: number;
  inactive: number;
}

export interface GpuLoad {
  /** Null in a file with no device line, which is not a file of this kind. */
  device: GpuDevice | null;
  contexts: GpuContext[];
}

/** `mali0: 395061345792 535991866112` */
const DEVICE = /^(\S+):\s+(\d+)\s+(\d+)\s*$/;

/** `0 0 0 21527740 0` — five numbers, and nothing else on the line. */
const CONTEXT = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/;

/** The line naming the columns, which is skipped by not matching either of them. */
const HEADER = /^\s*id\s+tgid\s+pid\b/;

export function parseGpuLoad(text: string): GpuLoad {
  let device: GpuDevice | null = null;
  const contexts: GpuContext[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '' || HEADER.test(line)) continue;

    const gpu = DEVICE.exec(line);
    if (gpu !== null) {
      // The first one wins: a second device line would be another device, and
      // this file is one driver's.
      device ??= { name: gpu[1]!, active: Number(gpu[2]), inactive: Number(gpu[3]) };
      continue;
    }

    const context = CONTEXT.exec(line);
    if (context === null) continue;

    contexts.push({
      id: Number(context[1]),
      tgid: Number(context[2]),
      pid: Number(context[3]),
      active: Number(context[4]),
      inactive: Number(context[5]),
    });
  }

  return { device, contexts };
}

/** Active plus inactive: the span the counter behind a row has been running. */
export function span(entry: GpuDevice | GpuContext): number {
  return entry.active + entry.inactive;
}

/**
 * Share of its span a device or context has been active, from 0 to 1 — null
 * where the counter has never run at all, which is a share of nothing rather
 * than a zero.
 */
export function utilization(entry: GpuDevice | GpuContext): number | null {
  const total = span(entry);
  return total === 0 ? null : entry.active / total;
}

/**
 * The driver's own context rather than any process's: id, tgid and pid all
 * zero, since there is no process 0 to hold one.
 */
export function isKernelContext(context: GpuContext): boolean {
  return context.id === 0 && context.tgid === 0 && context.pid === 0;
}

/**
 * Whether the thread that opened the device is not the process's main one,
 * which is what `tgid` differing from `pid` means.
 */
export function isThread(context: GpuContext): boolean {
  return context.tgid !== context.pid;
}

/**
 * Whether a row has no inactive time at all, which makes {@link utilization}
 * 100% without the thing having pegged anything: nothing has been counted
 * against it, so there is nothing for the share to be a share of.
 */
export function hasNoIdle(entry: GpuDevice | GpuContext): boolean {
  return entry.inactive === 0 && entry.active > 0;
}

/**
 * Whether the contexts have been active for longer than the device has, which
 * is ordinary rather than a fault: the two counters are kept separately and
 * start whenever the thing they belong to did.
 */
export function exceedsDevice(load: GpuLoad): boolean {
  if (load.device === null) return false;
  return contextActive(load) > load.device.active;
}

/** Nanoseconds every context has been active, summed. */
export function contextActive(load: GpuLoad): number {
  return load.contexts.reduce((total, context) => total + context.active, 0);
}

/** The contexts by how long they have been active, longest first. */
export function byActive(load: GpuLoad): GpuContext[] {
  return [...load.contexts].sort((a, b) => b.active - a.active || a.id - b.id);
}

export interface GpuLoadSummary {
  contexts: number;
  /** Processes holding them, which is fewer where one holds several. */
  processes: number;
  /** Contexts opened by a thread rather than by the process's main one. */
  threads: number;
  /** Nanoseconds every context has been active, summed. */
  active: number;
  /** The context that has been active longest, or null where there are none. */
  busiest: GpuContext | null;
}

export function summarize(load: GpuLoad): GpuLoadSummary {
  // The driver's own context belongs to no process, so it is not counted as one.
  const processes = new Set(
    load.contexts.filter((context) => !isKernelContext(context)).map((context) => context.tgid),
  );

  return {
    contexts: load.contexts.length,
    processes: processes.size,
    threads: load.contexts.filter(isThread).length,
    active: contextActive(load),
    busiest: byActive(load).find((context) => !isKernelContext(context)) ?? null,
  };
}

/** Nanoseconds as seconds, which is what the `_ns` column names are counted in. */
export function nsToSeconds(nanoseconds: number): number {
  return nanoseconds / 1e9;
}

/** `2.44 s`, `12m 30s`, `3h 4m` — a duration at the units that say something. */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 0)} s`;

  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${whole % 60}s`;
}

/** `94%`, and `<1%` for a share that is not quite nothing. */
export function formatShare(value: number): string {
  if (value === 0) return '0%';
  if (value >= 0.995) return '100%';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
