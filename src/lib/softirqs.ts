/**
 * Parser for `/proc/softirqs`.
 *
 * A column per online CPU, then a line per softirq vector:
 *
 *                     CPU0       CPU1       CPU2       CPU3
 *           HI:          0          0          1          0
 *        TIMER:      15588      21894      14366      11389
 *       NET_RX:      20808        192         59         77
 *
 * Simpler than `/proc/interrupts` — no tail to split, no line that carries a
 * single machine-wide count — and the rows are a **fixed list**, the kernel's
 * `softirq_vec` enum in its own order, rather than whatever the machine has.
 * Every CPU therefore has a count for every row, and a zero means the vector
 * has never run rather than that it does not exist.
 *
 * The counts are **handler runs, not units of work**. Each one is incremented
 * as the vector's handler is entered, and one run of NET_RX can take up to
 * `netdev_budget` packets — 300 by default — so this file says how often the
 * kernel came back to the work, not how much of it there was. See
 * {@link Softirq}.
 *
 * Two names move under you, and both turn up in the wild:
 *
 * - `BLOCK_IOPOLL` was renamed **IRQ_POLL** in 4.5, when polled completion
 *   stopped being the block layer's alone. Same vector, same position.
 * - `HRTIMER` is usually zero on a modern kernel. It went unused entirely
 *   between 4.2 and 4.15, and since 4.16 counts only the timers the kernel is
 *   allowed to run late, so an empty row is the normal reading rather than a
 *   sign of anything. The enum entry stayed either way, which is why the row
 *   is printed at all.
 *
 * Offline CPUs are left out, so the header is read for the labels rather than
 * assuming `CPU0..CPUn-1`.
 */

/** What each vector defers, in the kernel's own order. */
export const VECTORS: Readonly<Record<string, string>> = {
  HI: 'Tasklets that asked for the front of the queue — the TASKLET mechanism, one priority up',
  TIMER: 'Ordinary kernel timers expiring, the deferred half of the timer interrupt',
  NET_TX: 'Packets handed to the driver to send, and the buffers freed once it is done with them',
  NET_RX: 'Packets pulled off the receive queues and pushed up the stack — NAPI polls here',
  BLOCK: 'Block I/O completions, finished away from the disk controller’s own handler',
  IRQ_POLL: 'Polled completion for drivers that borrow the network stack’s budgeted poll loop',
  BLOCK_IOPOLL: 'What IRQ_POLL was called before 4.5, when the block layer was the only user',
  TASKLET: 'The general deferred-work queue that drivers push odd jobs onto',
  SCHED: 'The scheduler’s own deferred work, most of it balancing run queues across CPUs',
  HRTIMER: 'High-resolution timers, and only those the kernel may run late — usually none',
  RCU: 'RCU callbacks: freeing memory once every CPU has stopped looking at it',
};

export interface Softirq {
  /** `TIMER`, `NET_RX` — the vector's name as the kernel spells it. */
  name: string;
  /**
   * Handler runs on each CPU, in the header's column order. Not packets, not
   * timers: one run may have processed a great many of either.
   */
  counts: number[];
}

export interface Softirqs {
  /** CPUs the file has a column for, in order: `['CPU0', 'CPU1', …]`. */
  cpus: string[];
  vectors: Softirq[];
}

/** The header: nothing but CPU labels. */
const HEADER = /^\s*(CPU\d+\s*)+$/;
/** `TIMER:` and the counts after it. */
const LINE = /^\s*(\S+):\s*(.*)$/;

export function parseSoftirqs(text: string): Softirqs {
  const cpus: string[] = [];
  const vectors: Softirq[] = [];

  for (const line of text.split('\n')) {
    // Trimmed first so a CRLF file's trailing carriage return is gone before
    // anything is matched against the end of the line.
    const trimmed = line.trim();
    if (trimmed === '') continue;

    if (cpus.length === 0 && HEADER.test(trimmed)) {
      cpus.push(...trimmed.split(/\s+/));
      continue;
    }

    const match = LINE.exec(trimmed);
    if (match === null) continue;

    const counts: number[] = [];
    for (const token of (match[2] ?? '').trim().split(/\s+/)) {
      // Stop rather than skip: a stray token would otherwise shift the rest of
      // the row into the wrong CPUs.
      if (!/^\d+$/.test(token)) break;
      counts.push(Number(token));
    }
    // A line with no counts at all is not a vector.
    if (counts.length === 0) continue;

    vectors.push({ name: match[1]!, counts });
  }

  return { cpus, vectors };
}

/** What this vector defers, or null for one this page has no note for. */
export function describeVector(name: string): string | null {
  return VECTORS[name] ?? null;
}

/** Runs of this vector across every CPU. */
export function total(vector: Softirq): number {
  return vector.counts.reduce((sum, count) => sum + count, 0);
}

/** Whether this vector has never run — normal for HRTIMER and IRQ_POLL. */
export function isIdle(vector: Softirq): boolean {
  return total(vector) === 0;
}

/**
 * How concentrated a vector is on one CPU, 0–1: 1 when a single CPU ran all of
 * it, near 1/n when the CPUs shared it evenly.
 */
export function concentration(vector: Softirq): number {
  const sum = total(vector);
  return sum === 0 ? 0 : Math.max(...vector.counts) / sum;
}

/** Index of the CPU that ran this vector most, or -1 if it never ran. */
export function busiestCpu(vector: Softirq): number {
  return isIdle(vector) ? -1 : vector.counts.indexOf(Math.max(...vector.counts));
}

/** A vector is pinned when nearly every run of it landed on one CPU. */
export const PINNED_SHARE = 0.9;

/**
 * How much of the machine's softirq work a vector must carry before being
 * pinned is worth saying anything about. Tasklets are routinely raised on
 * whichever CPU asked for them and land back on it, so a vector that ran a few
 * dozen times is pinned in a way that means nothing; NET_RX pinned is a NIC
 * with one receive queue, and that means a great deal.
 */
export const NOTABLE_SHARE = 0.05;

/** Share of every softirq on the machine that this vector accounts for. */
export function share(vector: Softirq, machineTotal: number): number {
  return machineTotal === 0 ? 0 : total(vector) / machineTotal;
}

export interface SoftirqsSummary {
  cpus: number;
  /** Vectors the file printed, run or not. */
  vectors: number;
  /** Vectors that have run at least once. */
  raised: number;
  total: number;
  /** Total per CPU, in column order. */
  perCpu: number[];
  /** Vectors by total, busiest first. */
  busiest: Softirq[];
  /**
   * Vectors doing real work that one CPU ran nearly all of. Empty on a
   * single-CPU machine, where there is nothing to spread work across.
   */
  pinned: Softirq[];
}

export function summarize(softirqs: Softirqs): SoftirqsSummary {
  const { cpus, vectors } = softirqs;

  const machineTotal = vectors.reduce((sum, vector) => sum + total(vector), 0);

  return {
    cpus: cpus.length,
    vectors: vectors.length,
    raised: vectors.filter((vector) => !isIdle(vector)).length,
    total: machineTotal,
    perCpu: cpus.map((_, index) =>
      vectors.reduce((sum, vector) => sum + (vector.counts[index] ?? 0), 0),
    ),
    busiest: [...vectors].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name)),
    pinned:
      cpus.length < 2
        ? []
        : vectors.filter(
            (vector) =>
              !isIdle(vector) &&
              concentration(vector) >= PINNED_SHARE &&
              share(vector, machineTotal) >= NOTABLE_SHARE,
          ),
  };
}

/** `1.2M` — these counts reach the hundreds of millions on a busy machine. */
export function formatCount(value: number): string {
  const units = [
    { limit: 1e9, suffix: 'G' },
    { limit: 1e6, suffix: 'M' },
    { limit: 1e3, suffix: 'k' },
  ];

  for (const { limit, suffix } of units) {
    if (value >= limit) return `${(value / limit).toFixed(1)}${suffix}`;
  }
  return String(value);
}

/** `28%`, and `<1%` for a vector that is not quite nothing. */
export function formatShare(value: number): string {
  if (value === 0) return '—';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
