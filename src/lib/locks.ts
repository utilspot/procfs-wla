/**
 * Parser for `/proc/locks`.
 *
 * Every file lock the kernel is holding, one per line:
 *
 *    1: POSIX  ADVISORY  READ  5433 08:01:7864448 128 128
 *    2: FLOCK  ADVISORY  WRITE 2001 08:01:7864448 0 EOF
 *    8: OFDLCK ADVISORY  WRITE -1 08:01:8713209 128 191
 *
 * The fields are a number, the kind of lock, a second word whose meaning
 * depends on the kind, the access, the owning pid, the file as
 * `major:minor:inode`, and the byte range.
 *
 * Three of those are not what they look like.
 *
 * **The device numbers are hex**, printed with `%02x:%02x` while the inode
 * beside them is decimal — so `fd:00` is major 253, not 253 either. See
 * {@link majorOf}.
 *
 * **The range is inclusive at both ends**, so `128 128` is one byte at offset
 * 128 rather than an empty range, and `0 EOF` is the whole file however it
 * grows. See {@link lengthOf}.
 *
 * **The second field is only sometimes advisory or mandatory.** For a lease it
 * is the lease's state instead — `ACTIVE`, `BREAKING` or `BREAKER` — since a
 * lease is not the sort of thing that can be either. Mandatory locking was
 * removed from the kernel in 5.15, so `ADVISORY` is all a current machine
 * prints.
 *
 * A lock with processes queued behind it is followed by a line per waiter,
 * marked `->`. Those carry the blocker's number, and where a kernel omits it
 * the number is taken from the line above — see {@link parseLocks}.
 *
 * An **OFD lock** belongs to an open file description rather than to a
 * process, so the kernel has no pid to print for it and writes `-1`. See
 * {@link isOwnedByProcess}.
 */

/** What the kernel prints where a lock covers to the end of the file. */
export const EOF = 'EOF';

/** Kinds whose second field is a lease state rather than an enforcement. */
export const LEASE_KINDS: ReadonlySet<string> = new Set(['LEASE', 'DELEG']);

/** What each kind of lock is. */
export const KINDS: Readonly<Record<string, string>> = {
  POSIX: 'A POSIX byte-range lock, from fcntl(F_SETLK)',
  OFDLCK: 'An open file description lock — owned by the open file, not by a process',
  FLOCK: 'A whole-file lock from flock(2), which has no byte ranges',
  LEASE: 'A lease: the holder is told when someone else wants the file',
  DELEG: 'An NFS delegation, which is a lease handed out by the server',
  ACCESS: 'A lock being tested rather than held',
  UNKNOWN: 'A kind this kernel had no name for',
};

export interface FileLock {
  /** The blocker's number; a waiter carries the number of what it waits on. */
  id: number;
  /** True for a `->` line: a process queued behind the lock above it. */
  waiting: boolean;
  /** `POSIX`, `FLOCK`, `OFDLCK`, `LEASE`, `DELEG` … */
  kind: string;
  /** `ADVISORY`, or a lease's state — see {@link isLease}. */
  enforcement: string;
  /** `READ`, `WRITE` or `UNLCK`. */
  access: string;
  /** The owning process, or -1 for a lock no process owns. */
  pid: number;
  /** Device major, decoded from the hex the kernel prints; null if it had none. */
  major: number | null;
  minor: number | null;
  /** Inode, in decimal as printed. */
  inode: number | null;
  /** First byte the lock covers. */
  start: number;
  /** Last byte covered, or null for `EOF` — to the end, however it grows. */
  end: number | null;
}

export interface LocksInfo {
  locks: FileLock[];
}

/**
 * `1: POSIX  ADVISORY  READ  5433 08:01:7864448 128 128`, and the waiter form
 * `1: -> POSIX …` — where some kernels drop the number and leave only `->`.
 */
const LINE =
  /^(?:(\d+):)?\s*(->)?\s*(\S+)\s+(\S+)\s+(\S+)\s+(-?\d+)\s+(\S+)\s+(\d+)\s+(\d+|EOF)\s*$/;

/** `08:01:7864448`, or `<none>:0` for a lock with no inode behind it. */
const FILE_FIELD = /^([0-9a-f]+):([0-9a-f]+):(\d+)$/i;

export function parseLocks(text: string): LocksInfo {
  const locks: FileLock[] = [];
  let lastId = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = LINE.exec(line.trim());
    if (match === null) continue;

    const waiting = match[2] !== undefined;
    // A waiter whose kernel left the number off belongs to the lock above it.
    const id = match[1] === undefined ? lastId : Number(match[1]);
    if (!waiting) lastId = id;

    const file = FILE_FIELD.exec(match[7] ?? '');
    const end = match[9];

    locks.push({
      id,
      waiting,
      kind: match[3] ?? '',
      enforcement: match[4] ?? '',
      access: match[5] ?? '',
      pid: Number(match[6]),
      major: file === null ? null : Number.parseInt(file[1] ?? '', 16),
      minor: file === null ? null : Number.parseInt(file[2] ?? '', 16),
      inode: file === null ? null : Number(file[3]),
      start: Number(match[8]),
      end: end === EOF ? null : Number(end),
    });
  }

  return { locks };
}

/** What the kind of lock means, or null for one this table has no entry for. */
export function describeKind(kind: string): string | null {
  return KINDS[kind] ?? null;
}

/** Whether the second field is a lease state rather than an enforcement. */
export function isLease(lock: FileLock): boolean {
  return LEASE_KINDS.has(lock.kind);
}

/** The device major, which the kernel printed in hex. */
export function majorOf(lock: FileLock): number | null {
  return lock.major;
}

/** The device and inode as one, or null when the lock had no file behind it. */
export function fileOf(lock: FileLock): string | null {
  if (lock.major === null || lock.minor === null || lock.inode === null) return null;
  return `${lock.major}:${lock.minor}:${lock.inode}`;
}

/** A lock over the whole file, however large it becomes. */
export function isWholeFile(lock: FileLock): boolean {
  return lock.start === 0 && lock.end === null;
}

/**
 * Bytes the lock covers, both ends being inclusive — `128 128` is one byte.
 * Null when it runs to `EOF`, which has no length until the file has one.
 */
export function lengthOf(lock: FileLock): number | null {
  if (lock.end === null) return null;
  return lock.end < lock.start ? 0 : lock.end - lock.start + 1;
}

/**
 * Whether a process owns the lock. An OFD lock belongs to an open file
 * description instead, and the kernel prints -1 where its pid would go.
 */
export function isOwnedByProcess(lock: FileLock): boolean {
  return lock.pid > 0;
}

export interface KindCount {
  kind: string;
  count: number;
}

/** How many locks of each kind, commonest first. */
export function countKinds(info: LocksInfo): KindCount[] {
  const counts = new Map<string, number>();
  for (const lock of info.locks) counts.set(lock.kind, (counts.get(lock.kind) ?? 0) + 1);

  return Array.from(counts, ([kind, count]) => ({ kind, count })).sort(
    (a, b) => b.count - a.count || a.kind.localeCompare(b.kind),
  );
}

/** The waiters queued behind one lock, in the order the file lists them. */
export function waitersOf(info: LocksInfo, lock: FileLock): FileLock[] {
  return info.locks.filter((candidate) => candidate.waiting && candidate.id === lock.id);
}

export interface LocksSummary {
  total: number;
  /** Locks actually held, as opposed to processes queued behind one. */
  held: number;
  waiting: FileLock[];
  kinds: KindCount[];
  /** Locks held for writing, which are the ones that exclude others. */
  writes: number;
  /** Processes holding at least one lock. */
  processes: number;
}

export function summarize(info: LocksInfo): LocksSummary {
  const held = info.locks.filter((lock) => !lock.waiting);

  return {
    total: info.locks.length,
    held: held.length,
    waiting: info.locks.filter((lock) => lock.waiting),
    kinds: countKinds(info),
    writes: held.filter((lock) => lock.access === 'WRITE').length,
    processes: new Set(
      info.locks.filter((lock) => isOwnedByProcess(lock)).map((lock) => lock.pid),
    ).size,
  };
}
