/**
 * Parser for `/proc/loadavg`.
 *
 * One line, six fields:
 *
 *    0.52 0.44 0.39 2/1234 5678
 *
 * The three load averages over one, five and fifteen minutes; the number of
 * threads **runnable right now** over the number that exist; and the last PID
 * the kernel handed out.
 *
 * Two things about the load average are worth knowing before reading it.
 *
 * On Linux it counts tasks in **uninterruptible sleep** as well as runnable
 * ones — the `D` state, usually waiting on disk or on a network filesystem —
 * where other Unixes count only what is competing for CPU. A load of 8 on this
 * machine may be eight things wanting the processor, or one thing running and
 * seven blocked on a slow disk, and the number alone cannot tell you which.
 * The runnable count in the same line is the nearest thing to a hint: it counts
 * only what is on a run queue, so a load well above it suggests the rest are
 * sleeping uninterruptibly. That comparison is a hint and no more — one figure
 * is an average over a minute, the other an instant — see {@link excessOverRunnable}.
 *
 * And the figures are **exponentially damped moving averages**, not means over
 * the window: the one-minute figure has most of a minute's weight in it but
 * never entirely forgets what came before. Comparing the three is therefore
 * the way to read a direction out of them — see {@link trendOf}.
 *
 * What the file cannot tell you is how many CPUs the machine has, which is
 * what a load figure has to be read against. Nothing here judges whether a
 * load is high; `/proc/cpuinfo` is where the other half of that comes from.
 */

/**
 * How far the one and fifteen minute figures may differ before the load counts
 * as moving: the larger of this and {@link TREND_SHARE} of the longer average.
 * A judgement for reading the page, not anything the kernel says.
 *
 * The floor is what keeps an idle machine quiet — drifting from 0.22 to 0.12
 * is a tenth of one CPU and no sort of direction — while the relative part is
 * what matters once the load is large enough for a tenth to be nothing.
 */
export const TREND_FLOOR = 0.15;

/** Relative part of the same judgement. */
export const TREND_SHARE = 0.1;

export interface LoadAvg {
  /** Load averaged over one minute. */
  one: number;
  five: number;
  fifteen: number;
  /** Threads on a run queue at the moment the file was read. */
  runnable: number;
  /** Threads that exist. */
  threads: number;
  /** The most recent PID the kernel allocated in this namespace. */
  lastPid: number;
}

export interface LoadAvgInfo {
  load: LoadAvg | null;
}

/** `0.52 0.44 0.39 2/1234 5678` */
const LINE = /^(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+)\/(\d+)\s+(\d+)\s*$/;

export function parseLoadAvg(text: string): LoadAvgInfo {
  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match === null) continue;

    return {
      load: {
        one: Number(match[1]),
        five: Number(match[2]),
        fifteen: Number(match[3]),
        runnable: Number(match[4]),
        threads: Number(match[5]),
        lastPid: Number(match[6]),
      },
    };
  }

  return { load: null };
}

export type Trend = 'rising' | 'falling' | 'steady';

/**
 * Which way the load is going, from the one-minute figure against the
 * fifteen-minute one. Steady covers a difference too small to read anything
 * into, which is a judgement about presentation rather than a kernel fact.
 */
export function trendOf(load: LoadAvg): Trend {
  const difference = load.one - load.fifteen;
  const tolerance = Math.max(TREND_FLOOR, load.fifteen * TREND_SHARE);

  if (Math.abs(difference) <= tolerance) return 'steady';
  return difference > 0 ? 'rising' : 'falling';
}

/** Share of the machine's threads that are on a run queue, or null if none exist. */
export function runnableShare(load: LoadAvg): number | null {
  return load.threads === 0 ? null : load.runnable / load.threads;
}

/**
 * How far the one-minute average sits above the runnable count. Positive means
 * the load is made up of more than what is competing for CPU right now, which
 * on Linux usually means tasks in uninterruptible sleep.
 *
 * It is a hint, not a measurement: an average over a minute is being compared
 * with a count taken at one instant, and a load that has just fallen away will
 * show the same thing.
 */
export function excessOverRunnable(load: LoadAvg): number {
  return load.one - load.runnable;
}

/** The threads that exist but are not runnable: asleep, stopped or a zombie. */
export function notRunnable(load: LoadAvg): number {
  return Math.max(0, load.threads - load.runnable);
}

/** The load figures as the kernel prints them, to two places. */
export function formatLoad(value: number): string {
  return value.toFixed(2);
}

export interface LoadAvgSummary {
  load: LoadAvg;
  trend: Trend;
  runnableShare: number | null;
  excess: number;
}

export function summarize(info: LoadAvgInfo): LoadAvgSummary | null {
  if (info.load === null) return null;

  return {
    load: info.load,
    trend: trendOf(info.load),
    runnableShare: runnableShare(info.load),
    excess: excessOverRunnable(info.load),
  };
}
