/**
 * Parser for `/proc/<pid>/uid_map` — how user ids inside this process's user
 * namespace line up with the ids outside it.
 *
 * A line per range, three `%10u` fields:
 *
 *            0       1000          1
 *            1     100000      65536
 *
 * which reads *first id inside*, *first id outside*, *how many*. So the
 * container above has uid 0, and uid 0 there is uid 1000 here: root inside is
 * an ordinary user outside, and the 65535 ids after it come out of the
 * `/etc/subuid` range that user was given.
 *
 * Four things about this file are easy to get wrong:
 *
 * - **The middle column is not absolute.** It is written in terms of whichever
 *   namespace the process *reading the file* is in: the parent namespace where
 *   the reader shares the namespace being described, and the reader's own where
 *   it does not. Two processes reading the same `uid_map` can legitimately see
 *   different numbers, so a captured file only means something alongside who
 *   read it. See {@link OUTSIDE_DEPENDS_ON_READER}.
 * - **An empty file is not a missing namespace.** A user namespace starts with
 *   no map at all, and until one is written every id in it — every file owner,
 *   every process — reads as the overflow uid, 65534. That is where an
 *   unexplained `nobody` comes from. See {@link OVERFLOW_UID}.
 * - **It is write-once.** A map may be written exactly once, in a single
 *   `write()`, and after that the namespace's ids are settled for as long as it
 *   exists. There is no editing it later, which is why a container runtime gets
 *   this wrong at start-up or not at all.
 * - **A range says nothing about privilege.** Being uid 0 inside a namespace is
 *   full capability *over that namespace's own resources* and nothing more; the
 *   kernel checks the id outside for everything else. {@link rootOutside} is
 *   the number that actually decides what a process can touch.
 *
 * `/proc/<pid>/gid_map` is the same file for groups, with one extra rule
 * around it: since Linux 3.19 an unprivileged process must write `deny` to
 * `/proc/<pid>/setgroups` before it may write `gid_map` at all. That page reads
 * this file through `src/lib/gid_map.ts`, which takes the parsing and the
 * geometry from here — the three columns are one fact rather than two that have
 * to agree — and writes down only what a group makes different.
 */

/**
 * What an id with no mapping reads as: `/proc/sys/kernel/overflowuid`, which is
 * 65534 — `nobody` on most systems. Every id in a namespace reads as this until
 * a map is written, and any id outside the ranges keeps reading as it after.
 */
export const OVERFLOW_UID = 65534;

/**
 * `(uid_t)-1`, which is not a user id but the kernel's "no id here" value.
 * `setuid(-1)` is how a caller asks for nothing to change, so the identity map
 * stops one short of it: `0 0 4294967295` covers 0 through 4294967294.
 */
export const INVALID_UID = 4294967295;

/** Ranges the kernel accepts, since Linux 4.15 — a page of extents, less one. */
export const EXTENTS_MAX = 340;

/**
 * Ranges a kernel before 4.15 accepted. A map longer than this is a map that
 * was written on a newer kernel, which is occasionally worth knowing when a
 * container runs somewhere older than it was built for.
 */
export const EXTENTS_MAX_LEGACY = 5;

/**
 * Where the `/etc/subuid` ranges a rootless runtime hands out conventionally
 * start. Nothing in the kernel knows this number; `useradd` and `newuidmap`
 * simply begin there, so an outside id at or above it is a strong hint that
 * this map was written by `newuidmap` out of a delegated range.
 */
export const SUBUID_BASE = 100000;

/**
 * The second column is written from the point of view of whoever opened the
 * file, so this page can only say what the numbers mean relative to the reader
 * — which here is the backend serving the file.
 */
export const OUTSIDE_DEPENDS_ON_READER =
  'in the namespace of whichever process opened the file — the parent of this one where the reader shares its namespace, and the reader’s own where it does not';

/** One line of the file: a run of ids inside lined up with a run outside. */
export interface Extent {
  /** First id inside the namespace. */
  inside: number;
  /** First id outside it, read as {@link OUTSIDE_DEPENDS_ON_READER} says. */
  outside: number;
  /** How many consecutive ids the range covers. */
  length: number;
  /** 1-based line it was on, since the kernel prints them in written order. */
  line: number;
  raw: string;
}

export interface UidMap {
  extents: Extent[];
  /** Lines that were not three numbers, kept so the page can say so. */
  malformed: string[];
}

export function parseUidMap(text: string): UidMap {
  const map: UidMap = { extents: [], malformed: [] };

  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;

    const fields = trimmed.split(/\s+/);
    // Every line is exactly three unsigned numbers. Anything else is not this
    // file, so keep it aside rather than reading a partial range out of it.
    if (fields.length !== 3 || !fields.every((field) => /^\d+$/.test(field))) {
      map.malformed.push(trimmed);
      continue;
    }

    const [inside, outside, length] = fields.map(Number) as [number, number, number];
    map.extents.push({ inside, outside, length, line: map.extents.length + 1, raw: trimmed });
  }

  return map;
}

/** Last id inside the namespace this range covers, inclusive. */
export function lastInside(extent: Extent): number {
  return extent.inside + extent.length - 1;
}

/** Last id outside the namespace this range covers, inclusive. */
export function lastOutside(extent: Extent): number {
  return extent.outside + extent.length - 1;
}

/** Whether this range covers an id inside the namespace. */
export function coversInside(extent: Extent, id: number): boolean {
  return id >= extent.inside && id <= lastInside(extent);
}

/** Whether this range covers an id outside the namespace. */
export function coversOutside(extent: Extent, id: number): boolean {
  return id >= extent.outside && id <= lastOutside(extent);
}

/**
 * What an id inside the namespace is outside it, or null where nothing maps it
 * — in which case the id reads as {@link OVERFLOW_UID} instead.
 */
export function toOutside(map: UidMap, id: number): number | null {
  const extent = map.extents.find((candidate) => coversInside(candidate, id));
  return extent === undefined ? null : extent.outside + (id - extent.inside);
}

/** What an id outside the namespace is inside it, or null where it is not. */
export function toInside(map: UidMap, id: number): number | null {
  const extent = map.extents.find((candidate) => coversOutside(candidate, id));
  return extent === undefined ? null : extent.inside + (id - extent.outside);
}

/** Whether no map has been written yet, so every id in here is the overflow uid. */
export function isUnmapped(map: UidMap): boolean {
  return map.extents.length === 0;
}

/**
 * Whether this is the map every process in the initial user namespace has:
 * every id standing for itself. A namespace can be given one too, but only by
 * something already holding privilege over the whole range.
 */
export function isIdentity(map: UidMap): boolean {
  const [only] = map.extents;
  return (
    map.extents.length === 1 &&
    only!.inside === 0 &&
    only!.outside === 0 &&
    only!.length === INVALID_UID
  );
}

/** What uid 0 inside the namespace is outside it, or null where it is unmapped. */
export function rootOutside(map: UidMap): number | null {
  return toOutside(map, 0);
}

/**
 * Whether root inside this namespace is somebody else outside — the shape a
 * rootless container has, and the one thing about this file that decides
 * whether "root in the container" means anything on the machine.
 */
export function isRootRemapped(map: UidMap): boolean {
  const outside = rootOutside(map);
  return outside !== null && outside !== 0;
}

/**
 * Whether this is the single mapping an unprivileged process may write for
 * itself: one range, one id. Without `CAP_SETUID` in the parent namespace that
 * is all the kernel will accept — the caller's own effective id and nothing
 * else — which is why `unshare -U` on its own gives a namespace with exactly
 * one usable user in it.
 */
export function isSelfMap(map: UidMap): boolean {
  return map.extents.length === 1 && map.extents[0]!.length === 1;
}

/**
 * Whether this range maps an id to itself, which inside a larger map is a hole
 * punched deliberately: a host user shared into the namespace so the files it
 * owns keep the same owner on both sides.
 */
export function isPassthrough(extent: Extent): boolean {
  return extent.inside === extent.outside;
}

/**
 * Whether the ids outside come from a delegated `/etc/subuid` range rather than
 * from real accounts. A guess from the numbers — see {@link SUBUID_BASE}.
 */
export function isDelegated(extent: Extent): boolean {
  return extent.outside >= SUBUID_BASE && !isPassthrough(extent);
}

/** Ids this map accounts for, across every range. */
export function totalMapped(map: UidMap): number {
  return map.extents.reduce((total, extent) => total + extent.length, 0);
}

/** A pair of ranges that cover the same id, on one side or the other. */
export interface Overlap {
  first: Extent;
  second: Extent;
  /** Which column they collide in. */
  side: 'inside' | 'outside';
}

/**
 * Ranges that tread on each other. The kernel rejects an overlapping map at
 * write time, so a file holding one did not come from a running namespace —
 * worth saying plainly rather than translating an id twice and picking one.
 */
export function overlaps(map: UidMap): Overlap[] {
  const found: Overlap[] = [];

  for (let i = 0; i < map.extents.length; i += 1) {
    for (let j = i + 1; j < map.extents.length; j += 1) {
      const first = map.extents[i]!;
      const second = map.extents[j]!;

      if (first.inside <= lastInside(second) && second.inside <= lastInside(first)) {
        found.push({ first, second, side: 'inside' });
      }
      if (first.outside <= lastOutside(second) && second.outside <= lastOutside(first)) {
        found.push({ first, second, side: 'outside' });
      }
    }
  }

  return found;
}

/** Whether a range covers `(uid_t)-1`, which is not an id and cannot be mapped. */
export function coversInvalidId(extent: Extent): boolean {
  return lastInside(extent) >= INVALID_UID || lastOutside(extent) >= INVALID_UID;
}

/** What a well-known id is for, so a number in the table is not just a number. */
export function describeId(id: number): string | null {
  if (id === 0) return 'root';
  if (id === OVERFLOW_UID) return 'nobody — the overflow uid an unmapped id reads as';
  if (id === INVALID_UID) return '(uid_t)-1, which is not an id at all';
  if (id === 1) return 'daemon, on most distributions';
  if (id >= SUBUID_BASE) return 'a delegated subuid, by convention rather than by any kernel rule';
  if (id >= 1000) return 'an ordinary user account';
  return 'a system account';
}

/** What one range of the map does, in a sentence. */
export function describeExtent(extent: Extent): string {
  if (isPassthrough(extent)) {
    return extent.length === 1
      ? `Id ${extent.inside} is itself on both sides, so a file it owns has one owner whichever side you read it from`
      : `Ids ${extent.inside}–${lastInside(extent)} are themselves on both sides, so nothing about them changes across the boundary`;
  }

  const single = extent.length === 1;
  const inside = single ? `Id ${extent.inside}` : `Ids ${extent.inside}–${lastInside(extent)}`;
  const outside = single ? `id ${extent.outside}` : `ids ${extent.outside}–${lastOutside(extent)}`;

  const tail = isDelegated(extent)
    ? ' — a range delegated through /etc/subuid rather than real accounts'
    : '';

  return `${inside} inside ${single ? 'is' : 'are'} ${outside} outside${tail}`;
}

export interface UidMapSummary {
  extents: number;
  /** No map written, so every id in the namespace is the overflow uid. */
  unmapped: boolean;
  /** The initial namespace's map: every id standing for itself. */
  identity: boolean;
  /** One range of one id — all an unprivileged writer may ask for. */
  selfMap: boolean;
  /** What uid 0 in here is out there, or null where root itself is unmapped. */
  root: number | null;
  /** Root in here is somebody else out there. */
  rootRemapped: boolean;
  /** Ids the map accounts for. */
  mapped: number;
  /** Ranges mapping ids to themselves, which are holes punched on purpose. */
  passthrough: Extent[];
  /** Ranges that look like a delegated /etc/subuid allocation. */
  delegated: Extent[];
  /** More ranges than a kernel before 4.15 would have taken. */
  pastLegacyCap: boolean;
  /** Ranges the kernel would have refused at write time. */
  overlaps: Overlap[];
  /** Lines that were not three numbers. */
  malformed: string[];
}

export function summarize(map: UidMap): UidMapSummary {
  const identity = isIdentity(map);

  return {
    extents: map.extents.length,
    unmapped: isUnmapped(map),
    identity,
    // The identity map is one range of many ids, so it is never this — but say
    // it explicitly, since "one line" is what both look like from a distance.
    selfMap: !identity && isSelfMap(map),
    root: rootOutside(map),
    rootRemapped: isRootRemapped(map),
    mapped: totalMapped(map),
    passthrough: map.extents.filter(isPassthrough),
    delegated: map.extents.filter(isDelegated),
    pastLegacyCap: map.extents.length > EXTENTS_MAX_LEGACY,
    overlaps: overlaps(map),
    malformed: map.malformed,
  };
}

/** `65,536`, since these numbers get long enough to be misread. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** A range as the pair of ids at its ends, or the single id where it is one. */
export function formatRange(first: number, length: number): string {
  return length === 1 ? formatCount(first) : `${formatCount(first)}–${formatCount(first + length - 1)}`;
}
