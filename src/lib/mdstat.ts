/**
 * Parser for `/proc/mdstat`.
 *
 * The state of every software RAID array the md driver has assembled. Unlike
 * the rest of `/proc`, a record here is **several lines**: a header naming the
 * array and its members, then continuation lines indented under it.
 *
 *    Personalities : [raid1] [raid6] [raid5] [raid4]
 *    md127 : active raid5 sdd1[3](F) sdc1[2] sdb1[1] sda1[0]
 *          11720658432 blocks super 1.2 level 5, 512k chunk, algorithm 2 [4/3] [UUU_]
 *          bitmap: 3/22 pages [12KB], 65536KB chunk
 *
 *    unused devices: <none>
 *
 * The two fields that say whether the array is healthy are the pair at the end
 * of the blocks line. `[4/3]` is **members expected over members working**, and
 * `[UUU_]` is one character per member position: `U` for up and `_` for a hole
 * where a member should be. An array missing one is running degraded — still
 * serving data, with no redundancy left to lose. See {@link isDegraded}.
 *
 * A member carries its position in the array in brackets and then its state in
 * parentheses, one letter each: see {@link MEMBER_FLAGS}. A failed member is
 * still listed, marked `(F)`, until it is removed.
 *
 * A progress line means the array is rebuilding — and **which word it uses
 * matters**, since the four mean quite different things. See {@link ACTIONS}.
 * That line is sometimes only `resync=DELAYED` or `resync=PENDING`, with no
 * percentage at all, when the kernel has queued the work behind another array.
 *
 * The `Personalities` line is the RAID levels this kernel can drive, built in
 * or from a module. An array whose level is missing from it cannot be started.
 */

/** What each letter after a member's position means. */
export const MEMBER_FLAGS: Readonly<Record<string, string>> = {
  F: 'faulty — failed, and still listed until it is removed',
  S: 'spare — not carrying data, waiting to replace something',
  W: 'write-mostly — read from only when nothing else can serve it',
  J: 'journal — the write journal rather than a data member',
  R: 'replacement — taking over from a member still in place',
};

/** What the kernel is doing when it prints a progress line. */
export const ACTIONS: Readonly<Record<string, string>> = {
  resync: 'Making the members agree again, after an unclean shutdown or a fresh array',
  recovery: 'Rebuilding a replacement member from the others — the redundancy is gone until it ends',
  reshape: 'Changing the geometry: growing the array, or moving to another level',
  check: 'Reading everything and comparing, without changing any data',
  repair: 'Reading everything and writing back what disagrees',
};

/** Progress the kernel has queued rather than started. */
export const QUEUED = ['DELAYED', 'PENDING'] as const;

export interface MdMember {
  /** Block device, as the kernel names it. */
  device: string;
  /** Its position in the array. */
  role: number;
  /** State letters, in the order printed. */
  flags: string[];
}

export interface MdProgress {
  /** `resync`, `recovery`, `reshape`, `check` or `repair`. */
  action: string;
  /** How far along, or null when the work is only queued. */
  percent: number | null;
  done: number | null;
  total: number | null;
  /** The kernel's estimate, in minutes, or null. */
  finishMinutes: number | null;
  speedKBs: number | null;
  /** `DELAYED` or `PENDING` when the work has not started. */
  queued: string | null;
}

export interface MdBitmap {
  pagesUsed: number;
  pagesTotal: number;
  sizeKB: number;
  chunkKB: number;
}

export interface MdArray {
  /** `md0`, `md127` … */
  name: string;
  /** `active`, `inactive`, and any parenthesised state beside it. */
  state: string[];
  /** `raid1`, `raid5`, `linear` … null on an array with no level to run. */
  level: string | null;
  members: MdMember[];
  /** Size in 1 KiB blocks, as the kernel counts it. */
  blocks: number | null;
  /** Metadata version, e.g. `1.2`. */
  metadata: string | null;
  /** Members the array expects, from `[4/3]`. */
  expected: number | null;
  /** Members actually working, from the same pair. */
  working: number | null;
  /** One character per position: `U` up, `_` a hole. */
  status: string | null;
  progress: MdProgress | null;
  bitmap: MdBitmap | null;
  /** The rest of the blocks line, which differs by level. */
  geometry: string | null;
}

export interface MdstatInfo {
  /** RAID levels this kernel can drive. */
  personalities: string[];
  arrays: MdArray[];
  /** Devices md knows of but has not assembled; empty for `<none>`. */
  unused: string[];
}

const PERSONALITIES = /^Personalities\s*:\s*(.*)$/;
/** An array's name always begins `md`, which is what keeps other files out. */
const ARRAY = /^(md\S*)\s*:\s*(.*)$/;
const MEMBER = /^(\S+?)\[(\d+)\]((?:\([A-Z]\))*)$/;
const BLOCKS = /^(\d+)\s+blocks\b\s*(.*)$/;
const METADATA = /\bsuper\s+(\S+)/;
const COUNTS = /\[(\d+)\/(\d+)\]/;
const STATUS = /\[([U_]+)\]/;
const PROGRESS =
  /^\[[=>.]*\]\s*(\w+)\s*=\s*([\d.]+)%\s*\((\d+)\/(\d+)\)\s*finish=([\d.]+)min\s+speed=(\d+)K\/sec$/;
const QUEUED_PROGRESS = /^(\w+)\s*=\s*(DELAYED|PENDING)$/;
const BITMAP = /^bitmap:\s*(\d+)\/(\d+)\s+pages\s*\[(\d+)KB\],\s*(\d+)KB\s+chunk/;
const UNUSED = /^unused devices\s*:\s*(.*)$/;

/** Words on the header line that are the array's state rather than its level. */
const STATE_WORDS: ReadonlySet<string> = new Set(['active', 'inactive']);

/**
 * Splits a header line's tokens into state, level and members. The words are
 * told apart by what they are rather than by where they sit: `inactive` with
 * no level at all reads the same way as `active (auto-read-only) raid1`.
 */
function parseMembers(tokens: string[]): { level: string | null; members: MdMember[]; state: string[] } {
  const state: string[] = [];
  const members: MdMember[] = [];
  let level: string | null = null;

  for (const token of tokens) {
    const member = MEMBER.exec(token);
    if (member !== null) {
      members.push({
        device: member[1] ?? '',
        role: Number(member[2]),
        flags: (member[3] ?? '').split(/[()]+/).filter((flag) => flag !== ''),
      });
      continue;
    }

    if (STATE_WORDS.has(token) || token.startsWith('(')) {
      state.push(token);
      continue;
    }

    // The one word that is neither a state nor a member is the level, and an
    // array that is not running may not have one.
    if (level === null && members.length === 0) level = token;
  }

  return { level, members, state };
}

export function parseMdstat(text: string): MdstatInfo {
  const info: MdstatInfo = { personalities: [], arrays: [], unused: [] };
  let current: MdArray | null = null;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const personalities = PERSONALITIES.exec(line);
    if (personalities !== null) {
      info.personalities = Array.from(
        (personalities[1] ?? '').matchAll(/\[([^\]]+)\]/g),
        (match) => match[1] ?? '',
      );
      current = null;
      continue;
    }

    const unused = UNUSED.exec(line);
    if (unused !== null) {
      const devices = (unused[1] ?? '').trim();
      info.unused = devices === '' || devices === '<none>' ? [] : devices.split(/\s+/);
      current = null;
      continue;
    }

    // An indented line continues the array above it.
    if (/^\s/.test(line) && current !== null) {
      const trimmed = line.trim();

      const blocks = BLOCKS.exec(trimmed);
      if (blocks !== null) {
        const rest = blocks[2] ?? '';
        const counts = COUNTS.exec(rest);
        const status = STATUS.exec(rest);
        const metadata = METADATA.exec(rest);

        current.blocks = Number(blocks[1]);
        current.metadata = metadata === null ? null : (metadata[1] ?? null);
        current.expected = counts === null ? null : Number(counts[1]);
        current.working = counts === null ? null : Number(counts[2]);
        current.status = status === null ? null : (status[1] ?? null);
        current.geometry =
          rest
            .replace(METADATA, '')
            .replace(COUNTS, '')
            .replace(STATUS, '')
            .replace(/\s+/g, ' ')
            .trim() || null;
        continue;
      }

      const progress = PROGRESS.exec(trimmed);
      if (progress !== null) {
        current.progress = {
          action: progress[1] ?? '',
          percent: Number(progress[2]),
          done: Number(progress[3]),
          total: Number(progress[4]),
          finishMinutes: Number(progress[5]),
          speedKBs: Number(progress[6]),
          queued: null,
        };
        continue;
      }

      // Queued rather than running: no bar, no percentage, no estimate.
      const queued = QUEUED_PROGRESS.exec(trimmed);
      if (queued !== null) {
        current.progress = {
          action: queued[1] ?? '',
          percent: null,
          done: null,
          total: null,
          finishMinutes: null,
          speedKBs: null,
          queued: queued[2] ?? null,
        };
        continue;
      }

      const bitmap = BITMAP.exec(trimmed);
      if (bitmap !== null) {
        current.bitmap = {
          pagesUsed: Number(bitmap[1]),
          pagesTotal: Number(bitmap[2]),
          sizeKB: Number(bitmap[3]),
          chunkKB: Number(bitmap[4]),
        };
      }
      continue;
    }

    const array = ARRAY.exec(line);
    if (array === null) continue;

    const { level, members, state } = parseMembers((array[2] ?? '').trim().split(/\s+/));
    current = {
      name: array[1] ?? '',
      state,
      level,
      members,
      blocks: null,
      metadata: null,
      expected: null,
      working: null,
      status: null,
      progress: null,
      bitmap: null,
      geometry: null,
    };
    info.arrays.push(current);
  }

  return info;
}

/** What a member's flag letter means, or null for one this table has no name for. */
export function describeFlag(flag: string): string | null {
  return MEMBER_FLAGS[flag] ?? null;
}

/** What the kernel is doing, or null for a word this table has no name for. */
export function describeAction(action: string): string | null {
  return ACTIONS[action] ?? null;
}

/** Members the array counts as failed, which stay listed until removed. */
export function failedMembers(array: MdArray): MdMember[] {
  return array.members.filter((member) => member.flags.includes('F'));
}

/** Members standing by rather than carrying data. */
export function spareMembers(array: MdArray): MdMember[] {
  return array.members.filter((member) => member.flags.includes('S'));
}

/** Positions with no working member behind them. */
export function missingMembers(array: MdArray): number | null {
  if (array.expected === null || array.working === null) return null;
  return Math.max(0, array.expected - array.working);
}

/**
 * Whether the array is short of members: a hole in the status field, or fewer
 * working than expected. Null when the file said neither, which is the case
 * for an array that is not running.
 */
export function isDegraded(array: MdArray): boolean | null {
  if (array.status === null && array.expected === null) return null;
  if (array.status !== null && array.status.includes('_')) return true;
  return missingMembers(array) !== null && missingMembers(array)! > 0;
}

/** Whether the array is assembled and running. */
export function isActive(array: MdArray): boolean {
  return array.state.includes('active');
}

/** Whether the kernel is working on the array right now. */
export function isRebuilding(array: MdArray): boolean {
  return array.progress !== null && array.progress.queued === null;
}

/** Bytes the array holds, from the 1 KiB blocks the kernel counts in. */
export function bytesOf(array: MdArray): number | null {
  return array.blocks === null ? null : array.blocks * 1024;
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** Binary units, the way an array's size is quoted. */
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

/** The kernel's estimate, written the way it reads. */
export function formatFinish(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} sec`;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)} min`;
  return `${(minutes / 60).toFixed(1)} hours`;
}

export interface MdstatSummary {
  arrays: number;
  active: number;
  /** Arrays short of a member, which is what to look at first. */
  degraded: MdArray[];
  /** Arrays the kernel is working on right now. */
  rebuilding: MdArray[];
  /** Arrays with work queued behind another array's. */
  queued: MdArray[];
  totalBytes: number;
  personalities: string[];
}

export function summarize(info: MdstatInfo): MdstatSummary {
  return {
    arrays: info.arrays.length,
    active: info.arrays.filter((array) => isActive(array)).length,
    degraded: info.arrays.filter((array) => isDegraded(array) === true),
    rebuilding: info.arrays.filter((array) => isRebuilding(array)),
    queued: info.arrays.filter((array) => array.progress?.queued != null),
    totalBytes: info.arrays.reduce((total, array) => total + (bytesOf(array) ?? 0), 0),
    personalities: info.personalities,
  };
}
