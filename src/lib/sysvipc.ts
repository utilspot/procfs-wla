/**
 * The fields every System V IPC object has, which `/proc/sysvipc/shm` and
 * `/proc/sysvipc/sem` both print out of `struct kern_ipc_perm`: the key, the
 * id, the mode, and the two pairs of owner ids.
 *
 * The two files are otherwise nothing alike — one is about memory and the other
 * about counters — and each has a parser of its own. What is here is the part
 * that is one fact rather than two, `ipc/util.c` and `ipc/util.h` being where
 * the kernel keeps it: how an id is built, what a key of 0 means, and that
 * neither is printed the way it is stored.
 *
 * These take the fields rather than an object, so a parser can keep the column
 * names its own file uses — `shmid` and `semid` are the same field under two
 * spellings, and a shared shape would have to rename one of them.
 */

/**
 * How the slot and the sequence number are packed into an id, from
 * `ipc_buildid`: `IPCMNI_SHIFT`, which the `ipcmni_extend` boot parameter
 * raises to 24. Nothing in the file says which is in force, so a split of an id
 * is a reading rather than a fact.
 */
export const ID_SHIFT = 15;

/** IPC objects of one kind a default kernel can hold at once — the same number. */
export const IPCMNI = 1 << ID_SHIFT;

/** The id an owner outside the reader's user namespace reads as. */
export const OVERFLOW_ID = 65534;

/** The permission bits of a mode, which is all of it that is permissions. */
export const PERMISSION_MASK = 0o777;

/**
 * The key as everyone else writes it. The kernel prints it with `%10d` over a
 * `key_t`, which is an `int`, so a key whose top bit is set — and keys are
 * written as hex constants or come out of `ftok` — reads as a negative number:
 * `0x8e1c0001` prints as `-1910767615`.
 */
export function keyHexOf(key: number): string {
  return `0x${(key >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * `IPC_PRIVATE`: an object with no key at all, which nothing can look up and
 * only a process inheriting the id can reach.
 */
export function isPrivateKey(key: number): boolean {
  return key === 0;
}

/** The permission bits alone, whatever else the mode field carries. */
export function permissionBitsOf(mode: number): number {
  return mode & PERMISSION_MASK;
}

/** `rw-rw----`, from those bits — the spelling `ls` and `ipcs` use. */
export function formatMode(mode: number): string {
  const bits = permissionBitsOf(mode);
  return ['r', 'w', 'x', 'r', 'w', 'x', 'r', 'w', 'x']
    .map((letter, index) => ((bits & (0o400 >> index)) === 0 ? '-' : letter))
    .join('');
}

/** Whether the owner is no longer the creator, which `IPC_SET` is what does. */
export function ownerHasChanged(
  ids: Readonly<{ uid: number; gid: number; cuid: number; cgid: number }>,
): boolean {
  return ids.uid !== ids.cuid || ids.gid !== ids.cgid;
}

/** Whether an id is the one every unmapped user and group reads as. */
export function isOverflowId(id: number): boolean {
  return id === OVERFLOW_ID;
}

/**
 * Whether a printed pid names a process the reader's namespace can see. The
 * kernel prints these through `pid_nr_ns`, so 0 is a process it cannot resolve
 * rather than pid 0.
 */
export function isPidVisible(pid: number): boolean {
  return pid > 0;
}

/** The slot this id sits in, on the default packing — see {@link ID_SHIFT}. */
export function slotIn(id: number): number {
  return id % IPCMNI;
}

/**
 * How many times that slot has been used, which is what stops a stale id from
 * naming whatever took its place: ids jump by {@link IPCMNI} as slots are
 * reused rather than counting up by one.
 */
export function sequenceIn(id: number): number {
  return Math.floor(id / IPCMNI);
}

/**
 * A timestamp as the moment it is, in UTC — which is what the seconds are, and
 * saying so is cheaper than a reader guessing whose clock this was. Null for 0,
 * which every one of these times uses to mean **never**.
 */
export function formatTime(seconds: number): string | null {
  if (seconds === 0) return null;
  return `${new Date(seconds * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
