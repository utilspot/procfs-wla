/**
 * Parser for `/proc/<pid>/syscall` — where a process is, right now, in one line.
 *
 * The kernel prints one of three things, and they are three different shapes
 * rather than three values of one:
 *
 *   running
 *   -1 0x7ffc8e2a1b30 0x7f2c4d1e8a41
 *   0 0x0 0x7ffd3c4f2a10 0x2000 0x0 0x0 0x0 0x7ffd3c4f29c8 0x7f8e2a0f4b52
 *
 * **`running` is an answer, not an error.** The task is on a CPU, so its
 * registers cannot be read consistently and the kernel declines rather than
 * guessing. A process that keeps saying this is busy, not blocked.
 *
 * **`-1` means it is not in a syscall at all** — running in userspace, with
 * only the stack and instruction pointers to show. That line has three fields,
 * not nine, which is what catches a parser that splits and counts.
 *
 * Otherwise the line is the **syscall number, six argument registers, the
 * stack pointer and the instruction pointer**. Three things about it read
 * wrong at first glance:
 *
 * - **It is a sample, not a trace.** By the time it is read the process may be
 *   somewhere else entirely; `strace` is the tool for a sequence. What it is
 *   good for is a process that is *stuck*, where reading it twice gives the
 *   same answer and that answer is the reason.
 * - **Six arguments are always printed, however many the call takes.** The
 *   rest are whatever was left in those registers. See {@link describeSyscall}.
 * - **The number means nothing without knowing the architecture**, which this
 *   file does not say. Number 202 is `futex` on x86-64 and `accept` on arm64.
 *   See {@link namesFor} — the page shows both rather than picking one.
 *
 * The file is mode 0400 and gated by `ptrace` access on top of that, so unlike
 * `/proc/<pid>/cmdline` it is not readable across users. On a kernel built
 * without `CONFIG_HAVE_ARCH_TRACEHOOK` it does not exist at all.
 */

export type Abi = 'x86_64' | 'arm64';

export const ABIS: readonly { id: Abi; label: string }[] = [
  { id: 'x86_64', label: 'x86-64' },
  { id: 'arm64', label: 'arm64' },
];

/**
 * Where the numberings stop disagreeing. Every syscall from `pidfd_send_signal`
 * on has been allocated the same number on every architecture, so a number at
 * or above this one means the same thing everywhere — and one below it does not.
 */
export const COMMON_FROM = 424;

/** Allocated identically on every architecture since Linux 5.1. */
const COMMON: Readonly<Record<number, string>> = {
  424: 'pidfd_send_signal',
  425: 'io_uring_setup',
  426: 'io_uring_enter',
  427: 'io_uring_register',
  428: 'open_tree',
  429: 'move_mount',
  430: 'fsopen',
  431: 'fsconfig',
  432: 'fsmount',
  433: 'fspick',
  434: 'pidfd_open',
  435: 'clone3',
  436: 'close_range',
  437: 'openat2',
  438: 'pidfd_getfd',
  439: 'faccessat2',
  440: 'process_madvise',
  441: 'epoll_pwait2',
  442: 'mount_setattr',
  443: 'quotactl_fd',
  447: 'memfd_secret',
  448: 'process_mrelease',
  449: 'futex_waitv',
  450: 'set_mempolicy_home_node',
  451: 'cachestat',
  452: 'fchmodat2',
  454: 'futex_wake',
  455: 'futex_wait',
  456: 'futex_requeue',
};

/** `arch/x86/entry/syscalls/syscall_64.tbl`, as far as this page goes. */
const X86_64: Readonly<Record<number, string>> = {
  0: 'read',
  1: 'write',
  2: 'open',
  3: 'close',
  4: 'stat',
  5: 'fstat',
  6: 'lstat',
  7: 'poll',
  8: 'lseek',
  9: 'mmap',
  10: 'mprotect',
  11: 'munmap',
  12: 'brk',
  13: 'rt_sigaction',
  14: 'rt_sigprocmask',
  15: 'rt_sigreturn',
  16: 'ioctl',
  17: 'pread64',
  18: 'pwrite64',
  19: 'readv',
  20: 'writev',
  21: 'access',
  22: 'pipe',
  23: 'select',
  24: 'sched_yield',
  25: 'mremap',
  26: 'msync',
  27: 'mincore',
  28: 'madvise',
  32: 'dup',
  33: 'dup2',
  34: 'pause',
  35: 'nanosleep',
  39: 'getpid',
  40: 'sendfile',
  41: 'socket',
  42: 'connect',
  43: 'accept',
  44: 'sendto',
  45: 'recvfrom',
  46: 'sendmsg',
  47: 'recvmsg',
  48: 'shutdown',
  49: 'bind',
  50: 'listen',
  56: 'clone',
  57: 'fork',
  58: 'vfork',
  59: 'execve',
  60: 'exit',
  61: 'wait4',
  62: 'kill',
  63: 'uname',
  72: 'fcntl',
  73: 'flock',
  74: 'fsync',
  75: 'fdatasync',
  78: 'getdents',
  79: 'getcwd',
  80: 'chdir',
  87: 'unlink',
  89: 'readlink',
  96: 'gettimeofday',
  97: 'getrlimit',
  98: 'getrusage',
  101: 'ptrace',
  102: 'getuid',
  110: 'getppid',
  128: 'rt_sigtimedwait',
  130: 'rt_sigsuspend',
  131: 'sigaltstack',
  157: 'prctl',
  158: 'arch_prctl',
  186: 'gettid',
  200: 'tkill',
  202: 'futex',
  203: 'sched_setaffinity',
  204: 'sched_getaffinity',
  217: 'getdents64',
  218: 'set_tid_address',
  219: 'restart_syscall',
  228: 'clock_gettime',
  229: 'clock_getres',
  230: 'clock_nanosleep',
  231: 'exit_group',
  232: 'epoll_wait',
  233: 'epoll_ctl',
  234: 'tgkill',
  247: 'waitid',
  257: 'openat',
  262: 'newfstatat',
  263: 'unlinkat',
  270: 'pselect6',
  271: 'ppoll',
  281: 'epoll_pwait',
  283: 'timerfd_create',
  284: 'eventfd',
  286: 'timerfd_settime',
  288: 'accept4',
  290: 'eventfd2',
  291: 'epoll_create1',
  293: 'pipe2',
  299: 'recvmmsg',
  302: 'prlimit64',
  307: 'sendmmsg',
  309: 'getcpu',
  318: 'getrandom',
  319: 'memfd_create',
  321: 'bpf',
  322: 'execveat',
  332: 'statx',
  334: 'rseq',
  ...COMMON,
};

/** `include/uapi/asm-generic/unistd.h`, which arm64 and riscv both use. */
const ARM64: Readonly<Record<number, string>> = {
  0: 'io_setup',
  1: 'io_destroy',
  2: 'io_submit',
  3: 'io_cancel',
  4: 'io_getevents',
  5: 'setxattr',
  6: 'lsetxattr',
  7: 'fsetxattr',
  8: 'getxattr',
  9: 'lgetxattr',
  10: 'fgetxattr',
  11: 'listxattr',
  12: 'llistxattr',
  13: 'flistxattr',
  14: 'removexattr',
  15: 'lremovexattr',
  16: 'fremovexattr',
  17: 'getcwd',
  19: 'eventfd2',
  20: 'epoll_create1',
  21: 'epoll_ctl',
  22: 'epoll_pwait',
  23: 'dup',
  24: 'dup3',
  25: 'fcntl',
  29: 'ioctl',
  32: 'flock',
  35: 'unlinkat',
  43: 'statfs',
  44: 'fstatfs',
  46: 'ftruncate',
  47: 'fallocate',
  48: 'faccessat',
  49: 'chdir',
  56: 'openat',
  57: 'close',
  59: 'pipe2',
  61: 'getdents64',
  62: 'lseek',
  63: 'read',
  64: 'write',
  65: 'readv',
  66: 'writev',
  67: 'pread64',
  68: 'pwrite64',
  71: 'sendfile',
  72: 'pselect6',
  73: 'ppoll',
  78: 'readlinkat',
  79: 'newfstatat',
  80: 'fstat',
  82: 'fsync',
  83: 'fdatasync',
  85: 'timerfd_create',
  86: 'timerfd_settime',
  88: 'utimensat',
  93: 'exit',
  94: 'exit_group',
  95: 'waitid',
  96: 'set_tid_address',
  98: 'futex',
  101: 'nanosleep',
  113: 'clock_gettime',
  114: 'clock_getres',
  115: 'clock_nanosleep',
  117: 'ptrace',
  122: 'sched_setaffinity',
  123: 'sched_getaffinity',
  124: 'sched_yield',
  128: 'restart_syscall',
  129: 'kill',
  130: 'tkill',
  131: 'tgkill',
  132: 'sigaltstack',
  133: 'rt_sigsuspend',
  134: 'rt_sigaction',
  135: 'rt_sigprocmask',
  137: 'rt_sigtimedwait',
  160: 'uname',
  167: 'prctl',
  168: 'getcpu',
  172: 'getpid',
  173: 'getppid',
  174: 'getuid',
  178: 'gettid',
  179: 'sysinfo',
  198: 'socket',
  200: 'bind',
  201: 'listen',
  202: 'accept',
  203: 'connect',
  206: 'sendto',
  207: 'recvfrom',
  211: 'sendmsg',
  212: 'recvmsg',
  214: 'brk',
  215: 'munmap',
  216: 'mremap',
  220: 'clone',
  221: 'execve',
  222: 'mmap',
  226: 'mprotect',
  227: 'msync',
  232: 'mincore',
  233: 'madvise',
  242: 'accept4',
  243: 'recvmmsg',
  260: 'wait4',
  261: 'prlimit64',
  269: 'sendmmsg',
  278: 'getrandom',
  279: 'memfd_create',
  280: 'bpf',
  281: 'execveat',
  291: 'statx',
  293: 'rseq',
  ...COMMON,
};

const TABLES: Readonly<Record<Abi, Readonly<Record<number, string>>>> = {
  x86_64: X86_64,
  arm64: ARM64,
};

/** What this number is called on one architecture, or null if not in the table. */
export function syscallName(nr: number, abi: Abi): string | null {
  return TABLES[abi][nr] ?? null;
}

/** Whether this number means the same thing on every architecture. */
export function isCommonNumber(nr: number): boolean {
  return nr >= COMMON_FROM;
}

export interface AbiName {
  abi: Abi;
  label: string;
  /** Null where this page's table has no entry for the number. */
  name: string | null;
}

/**
 * What the number is called under each architecture. The file does not say
 * which one it was written on, so both are offered rather than one guessed at.
 */
export function namesFor(nr: number): AbiName[] {
  return ABIS.map(({ id, label }) => ({ abi: id, label, name: syscallName(nr, id) }));
}

/**
 * Whether the architectures disagree about what this number is. A number this
 * page has no entry for on one of them is a gap in the table rather than a
 * disagreement, so it does not count.
 */
export function namesDiffer(nr: number): boolean {
  const named = namesFor(nr)
    .map((entry) => entry.name)
    .filter((name) => name !== null);
  return new Set(named).size > 1;
}

export interface SyscallInfo {
  /** The parameters it takes, in order. Registers past these are leftovers. */
  params: string[];
  /** What it does, and why a process is likely to be found sitting in it. */
  note: string;
}

/**
 * What the calls a process is plausibly *caught* in take and mean, by name —
 * by name rather than by number, so one entry serves every architecture.
 *
 * The value of the arity here is that the kernel always prints six argument
 * registers whatever the call takes, and the ones past the end hold whatever
 * was left in them. Without this the page would be showing four made-up
 * arguments to `read`.
 */
export const SYSCALLS: Readonly<Record<string, SyscallInfo>> = {
  read: {
    params: ['fd', 'buf', 'count'],
    note: 'Waiting for bytes on a descriptor — a pipe, socket or terminal with nothing in it yet',
  },
  write: {
    params: ['fd', 'buf', 'count'],
    note: 'Handing bytes to a descriptor, and blocked if the other end is not taking them',
  },
  pread64: { params: ['fd', 'buf', 'count', 'offset'], note: 'A read at an explicit offset' },
  pwrite64: { params: ['fd', 'buf', 'count', 'offset'], note: 'A write at an explicit offset' },
  readv: { params: ['fd', 'iov', 'iovcnt'], note: 'A read scattered into several buffers' },
  writev: { params: ['fd', 'iov', 'iovcnt'], note: 'A write gathered from several buffers' },
  poll: {
    params: ['fds', 'nfds', 'timeout'],
    note: 'Waiting for any of a set of descriptors — a timeout of -1 means forever',
  },
  ppoll: {
    params: ['fds', 'nfds', 'timeout', 'sigmask', 'sigsetsize'],
    note: 'poll with a signal mask, so a signal can break the wait',
  },
  select: {
    params: ['nfds', 'readfds', 'writefds', 'exceptfds', 'timeout'],
    note: 'The older wait on a set of descriptors',
  },
  pselect6: {
    params: ['nfds', 'readfds', 'writefds', 'exceptfds', 'timeout', 'sigmask'],
    note: 'select with a signal mask',
  },
  epoll_wait: {
    params: ['epfd', 'events', 'maxevents', 'timeout'],
    note: 'An event loop at rest, waiting for something to happen — the usual place to find a server',
  },
  epoll_pwait: {
    params: ['epfd', 'events', 'maxevents', 'timeout', 'sigmask', 'sigsetsize'],
    note: 'epoll_wait with a signal mask',
  },
  epoll_pwait2: {
    params: ['epfd', 'events', 'maxevents', 'timeout', 'sigmask'],
    note: 'epoll_wait with a nanosecond timeout',
  },
  futex: {
    params: ['uaddr', 'op', 'val', 'timeout', 'uaddr2', 'val3'],
    note: 'A thread parked on a lock or condition variable — where a blocked mutex actually waits',
  },
  futex_waitv: {
    params: ['waiters', 'nr_futexes', 'flags', 'timeout', 'clockid'],
    note: 'Waiting on several futexes at once',
  },
  nanosleep: { params: ['req', 'rem'], note: 'Sleeping for a fixed interval' },
  clock_nanosleep: {
    params: ['clockid', 'flags', 'req', 'rem'],
    note: 'Sleeping against a named clock, which is what a timed wait usually compiles to',
  },
  pause: { params: [], note: 'Waiting for any signal at all, and nothing else' },
  wait4: {
    params: ['pid', 'wstatus', 'options', 'rusage'],
    note: 'Waiting for a child to exit — a shell between commands lives here',
  },
  waitid: { params: ['idtype', 'id', 'infop', 'options', 'rusage'], note: 'Waiting for a child' },
  accept: {
    params: ['sockfd', 'addr', 'addrlen'],
    note: 'A server waiting for the next connection',
  },
  accept4: {
    params: ['sockfd', 'addr', 'addrlen', 'flags'],
    note: 'accept, setting the new descriptor’s flags in the same call',
  },
  connect: {
    params: ['sockfd', 'addr', 'addrlen'],
    note: 'Reaching out to the other end, and blocked until it answers or the attempt times out',
  },
  recvfrom: {
    params: ['sockfd', 'buf', 'len', 'flags', 'src_addr', 'addrlen'],
    note: 'Waiting for a datagram or stream bytes',
  },
  recvmsg: { params: ['sockfd', 'msg', 'flags'], note: 'Waiting for a message on a socket' },
  recvmmsg: {
    params: ['sockfd', 'msgvec', 'vlen', 'flags', 'timeout'],
    note: 'Waiting for several messages in one call',
  },
  sendto: {
    params: ['sockfd', 'buf', 'len', 'flags', 'dest_addr', 'addrlen'],
    note: 'Sending, and blocked if the send buffer is full',
  },
  sendmsg: { params: ['sockfd', 'msg', 'flags'], note: 'Sending a message on a socket' },
  openat: {
    params: ['dirfd', 'pathname', 'flags', 'mode'],
    note: 'Opening a file — and blocked here means the filesystem itself is slow to answer',
  },
  close: { params: ['fd'], note: 'Closing a descriptor' },
  fsync: {
    params: ['fd'],
    note: 'Waiting for the disk to confirm the data is really written — often the slowest call a process makes',
  },
  fdatasync: { params: ['fd'], note: 'fsync without the metadata, and just as slow to return' },
  ioctl: {
    params: ['fd', 'request', 'argp'],
    note: 'Whatever this driver decided the call means; the request number says which',
  },
  flock: { params: ['fd', 'operation'], note: 'Waiting for a whole-file lock' },
  fcntl: { params: ['fd', 'cmd', 'arg'], note: 'Descriptor housekeeping, or a byte-range lock' },
  mmap: {
    params: ['addr', 'length', 'prot', 'flags', 'fd', 'offset'],
    note: 'Mapping memory — the one common call that really does use all six registers',
  },
  munmap: { params: ['addr', 'length'], note: 'Unmapping memory' },
  brk: { params: ['addr'], note: 'Moving the top of the heap' },
  madvise: { params: ['addr', 'length', 'advice'], note: 'Telling the kernel how memory will be used' },
  execve: { params: ['pathname', 'argv', 'envp'], note: 'Replacing this process with another program' },
  clone: {
    params: ['flags', 'stack', 'parent_tid', 'child_tid', 'tls'],
    note: 'Starting a thread or a process',
  },
  clone3: { params: ['args', 'size'], note: 'clone with its arguments in a struct, so it can grow' },
  exit_group: { params: ['status'], note: 'Every thread in the process on its way out' },
  io_uring_enter: {
    params: ['fd', 'to_submit', 'min_complete', 'flags', 'sig', 'sigsz'],
    note: 'Submitting to a ring and waiting on completions, which is how a process waits on many things at once without a call per event',
  },
  ptrace: { params: ['request', 'pid', 'addr', 'data'], note: 'A debugger driving another process' },
  rt_sigtimedwait: {
    params: ['set', 'info', 'timeout', 'sigsetsize'],
    note: 'Waiting for one of a set of signals rather than handling it',
  },
  rt_sigsuspend: { params: ['mask', 'sigsetsize'], note: 'Waiting for a signal under a mask' },
  restart_syscall: {
    params: [],
    note: 'The kernel resuming a call a signal interrupted — not something a program calls itself',
  },
  sched_yield: { params: [], note: 'Giving up the CPU without waiting for anything' },
  getrandom: { params: ['buf', 'buflen', 'flags'], note: 'Reading randomness, which can block early in boot' },
  statx: { params: ['dirfd', 'pathname', 'flags', 'mask', 'statxbuf'], note: 'Asking about a file' },
};

/** What a named call takes and means, or null for one this page has no note for. */
export function describeSyscall(name: string | null): SyscallInfo | null {
  return name === null ? null : (SYSCALLS[name] ?? null);
}

/** What the file said about where the process is. */
export type SyscallState =
  /** On a CPU: its registers cannot be sampled, so the kernel declines. */
  | 'running'
  /** Blocked, or at least entered, in a system call. */
  | 'in-syscall'
  /** In userspace, with no call in progress — the `-1` line. */
  | 'not-in-syscall'
  /** Nothing this parser recognises. */
  | 'unreadable';

export interface SyscallSample {
  state: SyscallState;
  /** The call number, or null where the file gave none. */
  nr: number | null;
  /** The six argument registers as printed, or null where none were. */
  args: string[] | null;
  /** Stack pointer, as printed. */
  sp: string | null;
  /** Instruction pointer, as printed. */
  ip: string | null;
  /** The line as it was read, trimmed. */
  raw: string;
}

/** How many argument registers the kernel prints, whatever the call takes. */
export const ARG_REGISTERS = 6;

const LINE = /^(-?\d+)((?:\s+0x[0-9a-fA-F]+)*)\s*$/;

export function parseSyscall(text: string): SyscallSample {
  const raw = text.trim();
  const empty: SyscallSample = { state: 'unreadable', nr: null, args: null, sp: null, ip: null, raw };

  if (raw === '') return empty;
  if (raw === 'running') return { ...empty, state: 'running' };

  const line = LINE.exec(raw);
  if (line === null) return empty;

  const nr = Number(line[1]);
  const values = (line[2] ?? '').trim().split(/\s+/).filter((value) => value !== '');

  // The two shapes the kernel prints: nine fields in a call, three out of one.
  if (values.length === ARG_REGISTERS + 2) {
    return {
      state: 'in-syscall',
      nr,
      args: values.slice(0, ARG_REGISTERS),
      sp: values[ARG_REGISTERS]!,
      ip: values[ARG_REGISTERS + 1]!,
      raw,
    };
  }

  if (values.length === 2) {
    return { state: nr < 0 ? 'not-in-syscall' : 'unreadable', nr, args: null, sp: values[0]!, ip: values[1]!, raw };
  }

  return empty;
}

/** Below this, a register value is a count or a descriptor rather than an address. */
export const SMALL = 0x100000n;

export function toBigInt(hex: string): bigint {
  return BigInt(hex);
}

/** The same value read as a signed 64-bit integer, which is how `-1` gets in. */
export function asSigned(hex: string): bigint {
  const value = toBigInt(hex);
  return value >= 1n << 63n ? value - (1n << 64n) : value;
}

/**
 * A register value in the form that says the most: small numbers as decimals,
 * `0xffffffffffffffff` as the -1 it stands for, and anything large left as the
 * address it is.
 */
export function decimal(hex: string): string | null {
  const value = toBigInt(hex);
  if (value < SMALL) return value.toString();

  const signed = asSigned(hex);
  return signed < 0n && signed > -SMALL ? signed.toString() : null;
}

/** Whether this register holds an address rather than a number worth reading. */
export function isAddress(hex: string): boolean {
  return decimal(hex) === null;
}

/** What one number is on one architecture, and what that call does. */
export interface AbiCall extends AbiName {
  info: SyscallInfo | null;
}

/**
 * The call under each architecture, with what each one takes. Described per
 * architecture rather than once: where the two disagree there are two calls to
 * explain, and explaining neither — which an earlier version of this did —
 * loses the answer in exactly the common case.
 */
export function callsFor(nr: number): AbiCall[] {
  return namesFor(nr).map((entry) => ({ ...entry, info: describeSyscall(entry.name) }));
}

export interface SyscallSummary {
  state: SyscallState;
  nr: number | null;
  /** The call under each architecture. */
  calls: AbiCall[];
  /** Whether the architectures disagree, which is the point of showing both. */
  ambiguous: boolean;
  /** Whether the number means the same thing everywhere. */
  common: boolean;
  /**
   * How many of the six registers carry an argument — the most any of the
   * candidate calls takes, so nothing is called a leftover that some reading
   * of the number would have used. Null where no candidate is known.
   */
  arity: number | null;
}

/**
 * The names this register has: two where the architectures read the number as
 * different calls, since it genuinely means both — and one where they agree,
 * rather than the same word twice.
 */
export function paramsAt(summary: SyscallSummary, index: number): AbiName[] {
  const named = summary.calls.flatMap((call) =>
    call.info?.params[index] === undefined
      ? []
      : [{ abi: call.abi, label: call.label, name: call.info.params[index]! }],
  );

  const distinct = new Set(named.map((param) => param.name));
  return distinct.size === 1 ? named.slice(0, 1) : named;
}

export function summarize(sample: SyscallSample): SyscallSummary {
  if (sample.nr === null || sample.nr < 0) {
    return {
      state: sample.state,
      nr: sample.nr,
      calls: [],
      ambiguous: false,
      common: false,
      arity: null,
    };
  }

  const calls = callsFor(sample.nr);
  const arities = calls
    .map((call) => call.info?.params.length)
    .filter((length) => length !== undefined);

  return {
    state: sample.state,
    nr: sample.nr,
    calls,
    ambiguous: namesDiffer(sample.nr),
    common: isCommonNumber(sample.nr),
    arity: arities.length === 0 ? null : Math.max(...arities),
  };
}
