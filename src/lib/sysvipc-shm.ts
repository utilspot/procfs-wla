/**
 * Parser for `/proc/sysvipc/shm`.
 *
 * Every System V shared memory segment in the reader's IPC namespace, one per
 * line under a header of column names:
 *
 *        key      shmid perms                  size  cpid  lpid nattch   uid …
 *          0          0  1600               2359296  2731 12282      2  1000 …
 *
 * `shmget` makes a segment, `shmat` maps it into a process, and it then lives
 * **until something removes it** — not until the last process exits. That is
 * the whole reason to read this file: a segment nobody is attached to is
 * memory the machine is holding for nobody, and nothing will reclaim it on its
 * own. See {@link isOrphaned}.
 *
 * Seven things in it are not what they look like.
 *
 * **`perms` is octal, and it is not only permissions.** It is printed with
 * `%4o` and carries the four `SHM_*` mode bits above the permission bits, so
 * `1600` is `0600` plus `SHM_DEST` — the segment has been removed with
 * `shmctl(IPC_RMID)` and is waiting for the last detach. That is the `dest`
 * `ipcs -m` shows. See {@link FLAGS} and {@link flagsOf}.
 *
 * **The key is printed signed.** `%10d` over a `key_t`, which is an `int`, so a
 * key whose top bit is set — and keys are usually written as hex constants or
 * come out of `ftok` — reads as a negative number: `0x8e1c0001` prints as
 * `-1910767615`. {@link keyHex} is the unsigned reading everyone else uses.
 *
 * **Key 0 is not a key.** It is `IPC_PRIVATE`: a segment with no name, which
 * nothing can look up and only a process inheriting the id can reach. See
 * {@link isPrivate}.
 *
 * **`shmid` is not an index.** `ipc_buildid` packs a sequence number above the
 * slot — `(seq << 15) + slot` on a default kernel — so ids jump by 32,768 as
 * slots are reused, which is what stops a stale id naming a new segment. The
 * split is a *reading* rather than a fact: the `ipcmni_extend` boot parameter
 * moves the shift to 24. See {@link slotOf} and {@link sequenceOf}.
 *
 * **`size` is what was asked for; `rss` is what exists.** Pages are allocated
 * on first touch, so a fresh 8 GiB segment has an `rss` of 0 and grows as it is
 * written. `rss` counts whole pages, so it can also be *larger*: 56 bytes cost
 * a page. See {@link isUntouched}.
 *
 * **A pid of 0 is not a process.** `cpid` and `lpid` are printed through
 * `pid_nr_ns` in the namespace of whoever mounted this `/proc`, so a segment
 * created by a process that namespace cannot see has 0 where its pid would go —
 * as does a segment nothing has attached yet, in `lpid`'s case. Same for the
 * ids: an owner outside the reader's user namespace reads as the overflow id,
 * 65534. See {@link isPidVisible}.
 *
 * **A time of 0 means never**, not the epoch. `atime` is the last `shmat`,
 * `dtime` the last `shmdt`, `ctime` the last *change* — creation, or an
 * `shmctl(IPC_SET)` since. See {@link TIMES}.
 *
 * Two shapes of the file exist beyond that, and neither can be read by column
 * position:
 *
 * - **`rss` and `swap` are 3.2 and later.** A kernel before that prints
 *   fourteen columns ending at `ctime`, so those two are null here rather than
 *   zero — nothing was said, which is not the same as nothing resident. See
 *   {@link hasMemoryColumns}.
 * - **The columns are wider on a 64-bit kernel.** `size`, `rss` and `swap` are
 *   printed `%21lu` there and `%10lu` on a 32-bit one, header included. So this
 *   splits on whitespace and counts fields.
 *
 * The key, the id, the mode and the owner ids are `struct kern_ipc_perm`, which
 * every IPC object has and `/proc/sysvipc/sem` prints the same way — see
 * `src/lib/sysvipc.ts`, which is where those readings live.
 */

import {
  formatMode,
  formatTime as formatIpcTime,
  IPCMNI as IPC_LIMIT,
  isOverflowId as isOverflowIpcId,
  isPidVisible as isVisiblePid,
  isPrivateKey,
  keyHexOf,
  ownerHasChanged,
  permissionBitsOf,
  PERMISSION_MASK as IPC_PERMISSION_MASK,
  sequenceIn,
  slotIn,
} from './sysvipc';

/** The bits `perms` carries above the permissions, from `include/linux/shm.h`. */
export const FLAGS: ReadonlyArray<{ name: string; bit: number; description: string }> = [
  {
    name: 'dest',
    bit: 0o1000,
    description:
      'SHM_DEST: removed with shmctl(IPC_RMID) and waiting for the last detach — it goes then',
  },
  {
    name: 'locked',
    bit: 0o2000,
    description: 'SHM_LOCKED: pinned in memory by shmctl(SHM_LOCK), so none of it can be swapped',
  },
  {
    name: 'hugetlb',
    bit: 0o4000,
    description: 'SHM_HUGETLB: backed by huge pages, which are reserved rather than paged in',
  },
  {
    name: 'noreserve',
    bit: 0o10000,
    description: 'SHM_NORESERVE: no swap was reserved for it, so a write can fail late',
  },
];

/** The permission bits, which is what is left of `perms` once the flags are out. */
export const PERMISSION_MASK = IPC_PERMISSION_MASK;

/** What the three timestamps are, since none of them is a creation time. */
export const TIMES: Readonly<Record<'atime' | 'dtime' | 'ctime', string>> = {
  atime: 'Last shmat: when a process last attached this segment',
  dtime: 'Last shmdt: when a process last detached it',
  ctime: 'Last change: created, or shmctl(IPC_SET) since — not a creation time of its own',
};

/** Segments a default kernel can hold at once, from `ipc/util.h`. */
export const IPCMNI = IPC_LIMIT;

export interface ShmSegment {
  /** As printed, which is signed — see {@link keyHex}. 0 is `IPC_PRIVATE`. */
  key: number;
  shmid: number;
  /** The whole `perms` field: permission bits and the `SHM_*` flags above them. */
  mode: number;
  /** Bytes `shmget` was asked for, which is not what is resident. */
  size: number;
  /** Creator, and the last process to attach or detach; 0 for neither visible. */
  cpid: number;
  lpid: number;
  /** Attachments, not processes: one process can attach the same segment twice. */
  nattch: number;
  uid: number;
  gid: number;
  /** The creator's ids, which `shmctl(IPC_SET)` does not change. */
  cuid: number;
  cgid: number;
  /** Seconds since the epoch, or 0 for never. */
  atime: number;
  dtime: number;
  ctime: number;
  /** Bytes resident and in swap, or null on a kernel that prints neither. */
  rss: number | null;
  swap: number | null;
}

export interface ShmInfo {
  segments: ShmSegment[];
  /** Whether the file said anything about `rss` and `swap` — see 3.2, above. */
  memory: boolean;
}

/** Fields a modern kernel prints, and what one before 3.2 stopped at. */
const FIELDS = 16;
const FIELDS_WITHOUT_MEMORY = 14;

/** The column names, which is how the header line is told from a segment. */
const HEADER = /^\s*key\s+shmid\b/;

export function parseShm(text: string): ShmInfo {
  const segments: ShmSegment[] = [];
  let memory = false;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    // The header carries the one fact the rows cannot: whether this kernel
    // prints rss and swap at all, on a machine that has no segments to show it.
    if (HEADER.test(line)) {
      memory = /\brss\b/.test(line);
      continue;
    }

    // Whitespace, not columns: the widths differ between a 32- and a 64-bit
    // kernel, and the header's own labels do not line up with either.
    const fields = line.trim().split(/\s+/);
    if (fields.length !== FIELDS && fields.length !== FIELDS_WITHOUT_MEMORY) continue;

    const value = (index: number): number => Number(fields[index]);
    if (!fields.every((field) => /^-?\d+$/.test(field))) continue;

    const resident = fields.length === FIELDS;
    if (resident) memory = true;

    segments.push({
      key: value(0),
      shmid: value(1),
      // The one field that is not decimal: `%4o`, permissions and flags at once.
      mode: Number.parseInt(fields[2] ?? '', 8),
      size: value(3),
      cpid: value(4),
      lpid: value(5),
      nattch: value(6),
      uid: value(7),
      gid: value(8),
      cuid: value(9),
      cgid: value(10),
      atime: value(11),
      dtime: value(12),
      ctime: value(13),
      rss: resident ? value(14) : null,
      swap: resident ? value(15) : null,
    });
  }

  return { segments, memory };
}

/** Whether this file said anything about what is resident — 3.2 and later. */
export function hasMemoryColumns(info: ShmInfo): boolean {
  return info.memory;
}

/**
 * The key as everyone else writes it: `0x8e1c0001` for the `-1910767615` the
 * kernel prints, since `key_t` is signed and a key is a bit pattern.
 */
export function keyHex(segment: ShmSegment): string {
  return keyHexOf(segment.key);
}

/** `IPC_PRIVATE`: no key at all, so nothing can look this segment up. */
export function isPrivate(segment: ShmSegment): boolean {
  return isPrivateKey(segment.key);
}

/** The permission bits alone, with the `SHM_*` flags taken out. */
export function permissionsOf(segment: ShmSegment): number {
  return permissionBitsOf(segment.mode);
}

/** `rw-rw----`, from those bits — the spelling `ls` and `ipcs -m` use. */
export function formatPermissions(segment: ShmSegment): string {
  return formatMode(segment.mode);
}

/** The `SHM_*` flags this segment's mode carries, in bit order. */
export function flagsOf(segment: ShmSegment): typeof FLAGS {
  return FLAGS.filter((flag) => (segment.mode & flag.bit) !== 0);
}

/** Removed already, and waiting for the last process to let go. */
export function isMarkedForDestruction(segment: ShmSegment): boolean {
  return (segment.mode & 0o1000) !== 0;
}

/** Pinned in memory, so nothing here can be swapped whatever the pressure. */
export function isLocked(segment: ShmSegment): boolean {
  return (segment.mode & 0o2000) !== 0;
}

/** Backed by huge pages, which are reserved up front rather than faulted in. */
export function isHugePages(segment: ShmSegment): boolean {
  return (segment.mode & 0o4000) !== 0;
}

/**
 * **Nothing is attached, and nothing will remove it**: the segment outlives
 * every process that ever used it, and only `ipcrm`, a matching
 * `shmctl(IPC_RMID)` or a reboot frees what it holds.
 *
 * A segment already marked for destruction is not one of these — it goes on the
 * last detach, which is why the pairing cannot be observed the other way round:
 * `SHM_DEST` with nothing attached is destroyed rather than printed.
 */
export function isOrphaned(segment: ShmSegment): boolean {
  return segment.nattch === 0 && !isMarkedForDestruction(segment);
}

/** Nothing has ever attached it, which is a stronger statement than orphaned. */
export function wasNeverAttached(segment: ShmSegment): boolean {
  return segment.atime === 0;
}

/**
 * Not a page of it exists yet. Shared memory is allocated on first touch, so a
 * segment can be attached, mapped and entirely absent — null on a kernel that
 * does not print `rss`, where the question cannot be answered.
 */
export function isUntouched(segment: ShmSegment): boolean | null {
  if (segment.rss === null) return null;
  return segment.rss === 0 && (segment.swap ?? 0) === 0;
}

/** Bytes that are real: resident plus whatever went to swap. */
export function allocatedOf(segment: ShmSegment): number | null {
  if (segment.rss === null) return null;
  return segment.rss + (segment.swap ?? 0);
}

/** Whether the ownership was handed on with `shmctl(IPC_SET)` since creation. */
export function ownerChanged(segment: ShmSegment): boolean {
  return ownerHasChanged(segment);
}

/**
 * Whether a printed pid names a process the reader's namespace can see: `cpid`
 * and `lpid` go through `pid_nr_ns`, so 0 is a process this `/proc` cannot
 * resolve rather than pid 0.
 */
export function isPidVisible(pid: number): boolean {
  return isVisiblePid(pid);
}

/** Whether an id is the one every unmapped user reads as. */
export function isOverflowId(id: number): boolean {
  return isOverflowIpcId(id);
}

/** The slot the segment sits in, on the default packing — see `ID_SHIFT`. */
export function slotOf(segment: ShmSegment): number {
  return slotIn(segment.shmid);
}

/** How many times that slot has been used, which is what makes ids unrepeatable. */
export function sequenceOf(segment: ShmSegment): number {
  return sequenceIn(segment.shmid);
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** Binary units, the way a segment's size is quoted. */
export function formatBytes(value: number): string {
  if (value === 0) return '0 B';

  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}

/** A timestamp as the moment it is, or null for the 0 that means never. */
export function formatTime(seconds: number): string | null {
  return formatIpcTime(seconds);
}

export interface ShmSummary {
  segments: number;
  /** Bytes asked for, added up — which is not what the machine is holding. */
  size: number;
  /** And what it is holding, or null on a kernel that does not say. */
  resident: number | null;
  swapped: number | null;
  /** Attachments across every segment, which is not a count of processes. */
  attachments: number;
  /** Segments nothing is attached to and nothing will remove. */
  orphaned: ShmSegment[];
  /** Bytes those are holding, which is the figure worth acting on. */
  orphanedBytes: number | null;
  /** Segments already removed, waiting on their last detach. */
  destroying: ShmSegment[];
  locked: number;
  hugePages: number;
}

export function summarize(info: ShmInfo): ShmSummary {
  const orphaned = info.segments.filter((segment) => isOrphaned(segment));
  const sum = (pick: (segment: ShmSegment) => number | null, of: ShmSegment[]): number | null =>
    info.memory ? of.reduce((total, segment) => total + (pick(segment) ?? 0), 0) : null;

  return {
    segments: info.segments.length,
    size: info.segments.reduce((total, segment) => total + segment.size, 0),
    resident: sum((segment) => segment.rss, info.segments),
    swapped: sum((segment) => segment.swap, info.segments),
    attachments: info.segments.reduce((total, segment) => total + segment.nattch, 0),
    orphaned,
    orphanedBytes: sum((segment) => allocatedOf(segment), orphaned),
    destroying: info.segments.filter((segment) => isMarkedForDestruction(segment)),
    locked: info.segments.filter((segment) => isLocked(segment)).length,
    hugePages: info.segments.filter((segment) => isHugePages(segment)).length,
  };
}
