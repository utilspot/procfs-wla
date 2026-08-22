/**
 * Parser for `/proc/<pid>/stat` — the process's own accounting line, not to be
 * confused with `/proc/stat`, which is the machine's CPU totals and has its own
 * page. One line, 52 space-separated fields on a current kernel.
 *
 *   4021 (bash) S 4019 4021 4021 34816 5122 4194304 5843 …
 *
 * **The second field cannot be split on.** `comm` is printed inside
 * parentheses and holds whatever the process called itself, which may contain
 * spaces and parentheses — systemd's helper is genuinely named `(sd-pam)`, so
 * its line reads `((sd-pam))`. A process may also name itself something shaped
 * like the rest of the line, and a parser that splits on whitespace then reads
 * every field after it wrong, on data the process chose. The only safe reading
 * is: the pid up to the first `(`, the name between that and the **last** `)`,
 * and the fields after it. See {@link parsePidStat}.
 *
 * Four more things read wrong at first glance:
 *
 * - **`rss` is in pages and `vsize` is in bytes**, in the same line. Reading
 *   field 24 as bytes understates memory by a factor of the page size. It also
 *   leaves out anything swapped out. See {@link PAGE_SIZE}.
 * - **The times are in clock ticks, and the file does not say how many are in
 *   a second.** It is `sysconf(_SC_CLK_TCK)`, which is 100 everywhere Linux
 *   runs in practice, and this page assumes that and says so. See
 *   {@link CLOCK_TICK}.
 * - **`priority` is not the nice value.** For an ordinary process it is the
 *   kernel's own scale, where 20 means a nice of 0; for a real-time one it is
 *   the negated real-time priority minus one, so `-51` is priority 50. See
 *   {@link describePriority}.
 * - **`comm` is truncated to 15 characters** and is the *thread name*, set by
 *   `prctl`, not `argv[0]` — `/proc/<pid>/cmdline` is what was actually run.
 *
 * Nine of the fields are printed and mean nothing: some were never maintained,
 * some were zeroed for security in 4.9, and the signal masks were superseded by
 * `/proc/<pid>/status` because they cannot express real-time signals. They are
 * still printed, so they are still listed — see {@link isMaintained}.
 *
 * The field count is not fixed either: the last eight arrived in 3.3 and 3.5,
 * so an older kernel prints 44 and nothing here assumes a field is present.
 */

/** Clock ticks in a second: `sysconf(_SC_CLK_TCK)`, 100 on every Linux in practice. */
export const CLOCK_TICK = 100;

/** Bytes in the page `rss` is counted in. */
export const PAGE_SIZE = 4096;

/** Characters the kernel keeps of a thread's name — `TASK_COMM_LEN` less its NUL. */
export const COMM_MAX = 15;

/** The fields in the order proc(5) numbers them, from 1. */
export const FIELD_NAMES = [
  'pid',
  'comm',
  'state',
  'ppid',
  'pgrp',
  'session',
  'tty_nr',
  'tpgid',
  'flags',
  'minflt',
  'cminflt',
  'majflt',
  'cmajflt',
  'utime',
  'stime',
  'cutime',
  'cstime',
  'priority',
  'nice',
  'num_threads',
  'itrealvalue',
  'starttime',
  'vsize',
  'rss',
  'rsslim',
  'startcode',
  'endcode',
  'startstack',
  'kstkesp',
  'kstkeip',
  'signal',
  'blocked',
  'sigignore',
  'sigcatch',
  'wchan',
  'nswap',
  'cnswap',
  'exit_signal',
  'processor',
  'rt_priority',
  'policy',
  'delayacct_blkio_ticks',
  'guest_time',
  'cguest_time',
  'start_data',
  'end_data',
  'start_brk',
  'arg_start',
  'arg_end',
  'env_start',
  'env_end',
  'exit_code',
] as const;

export type FieldName = (typeof FIELD_NAMES)[number];

/** What a field counts, which is what says how to read the number. */
export type Unit = 'ticks' | 'pages' | 'bytes' | 'address' | 'mask' | 'count' | null;

export interface FieldInfo {
  unit: Unit;
  note: string;
  /** Why the value says nothing, for a field the kernel prints and nobody keeps. */
  dead?: string;
}

export const FIELDS: Readonly<Record<FieldName, FieldInfo>> = {
  pid: { unit: null, note: 'The process id, in the namespace of whoever is reading' },
  comm: {
    unit: null,
    note: 'The thread name, truncated to 15 characters — set by prctl, and not argv[0]; /proc/<pid>/cmdline is what was run',
  },
  state: { unit: null, note: 'One letter for what the task is doing, or not doing' },
  ppid: { unit: null, note: 'The parent, or 1 where the real parent exited and init adopted it' },
  pgrp: { unit: null, note: 'Process group, which is what a terminal signals as a unit' },
  session: { unit: null, note: 'Session id — the login the process belongs to' },
  tty_nr: {
    unit: null,
    note: 'The controlling terminal as a device number, minor in the low bits; 0 for a process with none',
  },
  tpgid: {
    unit: null,
    note: 'The process group in the foreground on that terminal, or -1 without one',
  },
  flags: { unit: 'mask', note: 'The kernel’s own PF_* flags for the task' },
  minflt: {
    unit: 'count',
    note: 'Faults served without going to disk — the ordinary cost of touching new memory',
  },
  cminflt: { unit: 'count', note: 'The same, summed over children that have been waited for' },
  majflt: {
    unit: 'count',
    note: 'Faults that had to read from disk, which is what makes a process feel slow',
  },
  cmajflt: { unit: 'count', note: 'The same, summed over children that have been waited for' },
  utime: { unit: 'ticks', note: 'CPU spent in userspace' },
  stime: { unit: 'ticks', note: 'CPU spent in the kernel on this process’s behalf' },
  cutime: {
    unit: 'ticks',
    note: 'Children’s user CPU — but only children already waited for, so a parent that never reaps shows nothing',
  },
  cstime: { unit: 'ticks', note: 'The same for children’s kernel time' },
  priority: {
    unit: null,
    note: 'The kernel’s scale, not the nice value: 20 is a nice of 0, and a real-time task shows the negated real-time priority minus one',
  },
  nice: { unit: null, note: 'The nice value as a user sets it, -20 to 19' },
  num_threads: { unit: 'count', note: 'Threads in this process' },
  itrealvalue: {
    unit: 'ticks',
    note: 'Time to the next SIGALRM from an interval timer',
    dead: 'Always 0 since Linux 2.6.17',
  },
  starttime: { unit: 'ticks', note: 'When the process started, in ticks since boot' },
  vsize: {
    unit: 'bytes',
    note: 'Address space claimed — in bytes, unlike rss below, and mostly not memory in use',
  },
  rss: {
    unit: 'pages',
    note: 'Resident memory in PAGES, not bytes, and not counting anything swapped out',
  },
  rsslim: { unit: 'bytes', note: 'The RLIMIT_RSS ceiling, which nothing has enforced since 2.4.30' },
  startcode: { unit: 'address', note: 'Where the program text begins' },
  endcode: { unit: 'address', note: 'Where the program text ends' },
  startstack: { unit: 'address', note: 'The bottom of the main thread’s stack' },
  kstkesp: {
    unit: 'address',
    note: 'The stack pointer as it was inside the kernel',
    dead: 'Zeroed since Linux 4.9 unless the reader may ptrace the process',
  },
  kstkeip: {
    unit: 'address',
    note: 'The instruction pointer as it was inside the kernel',
    dead: 'Zeroed since Linux 4.9 unless the reader may ptrace the process',
  },
  signal: {
    unit: 'mask',
    note: 'Signals pending',
    dead: 'Obsolete: it cannot express real-time signals — /proc/<pid>/status says instead',
  },
  blocked: {
    unit: 'mask',
    note: 'Signals blocked',
    dead: 'Obsolete for the same reason as signal',
  },
  sigignore: { unit: 'mask', note: 'Signals ignored', dead: 'Obsolete for the same reason' },
  sigcatch: { unit: 'mask', note: 'Signals with a handler', dead: 'Obsolete for the same reason' },
  wchan: {
    unit: 'address',
    note: 'The kernel address the task is sleeping at — /proc/<pid>/wchan gives it as a name',
    dead: 'Zeroed since Linux 4.9 unless the reader may ptrace the process',
  },
  nswap: { unit: 'pages', note: 'Pages swapped', dead: 'Never maintained; always 0' },
  cnswap: { unit: 'pages', note: 'Children’s pages swapped', dead: 'Never maintained; always 0' },
  exit_signal: { unit: null, note: 'What the parent is sent when this process dies — 17 is SIGCHLD' },
  processor: { unit: null, note: 'The CPU it last ran on, which is a sample and not an affinity' },
  rt_priority: {
    unit: null,
    note: 'Real-time priority, 1 to 99 under a real-time policy and 0 otherwise',
  },
  policy: { unit: null, note: 'The scheduling policy the task runs under' },
  delayacct_blkio_ticks: {
    unit: 'ticks',
    note: 'Time spent waiting on block I/O — the number that says a process is waiting on the disk rather than working',
  },
  guest_time: { unit: 'ticks', note: 'CPU spent running a guest, for a virtual CPU thread' },
  cguest_time: { unit: 'ticks', note: 'The same, summed over children waited for' },
  start_data: { unit: 'address', note: 'Where the initialised data begins' },
  end_data: { unit: 'address', note: 'Where the initialised data ends' },
  start_brk: { unit: 'address', note: 'Where the heap can grow from' },
  arg_start: { unit: 'address', note: 'Where argv lives — what /proc/<pid>/cmdline reads' },
  arg_end: { unit: 'address', note: 'The end of argv' },
  env_start: { unit: 'address', note: 'Where the environment lives' },
  env_end: { unit: 'address', note: 'The end of the environment' },
  exit_code: { unit: null, note: 'The status a zombie exited with, in wait()’s encoding' },
};

/** What each state letter means. */
export const STATES: Readonly<Record<string, { name: string; note: string }>> = {
  R: { name: 'running', note: 'On a CPU, or on a run queue waiting for one' },
  S: {
    name: 'sleeping',
    note: 'Waiting for something, and interruptible — the ordinary state of nearly every process',
  },
  D: {
    name: 'uninterruptible sleep',
    note: 'Waiting in the kernel and refusing signals, usually on I/O. A process here cannot be killed, not even with SIGKILL, until whatever it is waiting for returns',
  },
  Z: {
    name: 'zombie',
    note: 'Exited, and kept only until the parent calls wait() for its exit status. Its memory is already gone',
  },
  T: { name: 'stopped', note: 'Stopped by a signal — SIGSTOP, or a job control ^Z' },
  t: { name: 'tracing stop', note: 'Stopped because a debugger is holding it there' },
  X: { name: 'dead', note: 'Gone, and should never be seen in this file' },
  x: { name: 'dead', note: 'Gone, and should never be seen in this file' },
  I: { name: 'idle', note: 'An idle kernel thread, which is not counted in the load average' },
  K: { name: 'wakekill', note: 'An older kernel’s state for a sleep that SIGKILL may break' },
  W: { name: 'waking', note: 'An older kernel’s transient waking state' },
  P: { name: 'parked', note: 'A kernel thread parked and not running' },
};

/** The scheduling policies, by the number `policy` carries. */
export const POLICIES: Readonly<Record<number, { name: string; realtime: boolean }>> = {
  0: { name: 'SCHED_OTHER', realtime: false },
  1: { name: 'SCHED_FIFO', realtime: true },
  2: { name: 'SCHED_RR', realtime: true },
  3: { name: 'SCHED_BATCH', realtime: false },
  4: { name: 'SCHED_ISO', realtime: false },
  5: { name: 'SCHED_IDLE', realtime: false },
  6: { name: 'SCHED_DEADLINE', realtime: true },
};

export interface StatField {
  /** 1-based, as proc(5) numbers them. */
  number: number;
  name: FieldName;
  /** Exactly as printed. */
  raw: string;
}

export interface ProcessStat {
  /** The fields this kernel printed, in order. Empty for a line that is not one. */
  fields: StatField[];
  /** The name between the parentheses, before anything is made of it. */
  comm: string | null;
  raw: string;
}

/**
 * Reads the line.
 *
 * The name is taken from between the **first** `(` and the **last** `)`, which
 * is the only reading that survives a process naming itself with parentheses,
 * spaces, or something shaped like the rest of the line. Splitting on
 * whitespace would let a process choose what every field after its name
 * appears to say.
 */
export function parsePidStat(text: string): ProcessStat {
  const raw = text.trim();
  const open = raw.indexOf('(');
  const close = raw.lastIndexOf(')');

  if (open === -1 || close < open) return { fields: [], comm: null, raw };

  const pid = raw.slice(0, open).trim();
  const comm = raw.slice(open + 1, close);
  const rest = raw
    .slice(close + 1)
    .trim()
    .split(/\s+/)
    .filter((value) => value !== '');

  if (!/^\d+$/.test(pid) || rest.length === 0) return { fields: [], comm: null, raw };

  const values = [pid, comm, ...rest];
  return {
    fields: values
      .slice(0, FIELD_NAMES.length)
      .map((value, index) => ({ number: index + 1, name: FIELD_NAMES[index]!, raw: value })),
    comm,
    raw,
  };
}

/** One field as printed, or null on a kernel that did not print it. */
export function field(stat: ProcessStat, name: FieldName): string | null {
  return stat.fields.find((entry) => entry.name === name)?.raw ?? null;
}

/** One field as a number, or null where it is absent or is not one. */
export function num(stat: ProcessStat, name: FieldName): number | null {
  const value = field(stat, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** What a field counts and means, which every field has. */
export function describeField(name: FieldName): FieldInfo {
  return FIELDS[name];
}

/** Whether anything still keeps this field up to date. */
export function isMaintained(name: FieldName): boolean {
  return FIELDS[name].dead === undefined;
}

/** What the state letter means, or null for one this page does not know. */
export function describeState(state: string | null): { name: string; note: string } | null {
  return state === null ? null : (STATES[state] ?? null);
}

/** Ticks as the seconds they stand for, at {@link CLOCK_TICK} to the second. */
export function ticksToSeconds(ticks: number): number {
  return ticks / CLOCK_TICK;
}

/** Pages as the bytes they stand for, at {@link PAGE_SIZE} to the page. */
export function pagesToBytes(pages: number): number {
  return pages * PAGE_SIZE;
}

/**
 * What the `priority` field is saying, which depends on the policy. For an
 * ordinary task it is the kernel's own scale, where 20 is a nice of 0; for a
 * real-time one it is `-1 - rt_priority`, so -51 is a real-time priority of 50.
 */
export function describePriority(stat: ProcessStat): string | null {
  const priority = num(stat, 'priority');
  if (priority === null) return null;

  if (priority < 0) return `real-time priority ${-priority - 1}`;
  return `nice ${priority - 20} on the kernel’s 0–39 scale`;
}

/** The policy this task runs under, or null for a number this page does not know. */
export function describePolicy(stat: ProcessStat): { name: string; realtime: boolean } | null {
  const policy = num(stat, 'policy');
  return policy === null ? null : (POLICIES[policy] ?? null);
}

/**
 * Whether the name is at the length the kernel truncates to, so the real one
 * may be longer. Fifteen characters exactly is the tell; there is no flag.
 */
export function isCommTruncated(stat: ProcessStat): boolean {
  return (stat.comm?.length ?? 0) >= COMM_MAX;
}

/**
 * Whether this name would have broken a parser that split the line on
 * whitespace — a space or a parenthesis inside it is all it takes.
 */
export function isCommAwkward(stat: ProcessStat): boolean {
  return stat.comm !== null && /[\s()]/.test(stat.comm);
}

export interface StatSummary {
  pid: number | null;
  comm: string | null;
  state: string | null;
  ppid: number | null;
  threads: number | null;
  /** CPU seconds, from fields the kernel counts in ticks. */
  userSeconds: number | null;
  systemSeconds: number | null;
  cpuSeconds: number | null;
  /** Seconds waited on block I/O. */
  blkioSeconds: number | null;
  /** Resident bytes, from a field counted in pages. */
  rssBytes: number | null;
  vsizeBytes: number | null;
  nice: number | null;
  priority: string | null;
  policy: { name: string; realtime: boolean } | null;
  processor: number | null;
  majorFaults: number | null;
  /** How many fields this kernel printed. */
  count: number;
  /** The fields it printed that nothing maintains. */
  dead: StatField[];
  commTruncated: boolean;
  commAwkward: boolean;
}

export function summarize(stat: ProcessStat): StatSummary {
  const seconds = (name: FieldName): number | null => {
    const ticks = num(stat, name);
    return ticks === null ? null : ticksToSeconds(ticks);
  };

  const user = seconds('utime');
  const system = seconds('stime');
  const rssPages = num(stat, 'rss');

  return {
    pid: num(stat, 'pid'),
    comm: stat.comm,
    state: field(stat, 'state'),
    ppid: num(stat, 'ppid'),
    threads: num(stat, 'num_threads'),
    userSeconds: user,
    systemSeconds: system,
    cpuSeconds: user === null || system === null ? null : user + system,
    blkioSeconds: seconds('delayacct_blkio_ticks'),
    rssBytes: rssPages === null ? null : pagesToBytes(rssPages),
    vsizeBytes: num(stat, 'vsize'),
    nice: num(stat, 'nice'),
    priority: describePriority(stat),
    policy: describePolicy(stat),
    processor: num(stat, 'processor'),
    majorFaults: num(stat, 'majflt'),
    count: stat.fields.length,
    dead: stat.fields.filter((entry) => !isMaintained(entry.name)),
    commTruncated: isCommTruncated(stat),
    commAwkward: isCommAwkward(stat),
  };
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** `6.1 MiB` — the memory figures run from kilobytes to gigabytes. */
export function formatBytes(value: number): string {
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? size : size.toFixed(size < 10 ? 1 : 0)} ${BYTE_UNITS[unit]}`;
}

/** `42.1 s`, and minutes or hours once it has been running a while. */
export function formatSeconds(value: number): string {
  if (value < 60) return `${value.toFixed(value < 10 ? 2 : 1)} s`;
  if (value < 3600) return `${(value / 60).toFixed(1)} min`;
  return `${(value / 3600).toFixed(1)} h`;
}

/** `1,842,913` — the fault counts reach the millions. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * One field in whatever form says the most, given what it counts — with the
 * raw value left to the column beside it.
 */
export function formatField(name: FieldName, raw: string): string | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;

  switch (FIELDS[name].unit) {
    case 'ticks':
      return value === 0 ? null : formatSeconds(ticksToSeconds(value));
    case 'pages':
      return value === 0 ? null : formatBytes(pagesToBytes(value));
    case 'bytes':
      return value === 0 ? null : formatBytes(value);
    case 'count':
      return value < 1000 ? null : formatCount(value);
    case 'address':
      return value === 0 ? null : `0x${value.toString(16)}`;
    case 'mask':
      return value === 0 ? null : `0x${value.toString(16)}`;
    default:
      return null;
  }
}
