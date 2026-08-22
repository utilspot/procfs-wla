/**
 * Parser for `/proc/schedstat`.
 *
 * Scheduler counters since boot, behind a version and a timestamp:
 *
 *   version 15
 *   timestamp 4295061837
 *   cpu0 0 0 12847203 4821037 9284710 6183947 128472039418 8471203941 12847203
 *   domain0 03 0 0 0 0 …
 *   domain1 0f 0 0 0 0 …
 *   cpu1 …
 *
 * A `domain` line belongs to the `cpu` line above it — the file is grouped, not
 * flat — and its first field is a **hex CPU mask** rather than a count, which is
 * what makes the scheduling topology visible: `03` is a pair of SMT siblings,
 * `0f` the four cores of a package.
 *
 * **The field layout depends on the version**, which is why the file states one.
 * The nine named fields below are version 15, what every kernel since 2.6.23
 * writes. An older file has a different layout, so its fields are left unnamed
 * rather than read as if they were v15 — the numbers would be silently wrong.
 * The domain counters are load-balancer internals whose layout shifts between
 * versions too, so they are kept as given and not interpreted.
 *
 * Times are in nanoseconds.
 */

/** The layout this parser can name. */
export const NAMED_VERSION = 15;

export interface Domain {
  /** `domain0`, `domain1`, … in the order the kernel wrote them. */
  name: string;
  /** Hex mask of the CPUs in this domain, as printed. */
  mask: string;
  /** How many CPUs that mask has set. */
  cpuCount: number;
  /** The load-balancer counters, uninterpreted. */
  values: number[];
}

export interface CpuSchedStat {
  /** `cpu0`. */
  name: string;
  index: number;
  /** Every field as read, whatever the version. */
  values: number[];
  /** Times `sched_yield()` was called. */
  yields: number | null;
  /** Times `schedule()` was called. */
  schedules: number | null;
  /** Times `schedule()` left the CPU idle. */
  wentIdle: number | null;
  /** Times `try_to_wake_up()` ran. */
  wakeups: number | null;
  /** Of those, the ones that woke a task on this same CPU. */
  wakeupsLocal: number | null;
  /** Time tasks spent running here, in nanoseconds. */
  runTimeNs: number | null;
  /** Time tasks spent waiting to run here, in nanoseconds. */
  waitTimeNs: number | null;
  /** Timeslices run. */
  timeslices: number | null;
  /** Scheduling domains this CPU belongs to, innermost first. */
  domains: Domain[];
}

export interface SchedStat {
  version: number | null;
  timestamp: number | null;
  cpus: CpuSchedStat[];
  /** True when the version is one whose field layout this parser knows. */
  named: boolean;
}

const VERSION = /^version\s+(\d+)/;
const TIMESTAMP = /^timestamp\s+(\d+)/;
const CPU = /^cpu(\d+)\s+(.*)$/;
const DOMAIN = /^(domain\d+)\s+(\S+)\s*(.*)$/;

function numbers(text: string): number[] {
  const values: number[] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (token === '') continue;
    const value = Number(token);
    // Stop at the first non-number rather than skipping it, so a stray token
    // can never shift the columns after it into the wrong fields.
    if (!Number.isFinite(value)) break;
    values.push(value);
  }
  return values;
}

/** Counts the bits set in a hex mask, which may be far wider than 32 bits. */
export function countMask(mask: string): number {
  let bits = 0;
  for (const character of mask.replace(/,/g, '')) {
    const digit = Number.parseInt(character, 16);
    if (Number.isNaN(digit)) continue;
    bits += digit.toString(2).split('').filter((bit) => bit === '1').length;
  }
  return bits;
}

export function parseSchedStat(text: string): SchedStat {
  const cpus: CpuSchedStat[] = [];
  let version: number | null = null;
  let timestamp: number | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const versionMatch = VERSION.exec(trimmed);
    if (versionMatch !== null) {
      version = Number(versionMatch[1]);
      continue;
    }

    const timestampMatch = TIMESTAMP.exec(trimmed);
    if (timestampMatch !== null) {
      timestamp = Number(timestampMatch[1]);
      continue;
    }

    const cpuMatch = CPU.exec(trimmed);
    if (cpuMatch !== null) {
      const values = numbers(cpuMatch[2] ?? '');
      cpus.push({
        name: `cpu${cpuMatch[1]}`,
        index: Number(cpuMatch[1]),
        values,
        yields: null,
        schedules: null,
        wentIdle: null,
        wakeups: null,
        wakeupsLocal: null,
        runTimeNs: null,
        waitTimeNs: null,
        timeslices: null,
        domains: [],
      });
      continue;
    }

    // A domain belongs to the CPU whose line came before it.
    const domainMatch = DOMAIN.exec(trimmed);
    if (domainMatch !== null && cpus.length > 0) {
      const mask = domainMatch[2]!;
      cpus[cpus.length - 1]!.domains.push({
        name: domainMatch[1]!,
        mask,
        cpuCount: countMask(mask),
        values: numbers(domainMatch[3] ?? ''),
      });
    }
  }

  // Only read the fields by name when the layout is one we know. An older
  // version orders them differently, and naming them anyway would be wrong.
  const named = (version === null || version >= NAMED_VERSION) &&
    cpus.every((cpu) => cpu.values.length >= 9);

  if (named) {
    for (const cpu of cpus) {
      const [yields, , schedules, wentIdle, wakeups, wakeupsLocal, runTimeNs, waitTimeNs, timeslices] =
        cpu.values as [number, number, number, number, number, number, number, number, number];
      Object.assign(cpu, {
        yields,
        schedules,
        wentIdle,
        wakeups,
        wakeupsLocal,
        runTimeNs,
        waitTimeNs,
        timeslices,
      });
    }
  }

  return { version, timestamp, cpus, named };
}

/**
 * Average time a task waited to get on this CPU, in nanoseconds — the wait
 * total divided by the timeslices that were run. This is the number the file
 * exists for: run-queue latency, per CPU.
 */
export function averageWaitNs(cpu: CpuSchedStat): number | null {
  if (cpu.waitTimeNs === null || cpu.timeslices === null || cpu.timeslices === 0) return null;
  return cpu.waitTimeNs / cpu.timeslices;
}

/** Waiting time as a share of running time — above 1 means more queued than run. */
export function waitRatio(cpu: CpuSchedStat): number | null {
  if (cpu.waitTimeNs === null || cpu.runTimeNs === null || cpu.runTimeNs === 0) return null;
  return cpu.waitTimeNs / cpu.runTimeNs;
}

/** Share of `schedule()` calls that found nothing to run, 0–1. */
export function idleShare(cpu: CpuSchedStat): number | null {
  if (cpu.wentIdle === null || cpu.schedules === null || cpu.schedules === 0) return null;
  return cpu.wentIdle / cpu.schedules;
}

/** Share of wakeups that kept the task on this CPU, 0–1. */
export function localWakeupShare(cpu: CpuSchedStat): number | null {
  if (cpu.wakeupsLocal === null || cpu.wakeups === null || cpu.wakeups === 0) return null;
  return cpu.wakeupsLocal / cpu.wakeups;
}

export interface SchedStatSummary {
  cpus: number;
  /** Distinct domain levels, i.e. the depth of the scheduling topology. */
  domainLevels: number;
  runTimeNs: number;
  waitTimeNs: number;
  timeslices: number;
  /** Average wait across every CPU, weighted by timeslices. */
  averageWaitNs: number | null;
  /** The CPU tasks waited longest on, on average. */
  worst: CpuSchedStat | null;
}

export function summarize(schedstat: SchedStat): SchedStatSummary {
  const { cpus } = schedstat;
  const sum = (pick: (cpu: CpuSchedStat) => number | null): number =>
    cpus.reduce((total, cpu) => total + (pick(cpu) ?? 0), 0);

  const timeslices = sum((cpu) => cpu.timeslices);
  const waitTimeNs = sum((cpu) => cpu.waitTimeNs);

  const ranked = cpus
    .filter((cpu) => averageWaitNs(cpu) !== null)
    .sort((a, b) => (averageWaitNs(b) ?? 0) - (averageWaitNs(a) ?? 0));

  return {
    cpus: cpus.length,
    domainLevels: Math.max(0, ...cpus.map((cpu) => cpu.domains.length)),
    runTimeNs: sum((cpu) => cpu.runTimeNs),
    waitTimeNs,
    timeslices,
    averageWaitNs: timeslices === 0 ? null : waitTimeNs / timeslices,
    worst: ranked[0] ?? null,
  };
}

/** `1.4 ms`, `820 µs` — scheduler latencies span nanoseconds to seconds. */
export function formatNs(value: number): string {
  const units = [
    { limit: 1e9, suffix: 's' },
    { limit: 1e6, suffix: 'ms' },
    { limit: 1e3, suffix: 'µs' },
  ];

  for (const { limit, suffix } of units) {
    if (value >= limit) {
      const scaled = value / limit;
      return `${scaled.toFixed(scaled < 10 ? 1 : 0)} ${suffix}`;
    }
  }
  return `${Math.round(value)} ns`;
}

/** `3h 12m` — total run and wait times reach hours. */
export function formatDuration(nanoseconds: number): string {
  const seconds = nanoseconds / 1e9;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  return `${seconds.toFixed(1)}s`;
}
