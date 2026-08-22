/**
 * Parser for `/proc/sysvipc/msg`.
 *
 * Every System V message queue in the reader's IPC namespace, one per line under
 * a header of column names:
 *
 *        key      msqid perms      cbytes       qnum lspid lrpid   uid …
 * 1094795585          0   660           0          0  3312  3319  1000 …
 *
 * Fourteen columns, and the same fourteen on a 32- and a 64-bit kernel: every
 * width in the format string is spelled out rather than taken from the word
 * size, unlike `/proc/sysvipc/shm`.
 *
 * **This is the one IPC file that shows live state.** A segment's size and a
 * semaphore set's `nsems` are fixed when the object is made; `cbytes` and `qnum`
 * are what is sitting in the queue right now — bytes of message text, and how
 * many messages. So the questions worth asking of it are whether anything is
 * backed up and whether anybody is reading. See {@link isBackedUp} and
 * {@link wasNeverReceived}.
 *
 * Five things read wrong at first glance.
 *
 * **`cbytes` is message text only.** It is the sum of the `msgsz` of each
 * message waiting, so the `mtype` in front of each and the `struct msg_msg` the
 * kernel wraps it in are not counted — a queue of 128 tiny messages costs
 * noticeably more kernel memory than `cbytes` admits.
 *
 * **What `cbytes` is measured against is not in this file.** A queue blocks a
 * sender when `cbytes` plus the new message would pass its own `q_qbytes`, which
 * starts at `msgmnb` — 16 KiB, from `/proc/sys/kernel/msgmnb` — and which root
 * can raise per queue with `msgctl(IPC_SET)`. Nothing here prints it, so
 * {@link MSGMNB_DEFAULT} is a *default* to read against and
 * {@link hasRaisedLimit} is how a queue past it announces that its own limit
 * moved. 16 KiB is the real surprise for most people: sixteen 1 KiB messages
 * fill a queue, and the seventeenth sender blocks.
 *
 * **`qnum` says nothing about whether a waiting receiver can proceed.** Every
 * message carries a type, and `msgrcv` can ask for one: a receiver waiting for
 * type 5 blocks with a hundred messages of type 3 in front of it. So a queue can
 * be busy, non-empty, and stalled at the same time, and this file cannot show
 * that — nor how many processes are blocked on either end.
 *
 * **A pid of 0 is not pid 0.** `lspid` and `lrpid` are the last sender and the
 * last receiver, printed through `pid_nr_ns` in the namespace of whoever mounted
 * this `/proc`: 0 is a process it cannot resolve, or nothing having sent or
 * received yet. The times beside them are what tell those apart — see
 * {@link isPidVisible}.
 *
 * **A time of 0 means never.** `stime` is the last `msgsnd`, `rtime` the last
 * `msgrcv`, `ctime` the last change — creation, or `msgctl(IPC_SET)` since.
 *
 * The key, the id, the mode and the owner ids are `struct kern_ipc_perm`, read
 * through `src/lib/sysvipc.ts` as the other two `/proc/sysvipc` pages read them:
 * the key is printed signed, a key of 0 is `IPC_PRIVATE`, and `msqid` packs a
 * sequence number above a slot. `perms` is octal and carries no flags — a queue
 * has no `SHM_DEST` state to be in, since `IPC_RMID` removes it at once and
 * every blocked `msgsnd` and `msgrcv` wakes with `EIDRM`, losing whatever was
 * still in it.
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
  sequenceIn,
  slotIn,
} from './sysvipc';

/** Queues a default kernel can hold at once, from `ipc/util.h`. */
export const IPCMNI = IPC_LIMIT;

/**
 * Bytes a queue holds before a sender blocks, from `/proc/sys/kernel/msgmnb`.
 * It is the *initial* `q_qbytes` of every queue and root may raise one past it,
 * and this file prints neither — so a reading against it is a default rather
 * than a limit. See {@link hasRaisedLimit}.
 */
export const MSGMNB_DEFAULT = 16384;

/** The largest single message, from `/proc/sys/kernel/msgmax`. */
export const MSGMAX_DEFAULT = 8192;

/** What the three timestamps are, since none of them is a creation time. */
export const TIMES: Readonly<Record<'stime' | 'rtime' | 'ctime', string>> = {
  stime: 'Last msgsnd: when a process last put a message on the queue',
  rtime: 'Last msgrcv: when a process last took one off it',
  ctime: 'Last change: created, or msgctl(IPC_SET) since — not a creation time of its own',
};

export interface MsgQueue {
  /** As printed, which is signed — see {@link keyHex}. 0 is `IPC_PRIVATE`. */
  key: number;
  msqid: number;
  /** The `perms` field, which for a queue is permissions and nothing else. */
  mode: number;
  /** Bytes of message *text* waiting — not the types, not the kernel's own overhead. */
  cbytes: number;
  /** Messages waiting, whatever their types are. */
  qnum: number;
  /** Last to send and last to receive; 0 for neither visible, or for never. */
  lspid: number;
  lrpid: number;
  uid: number;
  gid: number;
  /** The creator's ids, which `msgctl(IPC_SET)` does not change. */
  cuid: number;
  cgid: number;
  /** Seconds since the epoch, or 0 for never. */
  stime: number;
  rtime: number;
  ctime: number;
}

export interface MsgInfo {
  queues: MsgQueue[];
}

/** The columns the kernel prints, which has been fourteen of them throughout. */
const FIELDS = 14;

/** The column names, which is how the header line is told from a queue. */
const HEADER = /^\s*key\s+msqid\b/;

export function parseMsg(text: string): MsgInfo {
  const queues: MsgQueue[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    if (HEADER.test(line)) continue;

    // Whitespace rather than columns: a key wide enough to overflow its `%10d`
    // pushes the rest of the line right, and a negative one is 11 characters.
    const fields = line.trim().split(/\s+/);
    if (fields.length !== FIELDS) continue;
    if (!fields.every((field) => /^-?\d+$/.test(field))) continue;

    const value = (index: number): number => Number(fields[index]);

    queues.push({
      key: value(0),
      msqid: value(1),
      // The one field that is not decimal: `%4o`.
      mode: Number.parseInt(fields[2] ?? '', 8),
      cbytes: value(3),
      qnum: value(4),
      lspid: value(5),
      lrpid: value(6),
      uid: value(7),
      gid: value(8),
      cuid: value(9),
      cgid: value(10),
      stime: value(11),
      rtime: value(12),
      ctime: value(13),
    });
  }

  return { queues };
}

/** The key as everyone else writes it, the kernel having printed it signed. */
export function keyHex(queue: MsgQueue): string {
  return keyHexOf(queue.key);
}

/** `IPC_PRIVATE`: no key at all, so nothing can look this queue up. */
export function isPrivate(queue: MsgQueue): boolean {
  return isPrivateKey(queue.key);
}

/**
 * The permission bits, which for a queue is the whole of `perms` — there is no
 * `SHM_DEST` to take out of it.
 */
export function permissionsOf(queue: MsgQueue): number {
  return permissionBitsOf(queue.mode);
}

/** `rw-rw----`, from those bits — the spelling `ls` and `ipcs -q` use. */
export function formatPermissions(queue: MsgQueue): string {
  return formatMode(queue.mode);
}

/** Whether the ownership was handed on with `msgctl(IPC_SET)` since creation. */
export function ownerChanged(queue: MsgQueue): boolean {
  return ownerHasChanged(queue);
}

/** Whether an id is the one every unmapped user reads as. */
export function isOverflowId(id: number): boolean {
  return isOverflowIpcId(id);
}

/**
 * Whether a printed pid names a process the reader's namespace can see. `lspid`
 * and `lrpid` go through `pid_nr_ns`, so 0 is a process this `/proc` cannot
 * resolve rather than pid 0 — and for a queue nothing has used yet, it is
 * simply that nothing has.
 */
export function isPidVisible(pid: number): boolean {
  return isVisiblePid(pid);
}

/** The slot the queue sits in, on the default packing — see `ID_SHIFT`. */
export function slotOf(queue: MsgQueue): number {
  return slotIn(queue.msqid);
}

/** How many times that slot has been used, which is what makes ids unrepeatable. */
export function sequenceOf(queue: MsgQueue): number {
  return sequenceIn(queue.msqid);
}

/** A timestamp as the moment it is, or null for the 0 that means never. */
export function formatTime(seconds: number): string | null {
  return formatIpcTime(seconds);
}

/** Messages are waiting: something has been sent that nothing has taken off. */
export function isBackedUp(queue: MsgQueue): boolean {
  return queue.qnum > 0;
}

/**
 * **Sent to and never read from.** Messages have gone in and no `msgrcv` has
 * ever run, which is a consumer that never started rather than one falling
 * behind.
 */
export function wasNeverReceived(queue: MsgQueue): boolean {
  return queue.stime > 0 && queue.rtime === 0;
}

/** Nothing has ever used the queue from either end. */
export function wasNeverUsed(queue: MsgQueue): boolean {
  return queue.stime === 0 && queue.rtime === 0;
}

/**
 * How full the queue is against {@link MSGMNB_DEFAULT}, as a share — over 1 for
 * a queue whose own limit has been raised past the default.
 */
export function fillShareOf(queue: MsgQueue): number {
  return queue.cbytes / MSGMNB_DEFAULT;
}

/**
 * Whether the queue holds as much as `msgmnb` allows one to by default, at which
 * point a sender blocks — unless this queue's own limit was raised, which the
 * file does not say.
 */
export function isAtDefaultLimit(queue: MsgQueue): boolean {
  return queue.cbytes >= MSGMNB_DEFAULT;
}

/**
 * Holding more than the default allows, which is only possible if `q_qbytes` was
 * raised for this queue — so the reading is that its limit moved, not that the
 * kernel let it overflow.
 */
export function hasRaisedLimit(queue: MsgQueue): boolean {
  return queue.cbytes > MSGMNB_DEFAULT;
}

/** Bytes each waiting message averages, or null for an empty queue. */
export function averageMessageOf(queue: MsgQueue): number | null {
  return queue.qnum === 0 ? null : Math.round(queue.cbytes / queue.qnum);
}

export interface MsgSummary {
  queues: number;
  /** Messages waiting across every queue. */
  messages: number;
  /** Bytes of message text waiting, which is what counts against `msgmnb`. */
  bytes: number;
  /** Queues with anything in them. */
  backedUp: MsgQueue[];
  /** Queues nothing has ever received from, though something has sent. */
  neverReceived: MsgQueue[];
  /** Queues holding as much as `msgmnb` allows one to by default. */
  atLimit: MsgQueue[];
  /** Queues nothing has used from either end. */
  unused: number;
}

export function summarize(info: MsgInfo): MsgSummary {
  return {
    queues: info.queues.length,
    messages: info.queues.reduce((total, queue) => total + queue.qnum, 0),
    bytes: info.queues.reduce((total, queue) => total + queue.cbytes, 0),
    backedUp: info.queues.filter((queue) => isBackedUp(queue)),
    neverReceived: info.queues.filter((queue) => wasNeverReceived(queue)),
    atLimit: info.queues.filter((queue) => isAtDefaultLimit(queue)),
    unused: info.queues.filter((queue) => wasNeverUsed(queue)).length,
  };
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB'];

/**
 * Binary units, the way `msgmnb` and `msgmax` are quoted — and **a decimal
 * wherever the figure needs one**, since what this page is often about is the
 * difference between a queue at 16 KiB and one at 15.5 KiB: rounding those to
 * the same number would hide the only thing being said about them.
 */
export function formatBytes(value: number): string {
  if (value === 0) return '0 B';

  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${unit === 0 || Number.isInteger(size) ? size : size.toFixed(1)} ${UNITS[unit]}`;
}
