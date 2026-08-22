/**
 * Parser for `/proc/<pid>/schedstat` — what the scheduler has given one task,
 * and what it has made it wait for.
 *
 * Not `/proc/schedstat`, the machine's per-CPU counters, which
 * `src/lib/schedstat.ts` reads. Three numbers on one line:
 *
 *     284119402118 18402118004 4281002
 *
 * `proc_pid_schedstat` prints `task->se.sum_exec_runtime`,
 * `task->sched_info.run_delay` and `task->sched_info.pcount` — **time on a
 * CPU**, **time runnable and not on one**, and **how many times it was put on
 * one**. The first two are nanoseconds; the third is a count.
 *
 * Five things it is read wrong for:
 *
 *  - **The second number is the one worth reading, and it is the one nobody
 *    looks at.** `run_delay` is time this task was *ready to run and did not
 *    get a CPU* — not blocked, not sleeping, just queued behind something else.
 *    It is the direct measure of whether a machine is oversubscribed, and it
 *    answers a question no amount of staring at the first number can. See
 *    {@link waitShare}.
 *  - **`0 0 0` is two different answers.** `proc_pid_schedstat` prints that
 *    line literally when `sched_info_on()` is false, so it means either "this
 *    task has never run" or "**this kernel is not collecting**" — and since
 *    Linux 4.6 the collecting is a runtime switch, `kernel.sched_schedstats`,
 *    which is off by default on some distributions. The tell is another
 *    process: if every task on the machine reads `0 0 0`, it is the switch.
 *    See {@link isAllZero}.
 *  - **These are nanoseconds, and `/proc/<pid>/stat` is not.** That file's
 *    `utime` and `stime` are clock ticks, accounted at the tick or by the
 *    cputime code; this is the scheduler's own total at nanosecond precision,
 *    kept by a different mechanism. They measure nearly the same thing and do
 *    not have to agree, so a difference between them is not a fault in either.
 *  - **It is one task, and the process file is its main thread.** The counters
 *    hang off the one `task_struct` the pid resolves to, which for
 *    `/proc/<pid>/` is the group leader — so like `/proc/<pid>/time_in_state`
 *    and unlike `/proc/<pid>/io`, this **does not sum a process's threads**.
 *    A worker pool's time is under `/proc/<pid>/task/<tid>/schedstat`.
 *  - **The third number is not context switches.** `pcount` counts the times
 *    this task was scheduled *onto* a CPU, so it says how the runtime was
 *    broken up rather than how often the machine switched. Divided into the
 *    first it gives the average slice; divided into the second, the average
 *    wait per slice — which is the same figure `/proc/schedstat` reports per
 *    CPU, and so the one to compare against it. See {@link averageWaitNs}.
 *
 * The file is mode 0444 and needs `CONFIG_SCHEDSTATS`. Every counter is
 * cumulative from the task's first instruction and never goes down.
 */

/** What the kernel prints, verbatim, when it is not collecting any of this. */
export const DISABLED = '0 0 0';

/** The sysctl that turns the collecting on and off at runtime, since Linux 4.6. */
export const SWITCH = 'kernel.sched_schedstats';

/** One of the three, and what it counts. */
export interface SchedStatField {
  name: string;
  /** 1-based column, since this file is read by position. */
  column: number;
  label: string;
  /** Nanoseconds, or a plain count. */
  unit: 'ns' | 'count';
  what: string;
}

export const FIELDS: readonly SchedStatField[] = [
  {
    name: 'sum_exec_runtime',
    column: 1,
    label: 'time on a CPU',
    unit: 'ns',
    what: 'Nanoseconds this task has actually spent running. The scheduler’s own total, kept at far finer grain than the clock ticks /proc/<pid>/stat reports — and by a different mechanism, so the two need not agree exactly.',
  },
  {
    name: 'run_delay',
    column: 2,
    label: 'time waiting for a CPU',
    unit: 'ns',
    what: 'Nanoseconds this task was runnable and did not have a CPU: not blocked, not asleep, queued behind something else. This is the number that says whether the machine is oversubscribed.',
  },
  {
    name: 'pcount',
    column: 3,
    label: 'times put on a CPU',
    unit: 'count',
    what: 'How many times the scheduler placed this task on a CPU — timeslices, not context switches. It says how the runtime above was broken up, and it is what turns the other two into averages.',
  },
];

export interface TaskSchedStat {
  /** The file exactly as it was read. */
  raw: string;
  /** What it held, with the newline off. */
  value: string;
  /** Whether that is the line of numbers this file is. */
  readable: boolean;
  /** Nanoseconds on a CPU. */
  runtimeNs: number;
  /** Nanoseconds runnable and waiting for one. */
  waitNs: number;
  /** Times it was put on a CPU. */
  slices: number;
  /** Numbers past the third, which this file does not have. */
  extra: number[];
  /** Whether all three were there. */
  complete: boolean;
  /** Whether the file ended with the newline the kernel writes. */
  terminated: boolean;
  bytes: number;
}

/** `284119402118 18402118004 4281002` — three unsigned numbers and nothing else. */
const LINE = /^\d+(?:\s+\d+)*$/;

export function parsePidSchedStat(text: string): TaskSchedStat {
  const bytes = new TextEncoder().encode(text).length;
  const terminated = text.endsWith('\n');
  const value = text.trim();
  const readable = value !== '' && LINE.test(value);
  const numbers = readable ? value.split(/\s+/).map(Number) : [];

  return {
    raw: text,
    value,
    readable,
    runtimeNs: numbers[0] ?? 0,
    waitNs: numbers[1] ?? 0,
    slices: numbers[2] ?? 0,
    extra: numbers.slice(FIELDS.length),
    complete: numbers.length >= FIELDS.length,
    terminated,
    bytes,
  };
}

/** Whether there was nothing in the file at all. */
export function isEmpty(stat: TaskSchedStat): boolean {
  return stat.value === '';
}

/** Whether it held something that is not this file's line of numbers. */
export function isUnreadable(stat: TaskSchedStat): boolean {
  return !stat.readable && !isEmpty(stat);
}

/**
 * Whether every counter is zero — which the kernel prints both for a task that
 * has never run and for a kernel that is not collecting. The file cannot tell
 * them apart; another process on the same machine can. See {@link DISABLED}.
 */
export function isAllZero(stat: TaskSchedStat): boolean {
  return stat.readable && stat.runtimeNs === 0 && stat.waitNs === 0 && stat.slices === 0;
}

/** Nanoseconds this task has wanted a CPU for, running or queued. */
export function wantedNs(stat: TaskSchedStat): number {
  return stat.runtimeNs + stat.waitNs;
}

/**
 * Of the time this task wanted a CPU, the share it spent waiting for one — 0 to
 * 1, or null where it has never wanted one at all.
 *
 * The figure the second column exists for. Note it is **not** the machine
 * page's `waitRatio`, which is wait over *run*: this one is bounded by 1 and
 * reads as a percentage, and the two are not to be compared without converting.
 */
export function waitShare(stat: TaskSchedStat): number | null {
  const wanted = wantedNs(stat);
  return wanted === 0 ? null : stat.waitNs / wanted;
}

/** Average nanoseconds this task ran each time it was put on a CPU. */
export function averageSliceNs(stat: TaskSchedStat): number | null {
  return stat.slices === 0 ? null : stat.runtimeNs / stat.slices;
}

/**
 * Average nanoseconds it waited before each of those turns — the same figure
 * `/proc/schedstat` gives per CPU, so it is the one to hold against that file.
 */
export function averageWaitNs(stat: TaskSchedStat): number | null {
  return stat.slices === 0 ? null : stat.waitNs / stat.slices;
}

/**
 * Share of wanted-CPU time spent waiting past which the page says so.
 *
 * There is no kernel threshold to borrow — nothing fails at any level. A task
 * losing a quarter of its time to the queue is where the number stops being
 * background noise and starts being the answer to why something is slow.
 */
export const CONTENDED = 0.25;

/** Whether this task is losing enough time to the runqueue to be worth saying. */
export function isContended(stat: TaskSchedStat): boolean {
  const share = waitShare(stat);
  return share !== null && share >= CONTENDED;
}

/**
 * Slice length below which a task is waking far more often than it is working.
 * A hundred microseconds is a few thousand instructions' worth of CPU for the
 * cost of a scheduling decision either side of it.
 */
export const SHORT_SLICE_NS = 100_000;

/** Whether this task's turns are so short that the scheduling dominates them. */
export function isChatty(stat: TaskSchedStat): boolean {
  const slice = averageSliceNs(stat);
  return slice !== null && stat.slices > 0 && slice < SHORT_SLICE_NS;
}

export interface SchedStatSummary {
  runtimeNs: number;
  waitNs: number;
  slices: number;
  waitShare: number | null;
  averageSliceNs: number | null;
  averageWaitNs: number | null;
  allZero: boolean;
  contended: boolean;
}

export function summarize(stat: TaskSchedStat): SchedStatSummary {
  return {
    runtimeNs: stat.runtimeNs,
    waitNs: stat.waitNs,
    slices: stat.slices,
    waitShare: waitShare(stat),
    averageSliceNs: averageSliceNs(stat),
    averageWaitNs: averageWaitNs(stat),
    allZero: isAllZero(stat),
    contended: isContended(stat),
  };
}

/** `4.28 s`, `1.3 ms`, `640 µs` — a duration from the nanoseconds the file holds. */
export function formatNs(ns: number): string {
  if (ns === 0) return '0';
  if (ns < 1_000) return `${Math.round(ns)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(ns < 10_000 ? 1 : 0)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(ns < 10_000_000 ? 1 : 0)} ms`;

  const seconds = ns / 1_000_000_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;

  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${whole % 60}s`;
}

/** `4,281,002`, since a slice count gets long enough to be misread. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** `76%`, and `<1%` for a share that is not quite nothing. */
export function formatShare(value: number): string {
  if (value === 0) return '0%';
  if (value >= 0.995) return '100%';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
