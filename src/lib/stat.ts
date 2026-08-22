/**
 * Parser for `/proc/stat`.
 *
 * Kernel counters since boot, one per line:
 *
 *   cpu  <user> <nice> <system> <idle> <iowait> <irq> <softirq> <steal> <guest> <guest_nice>
 *   cpu0 …                       the same, per logical CPU
 *   intr <total> <per-irq…>      interrupts serviced
 *   ctxt <n>                     context switches
 *   btime <n>                    boot time, seconds since the epoch
 *   processes <n>                processes and threads created
 *   procs_running <n>            currently runnable
 *   procs_blocked <n>            currently blocked on I/O
 *   softirq <total> <per-type…>
 *
 * The CPU line grew over time — `iowait`, `irq` and `softirq` arrived in 2.5,
 * `steal` and `guest` in 2.6.11, `guest_nice` in 2.6.33 — so a file from an
 * older kernel is shorter. As with diskstats, the columns it does not carry are
 * reported absent rather than zero, since a missing counter and a counter that
 * really is zero are different things.
 *
 * Old kernels also emit lines this parser has no use for (`page`, `swap`,
 * `disk_io:`), which are ignored rather than treated as an error.
 *
 * Times are in USER_HZ, not seconds — see {@link seconds}.
 */

/** Ticks per second the kernel reports these times in. 100 on every normal build. */
export const USER_HZ = 100;

export interface CpuTimes {
  /** null for the aggregate `cpu` line, 0-based for `cpu0`, `cpu1`, … */
  index: number | null;
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number | null;
  irq: number | null;
  softirq: number | null;
  steal: number | null;
  /** Time running a guest VM. Already counted in `user`, so never added twice. */
  guest: number | null;
  /** Likewise already counted in `nice`. */
  guestNice: number | null;
}

export interface ProcStat {
  /** The aggregate `cpu` line, absent only in a file that is not /proc/stat. */
  total: CpuTimes | null;
  /** The per-CPU lines, in file order. */
  cpus: CpuTimes[];
  interrupts: number | null;
  softirqs: number | null;
  contextSwitches: number | null;
  /** Seconds since the epoch at which the machine booted. */
  btime: number | null;
  /** Processes and threads created since boot. */
  processes: number | null;
  procsRunning: number | null;
  procsBlocked: number | null;
}

/** The four columns every kernel has ever written; fewer is not a CPU line. */
const REQUIRED = 4;

function parseCpuLine(label: string, values: number[]): CpuTimes | null {
  if (values.length < REQUIRED) return null;

  const rest = label.slice('cpu'.length);
  const index = rest === '' ? null : Number(rest);
  if (index !== null && !Number.isInteger(index)) return null;

  const at = (position: number): number | null => values[position] ?? null;

  return {
    index,
    user: values[0]!,
    nice: values[1]!,
    system: values[2]!,
    idle: values[3]!,
    iowait: at(4),
    irq: at(5),
    softirq: at(6),
    steal: at(7),
    guest: at(8),
    guestNice: at(9),
  };
}

export function parseStat(text: string): ProcStat {
  const stat: ProcStat = {
    total: null,
    cpus: [],
    interrupts: null,
    softirqs: null,
    contextSwitches: null,
    btime: null,
    processes: null,
    procsRunning: null,
    procsBlocked: null,
  };

  for (const line of text.split('\n')) {
    const [label, ...rest] = line.trim().split(/\s+/);
    if (label === undefined || label === '') continue;

    // Stop at the first thing that is not a number rather than skipping it, so
    // a malformed token can never shift the columns after it into the wrong
    // fields — a dropped value would silently read `system` as `idle`.
    const values: number[] = [];
    for (const token of rest) {
      const value = Number(token);
      if (!Number.isFinite(value)) break;
      values.push(value);
    }

    if (label.startsWith('cpu')) {
      const times = parseCpuLine(label, values);
      if (times === null) continue;
      if (times.index === null) stat.total = times;
      else stat.cpus.push(times);
      continue;
    }

    // `intr` and `softirq` lead with the total and then break it down per
    // source; only the total is of interest here.
    const first = values[0] ?? null;
    switch (label) {
      case 'intr':
        stat.interrupts = first;
        break;
      case 'softirq':
        stat.softirqs = first;
        break;
      case 'ctxt':
        stat.contextSwitches = first;
        break;
      case 'btime':
        stat.btime = first;
        break;
      case 'processes':
        stat.processes = first;
        break;
      case 'procs_running':
        stat.procsRunning = first;
        break;
      case 'procs_blocked':
        stat.procsBlocked = first;
        break;
      default:
        // `page`, `swap`, `disk_io:` and anything a future kernel adds.
        break;
    }
  }

  return stat;
}

/** How a CPU has spent its time since boot. */
export interface CpuUsage {
  index: number | null;
  /** Every jiffy accounted for, guest time excluded — see {@link breakdown}. */
  total: number;
  /** `idle` plus `iowait`: the CPU had nothing to run. */
  idle: number;
  busy: number;
  /** Share of time spent busy, 0–100. */
  busyPercent: number;
  /** Every state with a non-zero share, largest first. */
  states: { state: string; jiffies: number; percent: number }[];
}

/**
 * The states that make up a CPU's time.
 *
 * `guest` and `guest_nice` are deliberately left out: the kernel adds guest
 * time into `user` and `nice` as well, so counting them here would total more
 * than the time that actually passed.
 */
const STATES = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal'] as const;

export function breakdown(times: CpuTimes): CpuUsage {
  const jiffies = STATES.map((state) => ({ state, jiffies: times[state] ?? 0 }));
  const total = jiffies.reduce((sum, entry) => sum + entry.jiffies, 0);
  const idle = (times.idle ?? 0) + (times.iowait ?? 0);
  const busy = total - idle;

  return {
    index: times.index,
    total,
    idle,
    busy,
    busyPercent: total === 0 ? 0 : (busy / total) * 100,
    states: jiffies
      .filter((entry) => entry.jiffies > 0)
      .map((entry) => ({ ...entry, percent: total === 0 ? 0 : (entry.jiffies / total) * 100 }))
      .sort((a, b) => b.jiffies - a.jiffies),
  };
}

/** Turns a jiffy count into seconds. */
export function seconds(jiffies: number): number {
  return jiffies / USER_HZ;
}

/** How long the machine has been up, in seconds, or null without a `btime`. */
export function uptime(stat: ProcStat, now: Date = new Date()): number | null {
  if (stat.btime === null) return null;
  return Math.max(0, Math.floor(now.getTime() / 1000) - stat.btime);
}

/** `3d 4h 12m` — a duration at the two coarsest units that say anything. */
export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** `1.2M`, `3.4G` — big counters, at a glance. */
export function formatCount(value: number): string {
  const units = [
    { limit: 1e12, suffix: 'T' },
    { limit: 1e9, suffix: 'G' },
    { limit: 1e6, suffix: 'M' },
    { limit: 1e3, suffix: 'k' },
  ];

  for (const { limit, suffix } of units) {
    if (value >= limit) return `${(value / limit).toFixed(1)}${suffix}`;
  }
  return String(value);
}
