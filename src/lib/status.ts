/**
 * Parser for `/proc/<pid>/status` — everything `/proc/<pid>/stat` says, in a
 * form meant to be read, plus a good deal that line cannot express.
 *
 *   Name:	bash
 *   State:	S (sleeping)
 *   Uid:	1000	1000	1000	1000
 *   SigCgt:	000000004b817efb
 *   CapEff:	0000000000000000
 *
 * A label, a colon, a tab, a value. What makes it worth a page is that five of
 * the most interesting lines are not values at all but **encodings**, and each
 * is misread in its own way:
 *
 * - **`Uid` and `Gid` are four ids, not one**: real, effective, saved-set and
 *   filesystem. A real that differs from an effective is a setuid binary
 *   running right now, and it is the only place in `/proc` that says so
 *   plainly. See {@link ID_KINDS}.
 * - **The signal fields are 64-bit hex masks where bit *n* is signal *n+1*.**
 *   The off-by-one is the classic bug. `SigPnd` is what is pending for **this
 *   thread** and `ShdPnd` what is pending for **the whole process** — two
 *   different queues, and a signal sent with `kill(2)` lands in the second.
 *   See {@link signalsIn}.
 * - **The `Cap` fields are bitmaps of capabilities**, and having uid 0 is not
 *   the same as holding them: a daemon that dropped its capabilities keeps
 *   uid 0 and an empty `CapEff`. `CapBnd` is a ceiling that can only ever
 *   shrink. See {@link capabilitiesIn}.
 * - **`FDSize` is not the number of open file descriptors.** It is the
 *   capacity of the table the kernel allocated, always a power of two, and it
 *   never shrinks. Counting `/proc/<pid>/fd` is the only way to the real
 *   figure. See {@link FIELDS}.
 * - **The `NS*` lines are lists, one entry per namespace the process is nested
 *   in**, outermost first. `NSpid: 3117 1` is one process that is 3117 on the
 *   host and pid 1 inside a container. See {@link namespaceDepth}.
 *
 * Nothing here assumes a field is present. Lines come and go with the kernel
 * version and the config — `Umask` arrived in 4.7, `CoreDumping` in 4.15,
 * `THP_enabled` in 5.0, `Kthread` in 6.9 — so a field this page has no note for
 * is shown as the kernel printed it rather than dropped.
 */

/** One `Label:\tvalue` line, in the order the kernel printed it. */
export interface StatusEntry {
  /** The label, without its colon — `VmRSS`. */
  name: string;
  /** Everything after the tab, trimmed. */
  value: string;
  /** 1-based, since the order is the kernel's own grouping. */
  line: number;
  raw: string;
}

export interface ProcessStatus {
  entries: StatusEntry[];
  /** Lines with no `Label:` on them, which this file does not have. */
  malformed: string[];
}

export function parseStatus(text: string): ProcessStatus {
  const status: ProcessStatus = { entries: [], malformed: [] };

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;

    const colon = raw.indexOf(':');
    // Every line is a label and a value. A line without a colon is not one —
    // keep it aside rather than inventing a field out of it.
    if (colon <= 0) {
      status.malformed.push(raw);
      continue;
    }

    status.entries.push({
      name: raw.slice(0, colon),
      value: raw.slice(colon + 1).trim(),
      line: status.entries.length + 1,
      raw,
    });
  }

  return status;
}

/** The entry for one label, or null where this kernel did not print it. */
export function find(status: ProcessStatus, name: string): StatusEntry | null {
  return status.entries.find((entry) => entry.name === name) ?? null;
}

/** The value of one label, as printed. */
export function value(status: ProcessStatus, name: string): string | null {
  return find(status, name)?.value ?? null;
}

/** One label read as a number, with a `kB` suffix taken off if it has one. */
export function num(status: ProcessStatus, name: string): number | null {
  const raw = value(status, name);
  if (raw === null) return null;

  const first = raw.replace(/\s*kB$/, '').trim().split(/\s+/)[0] ?? '';
  const parsed = Number(first);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A label the kernel prints in kilobytes, in bytes. */
export function bytes(status: ProcessStatus, name: string): number | null {
  const kilobytes = num(status, name);
  return kilobytes === null ? null : kilobytes * 1024;
}

/** A label holding several numbers — the id quads, and the namespace lists. */
export function numbers(status: ProcessStatus, name: string): number[] {
  const raw = value(status, name);
  if (raw === null || raw === '') return [];

  return raw
    .split(/\s+/)
    .map(Number)
    .filter((entry) => Number.isFinite(entry));
}

/** A label holding a hex bitmap — the signal and capability sets. */
export function mask(status: ProcessStatus, name: string): bigint | null {
  const raw = value(status, name);
  if (raw === null || !/^[0-9a-f]+$/i.test(raw.replace(/,/g, ''))) return null;

  try {
    return BigInt(`0x${raw.replace(/,/g, '')}`);
  } catch {
    return null;
  }
}

/**
 * The four ids on a `Uid` or `Gid` line, in the order the kernel prints them.
 *
 * The filesystem id is a Linux invention kept for an NFS server that had to
 * act as one user while staying killable as another. Nothing sets it on its own
 * any more — it follows the effective id — so a fourth number that differs from
 * the second is a genuine curiosity.
 */
export const ID_KINDS = ['real', 'effective', 'saved set', 'filesystem'] as const;

export interface IdSet {
  real: number;
  effective: number;
  saved: number;
  filesystem: number;
}

export function idSet(status: ProcessStatus, name: 'Uid' | 'Gid'): IdSet | null {
  const ids = numbers(status, name);
  if (ids.length < 4) return null;

  return { real: ids[0]!, effective: ids[1]!, saved: ids[2]!, filesystem: ids[3]! };
}

/**
 * Whether the process is running as somebody other than who started it — a
 * setuid binary mid-flight. The saved-set id is what lets it drop back and
 * pick the privilege up again later, which is why it is kept.
 */
export function isSetuid(ids: IdSet | null): boolean {
  return ids !== null && ids.real !== ids.effective;
}

/** Signal names 1 through 31, as every architecture Linux is usually read on numbers them. */
export const SIGNALS: Readonly<Record<number, string>> = {
  1: 'HUP',
  2: 'INT',
  3: 'QUIT',
  4: 'ILL',
  5: 'TRAP',
  6: 'ABRT',
  7: 'BUS',
  8: 'FPE',
  9: 'KILL',
  10: 'USR1',
  11: 'SEGV',
  12: 'USR2',
  13: 'PIPE',
  14: 'ALRM',
  15: 'TERM',
  16: 'STKFLT',
  17: 'CHLD',
  18: 'CONT',
  19: 'STOP',
  20: 'TSTP',
  21: 'TTIN',
  22: 'TTOU',
  23: 'URG',
  24: 'XCPU',
  25: 'XFSZ',
  26: 'VTALRM',
  27: 'PROF',
  28: 'WINCH',
  29: 'IO',
  30: 'PWR',
  31: 'SYS',
};

/** The two the C library takes for its own thread implementation. */
export const GLIBC_SIGNALS = [32, 33];

/** The first real-time signal a program may use, once glibc has had its two. */
export const RTMIN = 34;

/** The last signal there is. */
export const SIGMAX = 64;

/** Signal 9 and signal 19, which cannot be caught, blocked or ignored. */
export const UNBLOCKABLE = [9, 19];

/** What to call one signal number, real-time signals included. */
export function signalName(signal: number): string {
  const known = SIGNALS[signal];
  if (known !== undefined) return known;
  if (GLIBC_SIGNALS.includes(signal)) return `${signal} (glibc)`;
  if (signal >= RTMIN && signal <= SIGMAX) {
    return signal === RTMIN ? 'RTMIN' : `RTMIN+${signal - RTMIN}`;
  }
  return String(signal);
}

/**
 * The signals a mask holds. **Bit 0 is signal 1**, which is the whole trick:
 * the mask is a 64-bit word and the signals are numbered from one, so reading
 * bit *n* as signal *n* is off by one all the way along.
 */
export function signalsIn(bits: bigint): number[] {
  const signals: number[] = [];

  for (let bit = 0; bit < SIGMAX; bit += 1) {
    if ((bits >> BigInt(bit)) & 1n) signals.push(bit + 1);
  }

  return signals;
}

/**
 * The capabilities, by the bit that stands for each. The list has grown with
 * the kernel — `CAP_AUDIT_READ` in 3.16, `CAP_PERFMON` and `CAP_BPF` in 5.8,
 * `CAP_CHECKPOINT_RESTORE` in 5.9 — so a bit past the end of this list is a
 * kernel newer than the table rather than a broken file.
 */
export const CAPABILITIES = [
  'CAP_CHOWN',
  'CAP_DAC_OVERRIDE',
  'CAP_DAC_READ_SEARCH',
  'CAP_FOWNER',
  'CAP_FSETID',
  'CAP_KILL',
  'CAP_SETGID',
  'CAP_SETUID',
  'CAP_SETPCAP',
  'CAP_LINUX_IMMUTABLE',
  'CAP_NET_BIND_SERVICE',
  'CAP_NET_BROADCAST',
  'CAP_NET_ADMIN',
  'CAP_NET_RAW',
  'CAP_IPC_LOCK',
  'CAP_IPC_OWNER',
  'CAP_SYS_MODULE',
  'CAP_SYS_RAWIO',
  'CAP_SYS_CHROOT',
  'CAP_SYS_PTRACE',
  'CAP_SYS_PACCT',
  'CAP_SYS_ADMIN',
  'CAP_SYS_BOOT',
  'CAP_SYS_NICE',
  'CAP_SYS_RESOURCE',
  'CAP_SYS_TIME',
  'CAP_SYS_TTY_CONFIG',
  'CAP_MKNOD',
  'CAP_LEASE',
  'CAP_AUDIT_WRITE',
  'CAP_AUDIT_CONTROL',
  'CAP_SETFCAP',
  'CAP_MAC_OVERRIDE',
  'CAP_MAC_ADMIN',
  'CAP_SYSLOG',
  'CAP_WAKE_ALARM',
  'CAP_BLOCK_SUSPEND',
  'CAP_AUDIT_READ',
  'CAP_PERFMON',
  'CAP_BPF',
  'CAP_CHECKPOINT_RESTORE',
] as const;

/**
 * The one that is not like the others. Roughly a third of every capability
 * check in the kernel is this one, and a great deal of what it allows leads
 * back to full root — mounting a filesystem, or writing to another process's
 * memory. A container that grants it has not really restricted anything.
 */
export const CAP_SYS_ADMIN = 21;

/** The capabilities a mask holds, by bit. */
export function capabilitiesIn(bits: bigint): number[] {
  const held: number[] = [];

  for (let bit = 0; bit < 64; bit += 1) {
    if ((bits >> BigInt(bit)) & 1n) held.push(bit);
  }

  return held;
}

/** What to call one capability bit, including one this table has not caught up with. */
export function capabilityName(bit: number): string {
  return CAPABILITIES[bit] ?? `CAP bit ${bit}`;
}

/**
 * The fewest capabilities a kernel has ever had, and so the fewest a run of
 * ones has to reach before it is worth calling root rather than a set somebody
 * assembled. A 3.x kernel stops at 36 of them and a 5.9 one at 41.
 */
export const CAP_LAST_MIN = 35;

/**
 * Whether a set holds **every** capability this kernel has, which is what a
 * process running as real root carries.
 *
 * The count has grown with the kernel, so the test is the shape rather than a
 * number: real root's mask is an unbroken run of ones from bit 0, however many
 * there are. A set with a hole in it was assembled by something — a container
 * runtime, a systemd unit — no matter how many bits it holds, which is what
 * keeps Docker's `00000000a80425fb` from reading as root.
 */
export function isFullSet(bits: bigint): boolean {
  return bits !== 0n && (bits & (bits + 1n)) === 0n && bits >= (1n << BigInt(CAP_LAST_MIN + 1)) - 1n;
}

/** `S (sleeping)` taken apart, since the kernel names the letter for us here. */
export interface State {
  letter: string;
  name: string;
}

export function state(status: ProcessStatus): State | null {
  const raw = value(status, 'State');
  if (raw === null) return null;

  const match = /^(\S)\s*(?:\((.*)\))?$/.exec(raw);
  if (match === null) return null;

  return { letter: match[1]!, name: match[2] ?? '' };
}

/** What the `Seccomp` line's number means. */
export const SECCOMP_MODES: Readonly<Record<number, string>> = {
  0: 'off',
  1: 'strict — only read, write, _exit and sigreturn',
  2: 'a filter is installed',
};

/**
 * How many user or pid namespaces the process is nested in, counted off one of
 * the `NS*` lists. One is the ordinary case; two is a process inside a
 * container, seen from outside it.
 */
export function namespaceDepth(status: ProcessStatus): number {
  return Math.max(
    numbers(status, 'NSpid').length,
    numbers(status, 'NStgid').length,
    numbers(status, 'NSpgid').length,
  );
}

/** The pid this process has in the innermost namespace it belongs to. */
export function innermostPid(status: ProcessStatus): number | null {
  const pids = numbers(status, 'NSpid');
  return pids.length === 0 ? null : pids[pids.length - 1]!;
}

/**
 * Whether this process is pid 1 in its own namespace, which changes how the
 * kernel treats signals sent to it: **a signal with no handler installed is
 * discarded** rather than taking its default action. It is why a shell run as
 * a container's pid 1 ignores the `SIGTERM` that a stop sends, and is killed
 * ten seconds later instead.
 */
export function isNamespaceInit(status: ProcessStatus): boolean {
  return namespaceDepth(status) > 1 && innermostPid(status) === 1;
}

/** How a field's value is to be read, where it is not simply a number. */
export type Kind =
  | 'kb'
  | 'signals'
  | 'capabilities'
  | 'ids'
  | 'namespace-list'
  | 'group-list'
  | 'state'
  | 'seccomp'
  | 'flag'
  | 'cpu-mask'
  | 'count'
  | null;

export interface FieldInfo {
  kind: Kind;
  note: string;
  /** The kernel this line first appeared in, where it is recent enough to matter. */
  since?: string;
}

/** What each line is, in the order the kernel groups them. */
export const FIELDS: Readonly<Record<string, FieldInfo>> = {
  Name: {
    kind: null,
    note: 'The thread’s name, the same 15 characters /proc/<pid>/comm holds — not argv[0]',
  },
  Umask: { kind: null, note: 'The file mode bits newly created files will not get', since: '4.7' },
  State: { kind: 'state', note: 'What the scheduler has it doing, with the letter ps shows' },
  Tgid: { kind: null, note: 'The thread group — which is what everything outside the kernel calls the process id' },
  Ngid: { kind: null, note: 'NUMA group id, for the balancer that keeps related tasks on one node' },
  Pid: {
    kind: null,
    note: 'This task’s own id. For the main thread it equals Tgid; for any other thread it does not, which is the only place the difference shows',
  },
  PPid: { kind: null, note: 'The parent. A 1 here means the real parent died and init adopted it' },
  TracerPid: {
    kind: null,
    note: 'The process ptracing this one — a debugger, an strace, or something that attached and has not let go. Zero when nothing is',
  },
  Uid: {
    kind: 'ids',
    note: 'Real, effective, saved-set and filesystem user ids. The effective one is what access checks use; a real that differs from it is a setuid binary running',
  },
  Gid: { kind: 'ids', note: 'The same four, for groups' },
  FDSize: {
    kind: 'count',
    note: 'The capacity of the file descriptor table, rounded up to a power of two — not the number of open descriptors, and it never shrinks back',
  },
  Groups: { kind: 'group-list', note: 'Supplementary groups, which are checked alongside the effective one' },
  NStgid: { kind: 'namespace-list', note: 'The thread group id in each pid namespace it belongs to, outermost first' },
  NSpid: {
    kind: 'namespace-list',
    note: 'The pid in each namespace, outermost first — a second number is this process seen from inside a container',
  },
  NSpgid: { kind: 'namespace-list', note: 'The process group id in each namespace' },
  NSsid: { kind: 'namespace-list', note: 'The session id in each namespace' },
  Kthread: { kind: 'flag', note: 'Whether this is a kernel thread, said plainly rather than inferred', since: '6.9' },
  VmPeak: { kind: 'kb', note: 'The largest the address space has ever been. It never falls' },
  VmSize: { kind: 'kb', note: 'The address space right now, mapped or not — the number top calls VIRT, and the one that means least' },
  VmLck: { kind: 'kb', note: 'Memory locked into RAM with mlock, which can never be swapped' },
  VmPin: { kind: 'kb', note: 'Memory pinned by the kernel — a driver’s DMA buffer — which cannot even be moved' },
  VmHWM: { kind: 'kb', note: 'The high-water mark of resident memory: the most it has ever had in RAM at once' },
  VmRSS: {
    kind: 'kb',
    note: 'Resident right now, and the sum of the three Rss lines below. It counts a shared page in full for every process sharing it, so adding this up across processes overcounts — /proc/<pid>/smaps has PSS for that',
  },
  RssAnon: { kind: 'kb', note: 'Resident memory backed by nothing but swap: the heap and the stacks' },
  RssFile: { kind: 'kb', note: 'Resident memory backed by a file — the executable, the libraries, anything mapped' },
  RssShmem: { kind: 'kb', note: 'Resident shared memory and tmpfs pages' },
  VmData: { kind: 'kb', note: 'The private writable mappings: the data segment and the heap' },
  VmStk: { kind: 'kb', note: 'The main thread’s stack. Other threads’ stacks are ordinary mappings and are not here' },
  VmExe: { kind: 'kb', note: 'The executable’s own text' },
  VmLib: { kind: 'kb', note: 'Shared library text, which is shared with every other process using them' },
  VmPTE: { kind: 'kb', note: 'What the page tables themselves cost — which is why a sparse 1 TB mapping is not free' },
  VmSwap: { kind: 'kb', note: 'Anonymous memory written out to swap. Shared memory swapped out is not counted here' },
  HugetlbPages: { kind: 'kb', note: 'Memory in explicit huge pages, which are reserved rather than allocated', since: '4.4' },
  CoreDumping: { kind: 'flag', note: 'Set while a core dump of this process is being written', since: '4.15' },
  THP_enabled: { kind: 'flag', note: 'Whether transparent huge pages are allowed here — 0 means something called prctl(PR_SET_THP_DISABLE)', since: '5.0' },
  untag_mask: { kind: null, note: 'Which address bits are tags rather than address, where the architecture allows tagged pointers', since: '6.4' },
  Threads: { kind: 'count', note: 'Threads in this process, all sharing the memory figures above' },
  SigQ: {
    kind: null,
    note: 'Signals queued for this process’s real user id, against RLIMIT_SIGPENDING. The limit is per user, not per process',
  },
  SigPnd: { kind: 'signals', note: 'Pending for this thread alone' },
  ShdPnd: {
    kind: 'signals',
    note: 'Pending for the process as a whole — where a signal sent with kill(2) lands, to be taken by whichever thread has it unblocked',
  },
  SigBlk: { kind: 'signals', note: 'Blocked by this thread’s signal mask. SIGKILL and SIGSTOP cannot be, whatever is asked' },
  SigIgn: { kind: 'signals', note: 'Set to SIG_IGN, so they are thrown away on arrival' },
  SigCgt: {
    kind: 'signals',
    note: 'The signals with a handler installed. Everything else takes its default action — which for most of them is death',
  },
  CapInh: { kind: 'capabilities', note: 'Inheritable: what may pass through an execve, and only into a file that asked for it' },
  CapPrm: { kind: 'capabilities', note: 'Permitted: what this process is allowed to put into its effective set' },
  CapEff: {
    kind: 'capabilities',
    note: 'Effective: what the kernel actually checks against. A root process that dropped these still has uid 0 and can do nothing with it',
  },
  CapBnd: {
    kind: 'capabilities',
    note: 'The bounding set — a ceiling on what any execve here can ever gain. It only shrinks, and dropping from it is permanent for the process and its children',
  },
  CapAmb: {
    kind: 'capabilities',
    note: 'Ambient: the only way a capability survives execve of an ordinary, unprivileged file',
    since: '4.3',
  },
  NoNewPrivs: {
    kind: 'flag',
    note: 'Once set, no execve can ever gain privilege — setuid bits stop working, for this process and everything it starts. Seccomp requires it, and it can never be unset',
    since: '4.10',
  },
  Seccomp: { kind: 'seccomp', note: 'Which seccomp mode this process is under', since: '3.8' },
  Seccomp_filters: { kind: 'count', note: 'How many filters are installed, since they stack and every one runs', since: '5.9' },
  Speculation_Store_Bypass: { kind: null, note: 'Where this process stands on the Spectre v4 mitigation', since: '4.17' },
  SpeculationIndirectBranch: { kind: null, note: 'The same, for indirect branch speculation', since: '5.16' },
  Cpus_allowed: { kind: 'cpu-mask', note: 'The CPU affinity mask, in hex' },
  Cpus_allowed_list: { kind: null, note: 'The same mask, written as ranges — the readable one' },
  Mems_allowed: { kind: 'cpu-mask', note: 'The NUMA nodes this process may allocate from, in hex' },
  Mems_allowed_list: { kind: null, note: 'The same, as ranges' },
  voluntary_ctxt_switches: {
    kind: 'count',
    note: 'Times it gave up a CPU because it had to wait for something. A busy, healthy process does this constantly',
  },
  nonvoluntary_ctxt_switches: {
    kind: 'count',
    note: 'Times it was taken off a CPU still wanting one. A high count against a low voluntary count is contention for CPU rather than for I/O',
  },
};

/** What this page knows about a line, or null for one it has no note for. */
export function describeField(name: string): FieldInfo | null {
  return FIELDS[name] ?? null;
}

export interface StatusSummary {
  name: string | null;
  state: State | null;
  pid: number | null;
  ppid: number | null;
  threads: number | null;
  tracer: number | null;
  uid: IdSet | null;
  gid: IdSet | null;
  /** Real and effective differ: a setuid binary is running. */
  setuid: boolean;
  rssBytes: number | null;
  peakRssBytes: number | null;
  swapBytes: number | null;
  /** The effective capability set, and whether it is everything there is. */
  effective: bigint | null;
  bounding: bigint | null;
  fullCapabilities: boolean;
  /**
   * Holding everything the bounding set allows without that being everything —
   * a process at the ceiling something else set for it, which is the shape a
   * container's main process has.
   */
  atCeiling: boolean;
  /** Holds the capability that is a third of every check in the kernel. */
  sysAdmin: boolean;
  /** The signals with a handler, which decides what a default action kills. */
  caught: number[];
  /** Pending for the process as a whole, which is where kill(2) puts one. */
  pendingShared: number[];
  seccomp: number | null;
  noNewPrivs: boolean;
  /** Pid namespaces deep, and the pid it has in the innermost one. */
  depth: number;
  innerPid: number | null;
  /** Pid 1 of its own namespace, where unhandled signals are discarded. */
  namespaceInit: boolean;
  voluntary: number | null;
  nonvoluntary: number | null;
  /** Lines this kernel printed, and the ones this page has no note for. */
  count: number;
  unknown: StatusEntry[];
}

export function summarize(status: ProcessStatus): StatusSummary {
  const uid = idSet(status, 'Uid');
  const effective = mask(status, 'CapEff');
  const bounding = mask(status, 'CapBnd');
  const caught = mask(status, 'SigCgt');
  const pending = mask(status, 'ShdPnd');

  return {
    name: value(status, 'Name'),
    state: state(status),
    pid: num(status, 'Pid'),
    ppid: num(status, 'PPid'),
    threads: num(status, 'Threads'),
    tracer: num(status, 'TracerPid'),
    uid,
    gid: idSet(status, 'Gid'),
    setuid: isSetuid(uid),
    rssBytes: bytes(status, 'VmRSS'),
    peakRssBytes: bytes(status, 'VmHWM'),
    swapBytes: bytes(status, 'VmSwap'),
    effective,
    bounding,
    fullCapabilities: effective !== null && isFullSet(effective),
    atCeiling:
      effective !== null &&
      bounding !== null &&
      effective === bounding &&
      effective !== 0n &&
      !isFullSet(effective),
    sysAdmin: effective !== null && ((effective >> BigInt(CAP_SYS_ADMIN)) & 1n) === 1n,
    caught: caught === null ? [] : signalsIn(caught),
    pendingShared: pending === null ? [] : signalsIn(pending),
    seccomp: num(status, 'Seccomp'),
    noNewPrivs: num(status, 'NoNewPrivs') === 1,
    depth: namespaceDepth(status),
    innerPid: innermostPid(status),
    namespaceInit: isNamespaceInit(status),
    voluntary: num(status, 'voluntary_ctxt_switches'),
    nonvoluntary: num(status, 'nonvoluntary_ctxt_switches'),
    count: status.entries.length,
    unknown: status.entries.filter((entry) => describeField(entry.name) === null),
  };
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** `6.1 MiB` from a figure the kernel gave in kilobytes. */
export function formatBytes(value_: number): string {
  let size = value_;
  let unit = 0;

  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? size : size.toFixed(size < 10 ? 1 : 0)} ${BYTE_UNITS[unit]}`;
}

/** `1,842,913` — the context switch counts reach the millions. */
export function formatCount(value_: number): string {
  return value_.toLocaleString('en-US');
}

/** A list of signal names, or a word for the mask that holds none. */
export function formatSignals(signals: readonly number[]): string {
  return signals.length === 0 ? 'none' : signals.map(signalName).join(' ');
}

/** A list of capability names, or a word for the empty set. */
export function formatCapabilities(bits: readonly number[]): string {
  return bits.length === 0 ? 'none' : bits.map(capabilityName).join(' ');
}

/**
 * One line in whatever form says the most, given what it holds — with the raw
 * value left in the column beside it, as it is printed.
 */
export function decodeField(name: string, raw: string): string | null {
  const info = describeField(name);
  if (info === null) return null;

  switch (info.kind) {
    case 'kb': {
      const kilobytes = Number(raw.replace(/\s*kB$/, '').trim());
      return Number.isFinite(kilobytes) && kilobytes > 0 ? formatBytes(kilobytes * 1024) : null;
    }
    case 'signals': {
      if (!/^[0-9a-f]+$/i.test(raw)) return null;
      return formatSignals(signalsIn(BigInt(`0x${raw}`)));
    }
    case 'capabilities': {
      if (!/^[0-9a-f]+$/i.test(raw)) return null;
      const bits = BigInt(`0x${raw}`);
      const held = capabilitiesIn(bits);
      // Naming all forty-one of them says less than saying it is all of them.
      return isFullSet(bits)
        ? `every capability there is — ${held.length} on this kernel`
        : formatCapabilities(held);
    }
    case 'ids': {
      const ids = raw.split(/\s+/);
      if (ids.length < 4) return null;
      return ID_KINDS.map((kind, index) => `${kind} ${ids[index]}`).join(', ');
    }
    case 'namespace-list': {
      const ids = raw.split(/\s+/).filter((entry) => entry !== '');
      return ids.length <= 1
        ? null
        : `${ids[ids.length - 1]} in the innermost namespace, ${ids[0]} outside it`;
    }
    case 'group-list': {
      const groups = raw.split(/\s+/).filter((entry) => entry !== '');
      return groups.length === 0
        ? 'none'
        : `${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`;
    }
    case 'seccomp': {
      return SECCOMP_MODES[Number(raw)] ?? null;
    }
    case 'flag': {
      return raw === '1' ? 'yes' : raw === '0' ? 'no' : null;
    }
    case 'count': {
      const count = Number(raw);
      return Number.isFinite(count) && count >= 1000 ? formatCount(count) : null;
    }
    case 'state':
    case 'cpu-mask':
    default:
      return null;
  }
}
