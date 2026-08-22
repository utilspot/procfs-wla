/**
 * Parser for `/proc/<pid>/gid_map` — how group ids inside this process's user
 * namespace line up with the ids outside it.
 *
 * **The file is `/proc/<pid>/uid_map`'s file.** Same three `%10u` columns
 * reading *first id inside*, *first id outside*, *how many*; same write-once
 * rule, same 340 ranges, same overlap check, same middle column written from
 * the point of view of whoever opened it. That is one fact rather than two that
 * have to agree, so the parsing and the geometry are `src/lib/uid_map.ts`'s and
 * what is written down here is only what differs.
 *
 * What differs is not the contents but **the rule guarding the write**, and it
 * is the whole reason this page is not the other one:
 *
 *  - **An unprivileged process must write `deny` to `/proc/<pid>/setgroups`
 *    before the kernel will let it write this file at all.** Without that the
 *    write fails with `EPERM`. There is no such rule on `uid_map`.
 *  - **That is a security fix, not a formality.** Before Linux 3.19 a user
 *    could make a user namespace, write a `gid_map`, and then *drop* a
 *    supplementary group with `setgroups()` — which defeats a **negative**
 *    group permission, a file whose group bits grant less than its other bits,
 *    where being in the group is what denies you. CVE-2014-8989. Writing
 *    `deny` turns `setgroups()` off for that namespace and every namespace
 *    nested inside it, permanently.
 *  - **A writer holding `CAP_SETGID` in the parent namespace is exempt**, and
 *    `setgroups` stays `allow`. That is how `newgidmap` — setuid root, reading
 *    `/etc/subgid` — writes a rootless container's several ranges without
 *    freezing its groups, where `unshare -U` on its own cannot.
 *  - **The order is fixed and one-way.** `setgroups` has to be written first,
 *    because writing `gid_map` is what makes `setgroups` unwritable: after
 *    that there is no putting `allow` back.
 *
 * So the *shape* of this file is evidence about a file this page cannot read.
 * See {@link setgroupsEvidence}.
 *
 * Two more things this file is not. **The groups a process is actually in are
 * not here** — `/proc/<pid>/status` has them, on its `Groups:` line — this is
 * only what the ids in them mean on each side of the boundary. And an unmapped
 * group reads as {@link OVERFLOW_GID}, which is its own sysctl rather than the
 * uid one, though both land on 65534.
 */
import {
  isIdentity,
  isSelfMap,
  isUnmapped,
  lastInside,
  lastOutside,
  parseUidMap,
  type Extent,
  type UidMap,
} from './uid_map';

export type { Extent } from './uid_map';

/** The file's shape, which is `uid_map`'s — see the note above. */
export type GidMap = UidMap;

/**
 * Reads the file. This is {@link parseUidMap}: three unsigned numbers a line,
 * anything else kept aside, and the two files are the same three columns.
 */
export const parseGidMap: (text: string) => GidMap = parseUidMap;

/**
 * What an unmapped group reads as: `/proc/sys/kernel/overflowgid`, which is
 * **its own sysctl** rather than the uid one, and defaults to the same 65534.
 * `nogroup` on Debian and Ubuntu, `nobody` on much else.
 */
export const OVERFLOW_GID = 65534;

/**
 * `(gid_t)-1`, which is not a group but the kernel's "no id here" value —
 * `setgid(-1)` asks for nothing to change — so the identity map stops one short
 * of it.
 */
export const INVALID_GID = 4294967295;

/**
 * Where `/etc/subgid` allocations conventionally start. Nothing in the kernel
 * knows this number; `useradd` and `newgidmap` simply begin there.
 */
export const SUBGID_BASE = 100000;

/** What `/proc/<pid>/setgroups` holds once an unprivileged writer has been through. */
export const SETGROUPS_DENY = 'deny';

/** And what it holds otherwise, which is what the kernel starts it at. */
export const SETGROUPS_ALLOW = 'allow';

/** Linux release that added the `setgroups` gate, and the CVE it closed. */
export const SETGROUPS_SINCE = '3.19';
export const SETGROUPS_CVE = 'CVE-2014-8989';

/**
 * What this map's shape says about `/proc/<pid>/setgroups`, a file this page
 * cannot read: a page reads the one path its URL names, and that is another.
 *
 * The reasoning runs off what the kernel will accept from whom. An
 * **unprivileged** writer may write exactly one range of exactly one id — its
 * own — and only after `deny` has gone into `setgroups`. So anything wider than
 * that took `CAP_SETGID` in the parent namespace, which needs no `deny` at all.
 *
 * Only one direction of that is certain. A map wider than one id **rules out**
 * the unprivileged path, but a privileged writer may write `deny` anyway, so
 * `allow` is the likely answer rather than the settled one. A one-id map is the
 * unprivileged path's *only* shape but not its exclusive one — root can write
 * the same line — so `deny` is likelier still and no more certain than that.
 * The identity map is the exception that is settled: it is the initial user
 * namespace's, its `gid_map` is long written, and a written `gid_map` is what
 * makes `setgroups` unwritable, so `allow` is where it is stuck.
 */
export interface SetgroupsEvidence {
  /** What `setgroups` most likely holds, or null where the shape cannot say. */
  value: typeof SETGROUPS_DENY | typeof SETGROUPS_ALLOW | null;
  /** Whether the shape settles it rather than merely pointing at it. */
  certain: boolean;
  /** Why, for the page to repeat. */
  reason: string;
}

export function setgroupsEvidence(map: GidMap): SetgroupsEvidence {
  if (isUnmapped(map)) {
    return {
      value: null,
      certain: false,
      reason:
        'nothing has been written here yet, and until it is, setgroups can still be written either way',
    };
  }

  if (isIdentity(map)) {
    return {
      value: SETGROUPS_ALLOW,
      certain: true,
      reason:
        'this is the initial user namespace, whose map was written long ago — and a written gid_map is what makes setgroups unwritable, so allow is where it is stuck',
    };
  }

  if (isSelfMap(map)) {
    return {
      value: SETGROUPS_DENY,
      certain: false,
      reason:
        'one range of one id is all the kernel accepts from a writer without CAP_SETGID, and such a writer gets here only by denying setgroups first',
    };
  }

  return {
    value: SETGROUPS_ALLOW,
    certain: false,
    reason:
      'a map this wide is more than an unprivileged writer may ask for, so whoever wrote it held CAP_SETGID in the parent namespace and needed no deny',
  };
}

/**
 * Whether `setgroups()` and `initgroups()` are very likely dead in this
 * namespace — which is the practical half of {@link setgroupsEvidence}: a
 * process in there cannot drop a supplementary group, or pick one up.
 */
export function groupsFrozen(map: GidMap): boolean {
  return setgroupsEvidence(map).value === SETGROUPS_DENY;
}

/**
 * What a well-known group id is for, so a number in the table is not just a
 * number. The device groups are Debian and Ubuntu's numbers; nothing in the
 * kernel fixes them, and another distribution puts them elsewhere.
 */
export function describeGroupId(id: number): string | null {
  if (id === 0) return 'root — the group, not the user';
  if (id === OVERFLOW_GID) return 'nogroup — the overflow gid an unmapped group reads as';
  if (id === INVALID_GID) return '(gid_t)-1, which is not a group at all';
  if (id === 1) return 'daemon, on most distributions';
  if (id === 5) return 'tty, which owns the terminal devices — on Debian and Ubuntu';
  if (id === 6) return 'disk, which owns the raw block devices — on Debian and Ubuntu';
  if (id === 20) return 'dialout, which owns the serial ports — on Debian and Ubuntu';
  if (id === 29) return 'audio, which owns the sound devices — on Debian and Ubuntu';
  if (id === 44) return 'video, which owns the framebuffer and the GPU nodes — on Debian and Ubuntu';
  if (id === 100) return 'users, the shared group on a distribution that does not give each user one';
  if (id >= SUBGID_BASE) return 'a delegated subgid, by convention rather than by any kernel rule';
  if (id >= 1000) return 'a user’s own group, on a distribution that makes one per account';
  return 'a system group';
}

/** Whether this range maps a group to itself — a host group shared into the namespace. */
export function isPassthroughGroup(extent: Extent): boolean {
  return extent.inside === extent.outside;
}

/**
 * Whether the ids outside look like an `/etc/subgid` delegation rather than
 * real groups. A guess from the numbers — see {@link SUBGID_BASE}.
 */
export function isDelegatedGroup(extent: Extent): boolean {
  return extent.outside >= SUBGID_BASE && !isPassthroughGroup(extent);
}

/**
 * What one range does, in a sentence.
 *
 * A passthrough range reads differently here than it does for users: a group
 * held the same on both sides is usually a **device** group deliberately shared
 * in, so that the nodes it owns stay usable from inside the namespace. That is
 * the ordinary reason to punch a hole in a `gid_map`.
 */
export function describeGroupExtent(extent: Extent): string {
  if (isPassthroughGroup(extent)) {
    const named = describeGroupId(extent.inside);
    const what = named === null ? '' : ` — ${named}`;

    return extent.length === 1
      ? `Group ${extent.inside} is itself on both sides${what}, so what it owns is owned by the same group from either side`
      : `Groups ${extent.inside}–${lastInside(extent)} are themselves on both sides, so nothing about them changes across the boundary`;
  }

  const single = extent.length === 1;
  const inside = single ? `Group ${extent.inside}` : `Groups ${extent.inside}–${lastInside(extent)}`;
  const outside = single ? `group ${extent.outside}` : `groups ${extent.outside}–${lastOutside(extent)}`;

  const tail = isDelegatedGroup(extent)
    ? ' — a range delegated through /etc/subgid rather than real groups'
    : '';

  return `${inside} inside ${single ? 'is' : 'are'} ${outside} outside${tail}`;
}
