/**
 * Parser for `/proc/sysvipc/sem`.
 *
 * Every System V semaphore set in the reader's IPC namespace, one per line under
 * a header of column names:
 *
 *        key      semid perms      nsems   uid   gid  cuid  cgid      otime      ctime
 * 1330400761          0   600          1  1000  1000  1000  1000 1786700468 1786689672
 *
 * Ten columns, and the same ten on a 32- and a 64-bit kernel: nothing here is a
 * `long`, so unlike `/proc/sysvipc/shm` the widths never move.
 *
 * **What is not in it is the point.** `nsems` is how many semaphores the set
 * holds, not what any of them is worth: the values are only reachable through
 * `semctl(GETALL)`, and nothing here says how many processes are blocked on one
 * or which process last touched it. So this file answers what sets exist, how
 * big they are, and who owns them — and no question about what they are doing.
 *
 * **A set lives until something removes it.** `semget` creates one and
 * `semctl(IPC_RMID)` is what ends it: a process that exits without doing so
 * leaves the set behind, holding kernel memory until `ipcrm` or a reboot. There
 * is no attach count to spot that with, the way `/proc/sysvipc/shm` has
 * `nattch`, so what this file offers instead is `otime` — see
 * {@link wasNeverUsed}.
 *
 * Five things read wrong at first glance.
 *
 * **`otime` is not stored.** It is `get_semotime`, the newest `sem_otime` of any
 * semaphore in the set: since the fine-grained locking of 3.10 the time of the
 * last operation is kept per semaphore rather than per set, so the file prints a
 * maximum computed as it reads. 0 means no `semop` has ever run on the set.
 *
 * **`ctime` moves for more than a change of ownership.** Creation sets it, and
 * so do `semctl(IPC_SET)`, `SETVAL` and `SETALL` — so a `ctime` newer than the
 * `otime` beside it means somebody wrote the values rather than waited on them.
 *
 * **`perms` is octal**, printed `%4o`, but it carries no flags: a semaphore set
 * has no `SHM_DEST` to be in, because there is nothing attached to wait for —
 * `IPC_RMID` removes it at once and every waiter wakes with `EIDRM`. So a mode
 * of `600` here is only a mode. See {@link permissionsOf}.
 *
 * **The key is printed signed, and a key of 0 is no key.** Both are
 * `struct kern_ipc_perm` and both are read through `src/lib/sysvipc.ts`, which
 * is where the rest of this app's IPC readings live.
 *
 * **`semid` is not an index** but a sequence number packed above a slot, so ids
 * jump by 32,768 as slots are reused. Same {@link slotOf} as everywhere else.
 *
 * One thing this file has none of: **pids**. `/proc/sysvipc/shm` prints the
 * creator and the last process to attach; this one prints neither, so a set
 * cannot be traced back to a process from here at all — `ipcs -s -i <id>` and
 * `semctl(GETPID)` are what answer that.
 */

import {
  formatMode,
  formatTime as formatIpcTime,
  IPCMNI as IPC_LIMIT,
  isOverflowId as isOverflowIpcId,
  isPrivateKey,
  keyHexOf,
  ownerHasChanged,
  permissionBitsOf,
  sequenceIn,
  slotIn,
} from './sysvipc';

/** Sets a default kernel can hold at once, from `ipc/util.h`. */
export const IPCMNI = IPC_LIMIT;

/**
 * Semaphores one set may hold, which is `SEMMSL` — the first number in
 * `/proc/sys/kernel/sem`, 32,000 since 4.9 and 250 before it. A set printing
 * that many is at the ceiling rather than merely large.
 */
export const SEMMSL_DEFAULT = 32000;

/** What the two timestamps are, since neither of them is a creation time. */
export const TIMES: Readonly<Record<'otime' | 'ctime', string>> = {
  otime:
    'Last semop on any semaphore in the set — computed as the newest of them, not stored per set',
  ctime: 'Last change: created, or semctl(IPC_SET), SETVAL or SETALL since',
};

export interface SemSet {
  /** As printed, which is signed — see {@link keyHex}. 0 is `IPC_PRIVATE`. */
  key: number;
  semid: number;
  /** The `perms` field, which for a semaphore set is permissions and nothing else. */
  mode: number;
  /** How many semaphores the set holds — a size, not a value. */
  nsems: number;
  uid: number;
  gid: number;
  /** The creator's ids, which `semctl(IPC_SET)` does not change. */
  cuid: number;
  cgid: number;
  /** Seconds since the epoch, or 0 for never. */
  otime: number;
  ctime: number;
}

export interface SemInfo {
  sets: SemSet[];
}

/** The columns the kernel prints, which has been ten of them throughout. */
const FIELDS = 10;

/** The column names, which is how the header line is told from a set. */
const HEADER = /^\s*key\s+semid\b/;

export function parseSem(text: string): SemInfo {
  const sets: SemSet[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    if (HEADER.test(line)) continue;

    // Whitespace rather than columns: a key wide enough to overflow its `%10d`
    // pushes the rest of the line right, and a negative one is 11 characters.
    const fields = line.trim().split(/\s+/);
    if (fields.length !== FIELDS) continue;
    if (!fields.every((field) => /^-?\d+$/.test(field))) continue;

    const value = (index: number): number => Number(fields[index]);

    sets.push({
      key: value(0),
      semid: value(1),
      // The one field that is not decimal: `%4o`.
      mode: Number.parseInt(fields[2] ?? '', 8),
      nsems: value(3),
      uid: value(4),
      gid: value(5),
      cuid: value(6),
      cgid: value(7),
      otime: value(8),
      ctime: value(9),
    });
  }

  return { sets };
}

/** The key as everyone else writes it, the kernel having printed it signed. */
export function keyHex(set: SemSet): string {
  return keyHexOf(set.key);
}

/** `IPC_PRIVATE`: no key at all, so nothing can look this set up. */
export function isPrivate(set: SemSet): boolean {
  return isPrivateKey(set.key);
}

/**
 * The permission bits, which for a semaphore set is the whole of `perms` —
 * there is no `SHM_DEST` to take out of it.
 */
export function permissionsOf(set: SemSet): number {
  return permissionBitsOf(set.mode);
}

/** `rw-rw----`, from those bits — the spelling `ls` and `ipcs -s` use. */
export function formatPermissions(set: SemSet): string {
  return formatMode(set.mode);
}

/** Whether the ownership was handed on with `semctl(IPC_SET)` since creation. */
export function ownerChanged(set: SemSet): boolean {
  return ownerHasChanged(set);
}

/** Whether an id is the one every unmapped user reads as. */
export function isOverflowId(id: number): boolean {
  return isOverflowIpcId(id);
}

/** The slot the set sits in, on the default packing — see `ID_SHIFT`. */
export function slotOf(set: SemSet): number {
  return slotIn(set.semid);
}

/** How many times that slot has been used, which is what makes ids unrepeatable. */
export function sequenceOf(set: SemSet): number {
  return sequenceIn(set.semid);
}

/** A timestamp as the moment it is, or null for the 0 that means never. */
export function formatTime(seconds: number): string | null {
  return formatIpcTime(seconds);
}

/**
 * **Nothing has ever operated on this set.** `otime` is 0, so it was created and
 * never used: a process that died between `semget` and its first `semop`, or
 * something that took the set and then took another path.
 *
 * It is the nearest this file comes to `nattch`, and it is not the same thing: a
 * set in daily use by a program nobody remembers looks busy, and a set that was
 * used once a year ago looks used. Neither this nor anything else here says
 * whether somebody still holds it.
 */
export function wasNeverUsed(set: SemSet): boolean {
  return set.otime === 0;
}

/**
 * Whether the values were written after the last operation — `SETVAL` or
 * `SETALL` moved `ctime` past `otime`, which is somebody setting the set up
 * rather than waiting on it.
 */
export function wasSetAfterUse(set: SemSet): boolean {
  return set.otime > 0 && set.ctime > set.otime;
}

/** A set of one, which is a mutex and the commonest set there is. */
export function isSingle(set: SemSet): boolean {
  return set.nsems === 1;
}

/** Whether the set holds as many semaphores as `SEMMSL` allows one to. */
export function isAtSemmsl(set: SemSet): boolean {
  return set.nsems >= SEMMSL_DEFAULT;
}

export interface SemSummary {
  sets: number;
  /** Semaphores across every set, which is what `SEMMNS` caps machine-wide. */
  semaphores: number;
  /** The largest set, since `nsems` is what `SEMMSL` caps one at. */
  largest: number;
  /** Sets of one, which are mutexes. */
  mutexes: number;
  /** Sets nothing has ever operated on. */
  neverUsed: SemSet[];
  /** Semaphores those hold, which is the memory nothing is using. */
  neverUsedSemaphores: number;
}

export function summarize(info: SemInfo): SemSummary {
  const neverUsed = info.sets.filter((set) => wasNeverUsed(set));

  return {
    sets: info.sets.length,
    semaphores: info.sets.reduce((total, set) => total + set.nsems, 0),
    largest: info.sets.reduce((most, set) => Math.max(most, set.nsems), 0),
    mutexes: info.sets.filter((set) => isSingle(set)).length,
    neverUsed,
    neverUsedSemaphores: neverUsed.reduce((total, set) => total + set.nsems, 0),
  };
}
