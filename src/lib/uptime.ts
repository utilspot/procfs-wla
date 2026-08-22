/**
 * Parser for `/proc/uptime`.
 *
 * Two numbers, and that is the whole file:
 *
 *   17465.37 98587.48
 *
 * The first is how long the machine has been up, in seconds. The second is
 * **not** how long it has been idle — it is idle time **summed across every
 * CPU**, so on an eight-core machine it counts up to eight seconds per second
 * and routinely comes out larger than the uptime beside it. Reading the pair
 * as two lengths of wall time is the mistake this file invites.
 *
 * That sum is also what makes the file say more than it looks like it does.
 * Average idle per CPU cannot exceed one second per second, so
 * `idle / uptime` is a **lower bound on the CPU count** — see
 * {@link minimumCpus}. The count itself is not in here, so the share of the
 * machine that was idle can only be given per candidate count; see
 * {@link idleShare}.
 *
 * Three things the kernel does to these two numbers are worth knowing:
 *
 * - Uptime is read from **CLOCK_BOOTTIME**, which counts time spent suspended.
 *   The idle total does not advance while suspended, so a laptop that slept
 *   through the week comes back with far less idle than its uptime implies.
 * - The idle sum is over `for_each_possible_cpu`, not the online ones, and it
 *   is `CPUTIME_IDLE` alone — **iowait is not in it**, though `/proc/stat`
 *   counts that separately. The two files do not have to agree.
 * - Under a **time namespace** the uptime is offset to the container's own
 *   boot, while the idle total remains the host's. The pairing is what gives
 *   that away: an implied CPU count larger than any real machine has. See
 *   {@link IMPLAUSIBLE_CPUS}.
 *
 * Both figures are printed as `%lu.%02lu` — hundredths, from a nanosecond
 * clock — so the precision here is the format's rather than the kernel's.
 */

export interface Uptime {
  /** Seconds since boot, including any time spent suspended. */
  seconds: number;
  /** Idle seconds summed across every CPU, or null if the field was absent. */
  idleSeconds: number | null;
  /** The two fields exactly as printed, for showing what was read. */
  raw: string[];
}

/** The two decimal places the kernel prints, and the resolution that implies. */
export const PRINTED_PRECISION_SECONDS = 0.01;

/**
 * An implied CPU count past which a time namespace is the likelier reading
 * than a real machine. Machines this large do exist, but paired with a short
 * uptime the combination is the signature of a container whose uptime was
 * offset while the idle total was not.
 */
export const IMPLAUSIBLE_CPUS = 1024;

const FIELD = /^\d+(?:\.\d+)?$/;

export function parseUptime(text: string): Uptime | null {
  // One line, but take the first non-empty one rather than assuming.
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const fields = trimmed.split(/\s+/);
    const [seconds, idle] = fields;
    if (seconds === undefined || !FIELD.test(seconds)) return null;

    return {
      seconds: Number(seconds),
      // Every kernel prints both, but a rewritten file need not.
      idleSeconds: idle !== undefined && FIELD.test(idle) ? Number(idle) : null,
      raw: fields,
    };
  }

  return null;
}

/**
 * Idle seconds per second of uptime. One CPU can contribute at most 1, so this
 * is also the machine's CPU count multiplied by its average idle share.
 */
export function idlePerSecond(uptime: Uptime): number | null {
  if (uptime.idleSeconds === null || uptime.seconds <= 0) return null;
  return uptime.idleSeconds / uptime.seconds;
}

/**
 * The fewest CPUs that could have produced this much idle. Average idle per
 * CPU cannot exceed one second per second, so a ratio of 5.6 needs six CPUs —
 * which on the machine this was read from is exactly how many there were.
 */
export function minimumCpus(uptime: Uptime): number | null {
  const ratio = idlePerSecond(uptime);
  return ratio === null ? null : Math.max(1, Math.ceil(ratio));
}

/**
 * Whether the pair implies more CPUs than a machine plausibly has, which is
 * what a container's namespaced uptime beside the host's idle total looks like.
 */
export function impliesTimeNamespace(uptime: Uptime): boolean {
  const minimum = minimumCpus(uptime);
  return minimum !== null && minimum > IMPLAUSIBLE_CPUS;
}

/**
 * Whether there is less than a CPU-second of idle per second of uptime. On a
 * machine with more than one CPU that means either a genuinely busy one or
 * time spent suspended, which uptime counts and idle does not.
 */
export function idleBelowUptime(uptime: Uptime): boolean {
  const ratio = idlePerSecond(uptime);
  return ratio !== null && ratio < 1;
}

/** Share of a machine of `cpus` CPUs that was idle, 0–1. */
export function idleShare(uptime: Uptime, cpus: number): number | null {
  const ratio = idlePerSecond(uptime);
  if (ratio === null || cpus <= 0) return null;
  return Math.min(1, ratio / cpus);
}

/**
 * CPU counts worth showing the idle share for: the fewest that could explain
 * the file, then the powers of two above it. The real count is not in here, so
 * the honest answer is a short range rather than one number.
 */
export function candidateCpuCounts(minimum: number, howMany = 4): number[] {
  const counts = [minimum];

  let next = 1;
  while (next <= minimum) next *= 2;
  while (counts.length < howMany) {
    counts.push(next);
    next *= 2;
  }

  return counts;
}

export interface UptimeSummary {
  seconds: number;
  idleSeconds: number | null;
  /** Idle seconds per second of uptime, i.e. CPUs' worth of idle. */
  idlePerSecond: number | null;
  minimumCpus: number | null;
  /** CPU counts to show a share for, fewest first. */
  candidates: number[];
  /** Less than one CPU-second of idle per second: busy, or suspended. */
  idleBelowUptime: boolean;
  /** The pair implies a machine larger than any that exists. */
  timeNamespace: boolean;
}

export function summarize(uptime: Uptime): UptimeSummary {
  const minimum = minimumCpus(uptime);

  return {
    seconds: uptime.seconds,
    idleSeconds: uptime.idleSeconds,
    idlePerSecond: idlePerSecond(uptime),
    minimumCpus: minimum,
    candidates: minimum === null ? [] : candidateCpuCounts(minimum),
    idleBelowUptime: idleBelowUptime(uptime),
    timeNamespace: impliesTimeNamespace(uptime),
  };
}

/**
 * `4d 2h 15m`, the way `uptime(1)` says it — and seconds only while that is
 * still the interesting part, which is the first minute after a boot.
 */
export function formatDuration(seconds: number): string {
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
