/**
 * Parser for `/proc/<pid>/time_in_state` — how long one task has run at each
 * clock frequency.
 *
 * The per-task counterpart of `/proc/uid_time_in_state`, from the same driver:
 * `drivers/cpufreq/cpufreq_times.c`, compiled in only under
 * `CONFIG_CPU_FREQ_TIMES` — an Android kernel in practice, since the per-app
 * battery accounting above it is what wanted it. On a machine without it there
 * is no file here at all, and the page reports the 404 the backend gives it.
 * The units are that driver's throughout, which is why `src/lib/uid_time_in_state.ts`
 * is where they are written down and this module imports them.
 *
 * A `cpuN` line opens each frequency policy, and a frequency and a count follow
 * for every step in it:
 *
 *     cpu0
 *     300000 41028
 *     1132800 902
 *     cpu4
 *     633600 8022
 *     2016000 118
 *
 * **This layout is the good half of the pair.** `/proc/uid_time_in_state`
 * prints every policy's table concatenated into one row with nothing marking
 * the join, so a reader has to infer where a cluster ends — that is what
 * `splitClusters` is for over there. Here the kernel names each policy as it
 * starts one, so the boundary is stated rather than guessed and nothing has to
 * be inferred at all. See {@link Policy}.
 *
 * Four things it is read wrong for:
 *
 *  - **`cpu0` is a policy, not a core.** The driver walks every possible CPU
 *    and prints a header the first time it meets a policy, skipping the CPUs
 *    that share one — so a four-plus-four machine prints `cpu0` and `cpu4`, the
 *    header naming the **first** CPU of the policy and the others going
 *    unmentioned. Time under `cpu0` is time on any core of that cluster.
 *  - **It is one task, and the process file is its main thread.** The driver
 *    prints the `time_in_state` array hanging off the one `task_struct` it was
 *    handed, and for `/proc/<pid>/` that is the group leader — so unlike
 *    `/proc/<pid>/io` beside it, which sums the thread group, this **does not
 *    add up a process's threads**. A worker pool's time is under
 *    `/proc/<pid>/task/<tid>/time_in_state`, one file per thread, and a
 *    heavily threaded app reads here as far idler than it is.
 *  - **A zero is two different answers and the file cannot tell them apart.**
 *    The driver prints `0` both for a step the task genuinely never ran at and
 *    for one its array is too short to cover — a task that started before a
 *    policy came up has no slot for it. `/proc/uid_time_in_state` leaves such
 *    columns off the row instead, which is why that page can distinguish "never
 *    accounted" from "no time"; this one cannot, and so does not try. See
 *    {@link neverRan}.
 *  - **The counts are clock ticks.** `nsec_to_clock_t`, so hundredths of a
 *    second like the times in `/proc/stat`, not milliseconds and not
 *    nanoseconds. See {@link CLOCK_TICK}.
 *
 * Unlike the uid file this one is world-readable — mode 0444 — and it cannot be
 * reset: writing to `/proc/uid_time_in_state` clears the uid table, and there
 * is no such write here. A task's counts run from its first instruction to its
 * last.
 */
import {
  CLOCK_TICK,
  formatDuration,
  formatFrequency,
  formatShare,
  ticksToSeconds,
} from './uid_time_in_state';

// The units are one driver's, so they are imported rather than restated — and
// re-exported, so a reader of this page's code has them to hand.
export { CLOCK_TICK, formatDuration, formatFrequency, formatShare, ticksToSeconds };

/** One step of a policy: a frequency in kHz, and the ticks spent at it. */
export interface Step {
  /** The operating point, in kHz as the file prints it. */
  khz: number;
  /** Clock ticks the task ran at it. */
  ticks: number;
  /** 1-based line it was on. */
  line: number;
}

/**
 * One cpufreq policy, as the file names it.
 *
 * `cpu` is the **first** CPU of the policy rather than the only one: the driver
 * prints a header the first time it meets a policy and says nothing about the
 * cores sharing it. So this is a cluster, and its steps are that cluster's
 * operating points.
 */
export interface Policy {
  cpu: number;
  steps: Step[];
  /** 1-based line the `cpuN` header was on. */
  line: number;
  /** Where it sits in the file, which is the order the driver walks CPUs in. */
  index: number;
}

export interface TimeInState {
  policies: Policy[];
  /**
   * Frequency lines that came before any `cpuN` header, which the driver never
   * writes — kept rather than dropped, since something produced them.
   */
  orphans: Step[];
  /** Lines that were neither a header nor a frequency and a count. */
  malformed: string[];
  bytes: number;
}

/** `cpu0`, `cpu4` — the header that opens a policy. */
const HEADER = /^cpu(\d+)$/;

/** `1132800 902` — a frequency in kHz and a tick count. */
const STEP = /^(\d+)\s+(\d+)$/;

export function parsePidTimeInState(text: string): TimeInState {
  const policies: Policy[] = [];
  const orphans: Step[] = [];
  const malformed: string[] = [];
  const bytes = new TextEncoder().encode(text).length;

  let line = 0;
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    line += 1;

    const header = HEADER.exec(trimmed);
    if (header !== null) {
      policies.push({ cpu: Number(header[1]), steps: [], line, index: policies.length });
      continue;
    }

    const step = STEP.exec(trimmed);
    if (step === null) {
      malformed.push(trimmed);
      continue;
    }

    const parsed: Step = { khz: Number(step[1]), ticks: Number(step[2]), line };
    const current = policies[policies.length - 1];

    // A frequency before any header is not something the driver writes; keep it
    // aside rather than inventing a policy for it to belong to.
    if (current === undefined) orphans.push(parsed);
    else current.steps.push(parsed);
  }

  return { policies, orphans, malformed, bytes };
}

/** Whether the file held nothing at all. */
export function isEmpty(info: TimeInState): boolean {
  return info.policies.length === 0 && info.orphans.length === 0 && info.malformed.length === 0;
}

/** Ticks a task spent on one policy, across every step of it. */
export function policyTotal(policy: Policy): number {
  return policy.steps.reduce((sum, step) => sum + step.ticks, 0);
}

/** Ticks it spent on the machine, across every policy. */
export function totalTicks(info: TimeInState): number {
  return info.policies.reduce((sum, policy) => sum + policyTotal(policy), 0);
}

/**
 * Whether this task has never been accounted a single tick.
 *
 * Two different things look like this and the file cannot separate them: a task
 * that really has had no CPU, and one whose array was never allocated or is too
 * short — the driver prints `0` for both. `/proc/uid_time_in_state` leaves an
 * unaccounted column off the row instead, which is the one place that file is
 * the more honest of the two.
 */
export function neverRan(info: TimeInState): boolean {
  return totalTicks(info) === 0;
}

/** Whether a policy has any time on it at all. */
export function ranOn(policy: Policy): boolean {
  return policyTotal(policy) > 0;
}

/** The policies this task has actually run on. */
export function policiesUsed(info: TimeInState): Policy[] {
  return info.policies.filter(ranOn);
}

/** A policy's share of the task's whole time, or null where it has none. */
export function policyShare(info: TimeInState, policy: Policy): number | null {
  const total = totalTicks(info);
  return total === 0 ? null : policyTotal(policy) / total;
}

/**
 * The frequency this task averaged on one policy, in kHz, weighted by the time
 * at each step — null where it never ran there, which is a mean of nothing
 * rather than a zero.
 *
 * Per policy, never across them: the steps of two clusters are not comparable,
 * and a mean over both would sit between a little core's and a big one's and
 * describe neither. The uid page has to work the boundary out to say this; here
 * the file gives it.
 */
export function meanFrequency(policy: Policy): number | null {
  const total = policyTotal(policy);
  if (total === 0) return null;

  return policy.steps.reduce((sum, step) => sum + step.ticks * step.khz, 0) / total;
}

/** The step a task spent longest at, or null where it spent none anywhere. */
export function busiestStep(policy: Policy): Step | null {
  if (!ranOn(policy)) return null;

  return policy.steps.reduce((best, step) => (step.ticks > best.ticks ? step : best));
}

/**
 * Share of a policy's time spent at its **top step**, 0 to 1 — null where the
 * task never ran there.
 *
 * The step that costs the most for what it delivers, since power climbs faster
 * than clock does. It is what a battery question asks of this file.
 */
export function topStepShare(policy: Policy): number | null {
  const total = policyTotal(policy);
  if (total === 0 || policy.steps.length === 0) return null;

  return policy.steps[policy.steps.length - 1]!.ticks / total;
}

/**
 * Share of a policy's time at its top step past which the page says so — the
 * uid page's threshold, since it is the same question about the same counter.
 */
export const TOP_STEP_HEAVY = 0.25;

/** Whether a task is spending enough of its time at the top step to be worth saying. */
export function heavyAtTopStep(policy: Policy): boolean {
  const share = topStepShare(policy);
  return share !== null && share >= TOP_STEP_HEAVY;
}

/**
 * Whether a policy's steps climb, which is the only order cpufreq builds a
 * table in. False says something reassembled the file — and it is also the
 * thing `/proc/uid_time_in_state` has to lean on to find a boundary this file
 * simply states.
 */
export function ascends(policy: Policy): boolean {
  return policy.steps.every((step, index) => index === 0 || step.khz > policy.steps[index - 1]!.khz);
}

/** The frequencies of one policy, in the order the table has them. */
export function frequenciesOf(policy: Policy): number[] {
  return policy.steps.map((step) => step.khz);
}

/**
 * Every frequency in the file, policy after policy — which is exactly the row
 * `/proc/uid_time_in_state` prints as its header. Two captures of one machine
 * have to agree on this or one of them is wrong.
 */
export function frequencyTable(info: TimeInState): number[] {
  return info.policies.flatMap(frequenciesOf);
}

/**
 * Whether a policy names more than one operating point. A policy with one step
 * cannot change speed, so nothing about frequency is worth saying of it.
 */
export function canScale(policy: Policy): boolean {
  return policy.steps.length > 1;
}

export interface TimeInStateSummary {
  policies: number;
  /** Policies this task has run on at all. */
  used: number;
  /** Ticks across everything. */
  ticks: number;
  seconds: number;
  /** Never accounted a tick anywhere. */
  idle: boolean;
  /** The policy it spent most of its time on, or null where it has none. */
  busiest: Policy | null;
}

export function summarize(info: TimeInState): TimeInStateSummary {
  const ticks = totalTicks(info);
  const busiest = info.policies.reduce<Policy | null>(
    (best, policy) =>
      best === null || policyTotal(policy) > policyTotal(best) ? policy : best,
    null,
  );

  return {
    policies: info.policies.length,
    used: policiesUsed(info).length,
    ticks,
    seconds: ticksToSeconds(ticks),
    idle: ticks === 0,
    busiest: ticks === 0 ? null : busiest,
  };
}
