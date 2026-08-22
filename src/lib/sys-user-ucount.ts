/**
 * Parser and table of facts for the twelve limits in `/proc/sys/user`.
 *
 * These are the `ucount` limits, declared together by `user_table` in
 * `kernel/ucount.c` and read the same way: **one whole number, and a ceiling
 * rather than a count**. Nothing in `/proc/sys/user` says how many of anything
 * exists — the kernel keeps the live figures beside these and publishes none of
 * them.
 *
 * They share four things, which is why they share a page:
 *
 * - **The limit is per user, per user namespace.** Every one is charged with
 *   `inc_ucount(ns, current_euid(), …)`, so it bounds what any one uid may hold
 *   in this namespace — not a total for the namespace, and not one for the
 *   machine.
 * - **The charge is recursive.** `inc_ucount` walks from the creating namespace
 *   up through every ancestor and checks each one's limit, which is what stops a
 *   user creating a user namespace to escape the limits they already have.
 * - **A new user namespace starts at `INT_MAX`.** `create_user_ns` writes
 *   {@link INT_MAX} into every one of these counters, so a container in a user
 *   namespace of its own reads two billion everywhere here — and the ancestors'
 *   counters still bind. See {@link isFresh}.
 * - **Writing needs `CAP_SYS_RESOURCE` in the owning namespace.**
 *   `set_permissions` hands that reader the `0644` the table declares and
 *   everyone else read-only access, so the mode `ls -l` shows depends on who is
 *   asking.
 *
 * What differs between them is worth a page each, and is {@link LIMITS}: what
 * one of the things is, the call that makes one, **which errno the limit turns
 * into** — `ENOSPC` for most, `EMFILE` for the two that hand out file
 * descriptors — and where the default comes from, which is one of three
 * unrelated rules.
 */

/** The ceiling the table allows, and what a new user namespace starts at. */
export const INT_MAX = 2147483647;

/** The capability that makes any of these writable rather than readable. */
export const WRITE_CAPABILITY = 'CAP_SYS_RESOURCE';

/** Where a limit's boot default comes from — three unrelated rules. */
export type DefaultSource =
  /** `fork_init`: `max_threads/2`, so it tracks the machine's memory. */
  | 'threads'
  /** A constant in the subsystem's own setup. */
  | 'fixed'
  /** 1% of addressable memory in units of what one object costs, then clamped. */
  | 'memory';

export interface UcountLimit {
  /** The file's name, which is also the last segment of its path. */
  name: string;
  /** What it bounds, as a plural noun: `cgroup namespaces`, `inotify watches`. */
  object: string;
  /** One line for the family table on every one of these pages. */
  bounds: string;
  /** The call that makes one of them. */
  createdBy: string;
  /** What that call returns once the counter is at the limit. */
  errno: string;
  defaultSource: DefaultSource;
  /** Where the boot default comes from, in words. */
  defaultNote: string;
  /** A second sysctl naming the same counter, for the four that have one. */
  alsoAt?: string;
  /** What this one in particular is worth knowing. */
  note: string;
}

/** Failure once the counter is at the ceiling. Only two of these are used. */
const ENOSPC = 'ENOSPC';
const EMFILE = 'EMFILE';

/** The default every namespace limit gets, from `fork_init`. */
const THREADS_DEFAULT = 'fork_init sets it to max_threads/2 at boot, so it tracks the memory the machine has rather than anything about the object it bounds';

/**
 * The twelve, in the order `user_table` declares them. The eight namespace
 * limits differ only in which namespace and which `CLONE_NEW*` makes one; the
 * four that are not namespaces are the same counter over other objects, and
 * they are where the interesting differences are.
 */
export const LIMITS: readonly UcountLimit[] = [
  {
    name: 'max_user_namespaces',
    object: 'user namespaces',
    bounds: 'user namespaces, which is the one that bounds the rest',
    createdBy: 'clone(CLONE_NEWUSER) or unshare(CLONE_NEWUSER)',
    errno: ENOSPC,
    defaultSource: 'threads',
    defaultNote: THREADS_DEFAULT,
    note: 'This is the file that turns unprivileged user namespaces off: set it to 0 and nothing in this namespace can make one, which is the upstream way of doing what distributions used to spell as a patch. It stops rather more than containers — a browser or a systemd unit sandboxing itself asks for one too.',
  },
  {
    name: 'max_pid_namespaces',
    object: 'pid namespaces',
    bounds: 'pid namespaces',
    createdBy: 'clone(CLONE_NEWPID) or unshare(CLONE_NEWPID)',
    errno: ENOSPC,
    defaultSource: 'threads',
    defaultNote: THREADS_DEFAULT,
    note: 'A pid namespace nests, and how deeply is bounded elsewhere: MAX_PID_NS_LEVEL caps the nesting at 32 whatever this number says. Note also that unshare here takes effect on the *children* of the caller rather than the caller, which is why the process that asked is still in the old namespace.',
  },
  {
    name: 'max_uts_namespaces',
    object: 'uts namespaces',
    bounds: 'uts namespaces — the hostname and the domain name',
    createdBy: 'clone(CLONE_NEWUTS) or unshare(CLONE_NEWUTS)',
    errno: ENOSPC,
    defaultSource: 'threads',
    defaultNote: THREADS_DEFAULT,
    note: 'The cheapest namespace there is — a copy of the six strings uname() returns — and the one whose contents /proc/sys/kernel/hostname shows. The kernel release in it is not writable, which is why /proc/asound/version names the same kernel in every namespace.',
  },
  {
    name: 'max_ipc_namespaces',
    object: 'ipc namespaces',
    bounds: 'ipc namespaces, which is what /proc/sysvipc is a view of',
    createdBy: 'clone(CLONE_NEWIPC) or unshare(CLONE_NEWIPC)',
    errno: ENOSPC,
    defaultSource: 'threads',
    defaultNote: THREADS_DEFAULT,
    note: 'This bounds the namespaces, not what is in them: how many message queues, semaphore sets and shared memory segments each may hold is /proc/sys/kernel/msgmni, sem and shmmni, and what they actually hold is /proc/sysvipc.',
  },
  {
    name: 'max_net_namespaces',
    object: 'network namespaces',
    bounds: 'network namespaces',
    createdBy: 'clone(CLONE_NEWNET) or unshare(CLONE_NEWNET)',
    errno: ENOSPC,
    defaultSource: 'threads',
    defaultNote: THREADS_DEFAULT,
    note: 'The expensive one. Each network namespace gets its own loopback device, routing tables, netfilter state and sysctl tree, so it costs hundreds of kilobytes rather than a pointer — and tearing one down waits on RCU, which is why creating and destroying them in a loop is famously slow.',
  },
  {
    name: 'max_mnt_namespaces',
    object: 'mount namespaces',
    bounds: 'mount namespaces',
    createdBy: 'clone(CLONE_NEWNS) or unshare(CLONE_NEWNS)',
    errno: ENOSPC,
    defaultSource: 'threads',
    defaultNote: THREADS_DEFAULT,
    note: 'The flag is CLONE_NEWNS rather than CLONE_NEWMNT: mount namespaces came first, and the name was never changed. This bounds the namespaces; how many mounts one may hold is /proc/sys/fs/mount-max, and copying a namespace copies every mount in it, which is what makes a busy machine expensive to unshare.',
  },
  {
    name: 'max_cgroup_namespaces',
    object: 'cgroup namespaces',
    bounds: 'cgroup namespaces',
    createdBy: 'clone(CLONE_NEWCGROUP) or unshare(CLONE_NEWCGROUP)',
    errno: ENOSPC,
    defaultSource: 'threads',
    defaultNote: THREADS_DEFAULT,
    note: 'The lightest of the eight: a cgroup namespace holds a root cgroup and nothing else, so all it changes is what /proc/<pid>/cgroup shows and where a cgroup mount lands. Creating one still needs CAP_SYS_ADMIN, which is the EPERM that comes before this limit is ever reached.',
  },
  {
    name: 'max_time_namespaces',
    object: 'time namespaces',
    bounds: 'time namespaces, which is the newest of them',
    createdBy: 'clone(CLONE_NEWTIME) or unshare(CLONE_NEWTIME)',
    errno: ENOSPC,
    defaultSource: 'threads',
    defaultNote: THREADS_DEFAULT,
    note: 'Added in 5.6, and narrower than it sounds: it offsets CLOCK_MONOTONIC and CLOCK_BOOTTIME and nothing else, so the wall clock is the same inside it. Like a pid namespace it takes effect on the children of the caller rather than the caller.',
  },
  {
    name: 'max_inotify_instances',
    object: 'inotify instances',
    bounds: 'inotify instances — one per inotify_init(), not per watch',
    createdBy: 'inotify_init() or inotify_init1()',
    errno: EMFILE,
    defaultSource: 'fixed',
    defaultNote: 'inotify_user_setup sets it to 128, a constant rather than anything derived',
    alsoAt: '/proc/sys/fs/inotify/max_user_instances',
    note: 'An instance is one file descriptor, however many watches hang off it, which is why the default of 128 is so much smaller than the watch limit — and why the failure here is EMFILE, the errno for running out of descriptors, rather than the ENOSPC the watch limit gives.',
  },
  {
    name: 'max_inotify_watches',
    object: 'inotify watches',
    bounds: 'inotify watches, the limit a file manager or an IDE runs into',
    createdBy: 'inotify_add_watch()',
    errno: ENOSPC,
    defaultSource: 'memory',
    defaultNote: 'inotify_user_setup allows 1% of addressable memory for watches, in units of what one costs, clamped to the range 8192 … 1048576',
    alsoAt: '/proc/sys/fs/inotify/max_user_watches',
    note: 'The famous one: "upper limit on inotify watches reached" is this number, and raising it is what every IDE and file-sync tool tells you to do. A watch is per directory rather than per tree, so watching a source tree recursively costs one for every directory in it.',
  },
  {
    name: 'max_fanotify_groups',
    object: 'fanotify groups',
    bounds: 'fanotify groups, where CONFIG_FANOTIFY is on',
    createdBy: 'fanotify_init()',
    errno: EMFILE,
    defaultSource: 'fixed',
    defaultNote: 'fanotify_user_setup sets it to FANOTIFY_DEFAULT_MAX_GROUPS, which is 128',
    alsoAt: '/proc/sys/fs/fanotify/max_user_groups',
    note: 'A group is fanotify’s answer to an inotify instance — one descriptor, any number of marks — and the same 128, with the same EMFILE when it runs out. Unlike inotify, opening one at all needs CAP_SYS_ADMIN for most of what it is used for.',
  },
  {
    name: 'max_fanotify_marks',
    object: 'fanotify marks',
    bounds: 'fanotify marks, which are its answer to a watch',
    createdBy: 'fanotify_mark()',
    errno: ENOSPC,
    defaultSource: 'memory',
    defaultNote: 'fanotify_user_setup allows 1% of addressable memory for marks, priced as inode marks, clamped to the range 8192 … 1048576',
    alsoAt: '/proc/sys/fs/fanotify/max_user_marks',
    note: 'A mark can be put on a whole mount or a whole filesystem as well as on one inode, which is the difference from inotify that matters: watching everything costs one mark rather than one per directory. The limit is priced as though every mark were an inode mark, which is the expensive kind.',
  },
];

/** The limit of this name, or undefined for a file that is not one of them. */
export function limitFor(name: string): UcountLimit | undefined {
  return LIMITS.find((limit) => limit.name === name);
}

export interface UcountValue {
  /** The number the file holds, which is the ceiling. */
  limit: number;
  /** The line as read, for showing what was parsed. */
  raw: string;
  /** Whether the file ended with the newline the kernel writes after it. */
  terminated: boolean;
}

/** A whole number and nothing else, which is all a `ucount` sysctl holds. */
const VALUE = /^-?\d+$/;

/** Parses the file, or returns null for anything that is not one number. */
export function parseUcount(text: string): UcountValue | null {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '');
  if (line === undefined) return null;

  const trimmed = line.trim();
  if (!VALUE.test(trimmed)) return null;

  const limit = Number(trimmed);
  // The handler is proc_doulongvec_minmax over 0..INT_MAX, so a value outside
  // that range did not come from here.
  if (!Number.isSafeInteger(limit) || limit < 0) return null;

  return { limit, raw: trimmed, terminated: text.endsWith('\n') };
}

/** Whether the limit is 0, which stops the next one being made at all. */
export function isDisabled(value: UcountValue): boolean {
  return value.limit === 0;
}

/** Whether this is the `INT_MAX` a freshly created user namespace starts at. */
export function isFresh(value: UcountValue): boolean {
  return value.limit === INT_MAX;
}

/** Whether the limit is at the ceiling the memory-derived defaults clamp to. */
export const MEMORY_CLAMP = { min: 8192, max: 1048576 } as const;

/**
 * What `/proc/sys/kernel/threads-max` would be if this limit is still the boot
 * default — only for the eight whose default is half of it, and only for a
 * value that says something about the machine rather than about itself: 0 was
 * set by somebody and `INT_MAX` is a namespace that has no limit of its own.
 */
export function impliedThreadsMax(limit: UcountLimit, value: UcountValue): number | null {
  if (limit.defaultSource !== 'threads') return null;
  if (isDisabled(value) || isFresh(value)) return null;
  return value.limit * 2;
}

/** Whether a memory-derived default has been clamped to its ceiling. */
export function isAtMemoryCeiling(limit: UcountLimit, value: UcountValue): boolean {
  return limit.defaultSource === 'memory' && value.limit === MEMORY_CLAMP.max;
}

/** The limit in prose: the number, or what it means when it is one of the two. */
export function describeValue(value: UcountValue): string {
  if (isDisabled(value)) return 'none at all';
  if (isFresh(value)) return 'no limit of its own';
  return value.limit.toLocaleString('en-US');
}

export interface UcountSummary {
  limit: number;
  disabled: boolean;
  fresh: boolean;
  impliedThreadsMax: number | null;
  atMemoryCeiling: boolean;
  terminated: boolean;
}

export function summarize(limit: UcountLimit, value: UcountValue): UcountSummary {
  return {
    limit: value.limit,
    disabled: isDisabled(value),
    fresh: isFresh(value),
    impliedThreadsMax: impliedThreadsMax(limit, value),
    atMemoryCeiling: isAtMemoryCeiling(limit, value),
    terminated: value.terminated,
  };
}
