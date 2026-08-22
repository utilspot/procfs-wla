/**
 * Parser for `/proc/<pid>/limits`.
 *
 * The resource limits a process is running under, one per line, in a table the
 * kernel prints with fixed column widths:
 *
 *   Limit                     Soft Limit           Hard Limit           Units
 *   Max stack size            8388608              unlimited            bytes
 *   Max open files            1024                 1048576              files
 *   Max nice priority         0                    0
 *
 * The whole file turns on **the difference between the two columns**. The soft
 * limit is what is enforced right now; the hard limit is the ceiling the
 * process may raise its own soft limit to, with `setrlimit` and no privilege
 * whatsoever. So `1024 / 1048576` on `Max open files` is not a machine that
 * allows a thousand descriptors — it is a process that has not yet asked for
 * the million it is already entitled to, which is why "too many open files" is
 * so often fixed by two lines of code rather than by editing
 * `/etc/security/limits.conf`. Where soft already equals hard, raising it needs
 * `CAP_SYS_RESOURCE`, and lowering a hard limit is a one-way door for anyone
 * without it.
 *
 * Three more things read wrong at first glance:
 *
 * - **Three of these are per *user*, not per process.** `Max processes`,
 *   `Max pending signals` and `Max msgqueue size` are counted across every
 *   process sharing this one's real user id, machine-wide. See
 *   {@link isPerUser}.
 * - **Two of them are not enforced at all.** `Max resident set` has done
 *   nothing since Linux 2.4.30, and `Max file locks` nothing since 2.4.25.
 *   Both still print whatever they were set to. See {@link isEnforced}.
 * - **`Max nice priority` reads backwards.** The kernel refuses any nice value
 *   below `20 - rlim_cur`, so the usual `0` means the process may not lower
 *   its nice at all, and `40` means it may go all the way to -20. See
 *   {@link niceFloor}.
 *
 * The row count is not fixed either: `RLIMIT_RTTIME` arrived in 2.6.25, so an
 * older kernel prints fifteen rows rather than sixteen, and nothing here
 * assumes a row is present.
 */

/** One row of the table: a resource, and the pair of limits on it. */
export interface Limit {
  /** As the kernel prints it, e.g. `Max open files`. */
  name: string;
  /** What is enforced now, or null where the kernel printed `unlimited`. */
  soft: number | null;
  /** The ceiling the soft limit may be raised to, or null for `unlimited`. */
  hard: number | null;
  /** `bytes`, `files`, … or null on the two rows the kernel gives no unit. */
  unit: string | null;
}

/** What one limit governs, beyond the name the kernel prints for it. */
export interface LimitInfo {
  /** The kernel's own constant, which is what `setrlimit` is called with. */
  resource: string;
  /** The `ulimit` flag that reads and sets it, where the shell has one. */
  flag: string | null;
  /** What it bounds, and what a process hitting it gets back. */
  note: string;
}

/** What each row means. Anything absent is still shown, unexplained. */
export const LIMITS: Readonly<Record<string, LimitInfo>> = {
  'Max cpu time': {
    resource: 'RLIMIT_CPU',
    flag: '-t',
    note: 'CPU seconds the process may consume: SIGXCPU at the soft limit, once a second until it reaches the hard limit and is killed outright',
  },
  'Max file size': {
    resource: 'RLIMIT_FSIZE',
    flag: '-f',
    note: 'Largest file it may write — a write past it fails with EFBIG and raises SIGXFSZ',
  },
  'Max data size': {
    resource: 'RLIMIT_DATA',
    flag: '-d',
    note: 'The data segment: brk since forever, and since 4.7 private anonymous mappings too, which is what made this limit start biting again',
  },
  'Max stack size': {
    resource: 'RLIMIT_STACK',
    flag: '-s',
    note: 'How far the main thread’s stack may grow before SIGSEGV — and what pthreads takes as the default size of every thread stack it allocates',
  },
  'Max core file size': {
    resource: 'RLIMIT_CORE',
    flag: '-c',
    note: 'Largest core dump — 0 means a crash leaves nothing behind to debug',
  },
  'Max resident set': {
    resource: 'RLIMIT_RSS',
    flag: '-m',
    note: 'Resident pages — not enforced since Linux 2.4.30, so whatever this says, nothing acts on it',
  },
  'Max processes': {
    resource: 'RLIMIT_NPROC',
    flag: '-u',
    note: 'Processes and threads this real user id may have across the whole machine, not just here — fork returns EAGAIN at it, and it is not enforced for root at all',
  },
  'Max open files': {
    resource: 'RLIMIT_NOFILE',
    flag: '-n',
    note: 'One past the highest file descriptor number: open, pipe, socket and accept return EMFILE at it',
  },
  'Max locked memory': {
    resource: 'RLIMIT_MEMLOCK',
    flag: '-l',
    note: 'Bytes it may pin into memory with mlock — and what bounds io_uring rings, BPF maps and RDMA registrations for a process without CAP_IPC_LOCK',
  },
  'Max address space': {
    resource: 'RLIMIT_AS',
    flag: '-v',
    note: 'The whole virtual address space, mapped or not: mmap and brk fail with ENOMEM at it, however little is actually resident',
  },
  'Max file locks': {
    resource: 'RLIMIT_LOCKS',
    flag: '-x',
    note: 'flock and fcntl locks — not enforced since Linux 2.4.25',
  },
  'Max pending signals': {
    resource: 'RLIMIT_SIGPENDING',
    flag: '-i',
    note: 'Signals queued for this real user id machine-wide, counting each real-time signal separately',
  },
  'Max msgqueue size': {
    resource: 'RLIMIT_MSGQUEUE',
    flag: '-q',
    note: 'Bytes this real user id may hold in POSIX message queues, counting the kernel’s own per-message overhead',
  },
  'Max nice priority': {
    resource: 'RLIMIT_NICE',
    flag: '-e',
    note: 'The nice floor, written backwards: the kernel refuses any nice value below 20 minus this, so the usual 0 forbids raising priority at all and 40 allows -20',
  },
  'Max realtime priority': {
    resource: 'RLIMIT_RTPRIO',
    flag: '-r',
    note: 'Highest SCHED_FIFO or SCHED_RR priority it may ask for — 0 means no real-time scheduling without CAP_SYS_NICE',
  },
  'Max realtime timeout': {
    resource: 'RLIMIT_RTTIME',
    flag: null,
    note: 'Microseconds of CPU a real-time thread may hold without a blocking syscall: SIGXCPU at the soft limit, killed at the hard one. The only thing standing between a SCHED_FIFO loop and a wedged CPU',
  },
};

/**
 * Limits counted across every process sharing this one's **real user id**,
 * rather than for this process alone — so another process can exhaust them.
 */
const PER_USER = new Set(['Max processes', 'Max pending signals', 'Max msgqueue size']);

/** Limits the kernel prints and no longer acts on, with when it stopped. */
const UNENFORCED: Readonly<Record<string, string>> = {
  'Max resident set': 'Linux 2.4.30',
  'Max file locks': 'Linux 2.4.25',
};

/** Text the kernel prints for `RLIM_INFINITY`, in both value columns. */
export const UNLIMITED = 'unlimited';

/**
 * A row of the table. The name holds spaces, so the columns are told apart by
 * the run of padding between them rather than by splitting on whitespace.
 */
const ROW = /^(\S.*?)\s{2,}(unlimited|\d+)\s+(unlimited|\d+)(?:\s+(\S+))?\s*$/;

export function parseLimits(text: string): Limit[] {
  const limits: Limit[] = [];

  for (const line of text.split('\n')) {
    const row = ROW.exec(line.trimEnd());
    // The header line has no numbers in it, so it never matches.
    if (row === null) continue;

    limits.push({
      name: row[1]!,
      soft: row[2] === UNLIMITED ? null : Number(row[2]),
      hard: row[3] === UNLIMITED ? null : Number(row[3]),
      unit: row[4] ?? null,
    });
  }

  return limits;
}

/** The row of this name, or null on a kernel that does not print it. */
export function find(limits: readonly Limit[], name: string): Limit | null {
  return limits.find((limit) => limit.name === name) ?? null;
}

/** What this limit governs, or null for a row this page has no note for. */
export function describeLimit(name: string): LimitInfo | null {
  return LIMITS[name] ?? null;
}

/** Whether this limit is counted per real user id rather than per process. */
export function isPerUser(name: string): boolean {
  return PER_USER.has(name);
}

/** Whether any current kernel acts on this limit at all. */
export function isEnforced(name: string): boolean {
  return UNENFORCED[name] === undefined;
}

/** Which kernel stopped enforcing this limit, or null for one still enforced. */
export function unenforcedSince(name: string): string | null {
  return UNENFORCED[name] ?? null;
}

/**
 * Whether the process could raise this itself: the soft limit is below the
 * hard one, and `setrlimit` up to the hard limit needs no privilege at all.
 */
export function isRaisable(limit: Limit): boolean {
  if (limit.soft === null) return false;
  return limit.hard === null || limit.hard > limit.soft;
}

/**
 * Whether this limit bounds something and the process cannot move it: the soft
 * limit is finite and already at the hard one, so raising it takes
 * `CAP_SYS_RESOURCE` — and lowering the hard limit further cannot be undone.
 * A row that is unlimited on both sides bounds nothing, so it is neither this
 * nor {@link isRaisable}.
 */
export function isPinned(limit: Limit): boolean {
  return limit.soft !== null && limit.soft === limit.hard;
}

/**
 * The lowest nice value `Max nice priority` allows, since the row is that
 * floor written backwards — the kernel takes `20 - rlim_cur` and refuses
 * anything below it. The usual `0` therefore gives 20, which is past the top
 * of the nice range and means the process may not lower its nice at all; `40`
 * gives -20, the whole range. Null for any other row, or a ceiling of
 * `unlimited`.
 */
export function niceFloor(limit: Limit): number | null {
  if (limit.name !== 'Max nice priority' || limit.soft === null) return null;
  return 20 - limit.soft;
}

/** The highest nice value there is, so a floor above it forbids lowering at all. */
export const MAX_NICE = 19;

/** Whether `Max nice priority` lets the process raise its priority at all. */
export function canLowerNice(limit: Limit): boolean {
  const floor = niceFloor(limit);
  return floor !== null && floor <= MAX_NICE;
}

/** Whether this row grants real-time scheduling at all. */
export function isRealtime(limit: Limit): boolean {
  return limit.name === 'Max realtime priority' && limit.soft !== null && limit.soft > 0;
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** `8 MiB` — limits in bytes are round binary figures nearly every time. */
export function formatBytes(value: number): string {
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? size : size.toFixed(Number.isInteger(size) ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

/** `1,048,576` — counts here run from a handful to a million. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** `200 ms` — RLIMIT_RTTIME is printed in microseconds. */
export function formatMicros(value: number): string {
  if (value < 1000) return `${value} µs`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} ms`;

  const seconds = value / 1_000_000;
  return `${seconds.toFixed(Number.isInteger(seconds) ? 0 : 1)} s`;
}

/** `2 h` — RLIMIT_CPU is printed in seconds. */
export function formatSeconds(value: number): string {
  if (value < 60) return `${value} s`;
  if (value < 3600) return `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)} min`;
  return `${(value / 3600).toFixed(value % 3600 === 0 ? 0 : 1)} h`;
}

/**
 * One of the two columns, in whatever unit the row is counted in — with
 * `unlimited` for the value the kernel spells that way.
 */
export function formatValue(limit: Limit, value: number | null): string {
  if (value === null) return UNLIMITED;

  switch (limit.unit) {
    case 'bytes':
      return formatBytes(value);
    case 'seconds':
      return formatSeconds(value);
    case 'us':
      return formatMicros(value);
    case null:
      return String(value);
    default:
      return formatCount(value);
  }
}

export interface LimitsSummary {
  count: number;
  /** Rows enforcing nothing at all, because their soft limit is unlimited. */
  unlimited: number;
  /** Rows the process could raise itself, with no privilege at all. */
  raisable: Limit[];
  /** Rows already at their ceiling, which take CAP_SYS_RESOURCE to move. */
  pinned: Limit[];
  /** Rows this kernel prints and no kernel since 2.4 has acted on. */
  unenforced: Limit[];
  /** Rows counted across the real user id rather than this process. */
  perUser: Limit[];
  /** `Max core file size` at zero: a crash here leaves nothing behind. */
  noCoreDumps: boolean;
  /**
   * A real-time priority with no `Max realtime timeout` behind it, which is a
   * SCHED_FIFO thread that can hold its CPU with nothing to preempt it.
   */
  realtimeWithoutTimeout: boolean;
}

export function summarize(limits: readonly Limit[]): LimitsSummary {
  const core = find(limits, 'Max core file size');
  const rtprio = find(limits, 'Max realtime priority');
  const rttime = find(limits, 'Max realtime timeout');

  return {
    count: limits.length,
    unlimited: limits.filter((limit) => limit.soft === null).length,
    raisable: limits.filter(isRaisable),
    pinned: limits.filter(isPinned),
    unenforced: limits.filter((limit) => !isEnforced(limit.name)),
    perUser: limits.filter((limit) => isPerUser(limit.name)),
    noCoreDumps: core !== null && core.soft === 0,
    // A kernel too old to have RLIMIT_RTTIME prints no such row, and that is
    // the same exposure as a row saying unlimited.
    realtimeWithoutTimeout:
      rtprio !== null && isRealtime(rtprio) && (rttime === null || rttime.soft === null),
  };
}
