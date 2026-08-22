import { unescapePath } from './mounts';

/**
 * Parser for `/proc/<pid>/mountinfo` — every mount this process can see, where
 * each one sits in the tree, and how it propagates.
 *
 * A line per mount, and the only line in `/proc` whose fields cannot be counted
 * from the left:
 *
 *   36 35 98:0 /mnt1 /mnt2 rw,noatime master:1 - ext3 /dev/root rw,errors=continue
 *   ── ── ──── ───── ───── ────────── ──────── ─ ──── ───────── ────────────────
 *   1  2  3    4     5     6          7        8 9    10        11
 *
 * 1 mount id, 2 the id of the mount this one is mounted *on*, 3 the `st_dev`
 * every file under it reports, 4 which part of the filesystem is mounted,
 * 5 where, 6 the per-mount options, 7 **zero or more** optional tags, 8 a `-`
 * marking their end, 9 filesystem type, 10 mount source, 11 per-superblock
 * options. Field 7 is why the `-` is there: a reader has to find the separator
 * and count backwards from it, which is what {@link parseMountinfo} does.
 *
 * `/proc/mounts` describes the same mounts in the fstab shape, and loses most
 * of this in the telling. Four things live only here:
 *
 * - **The tree.** Fields 1 and 2 say what is mounted on what, so the mounts
 *   form a tree rather than a list — and a mount point's text does not: with
 *   `/var` and `/var/log` both mounted, only the ids say whether the second is
 *   on the first or on something that was there before it. See {@link depthOf}.
 * - **Bind mounts.** Field 4 is `/` for an ordinary mount and a subtree for a
 *   bind of one — `/home` bound onto `/srv/home` shows `/home` there. It is the
 *   one place a bind mount admits to being one. See {@link Mountinfo.bind}.
 * - **Propagation.** Field 7 carries `shared:N`, `master:N`, `propagate_from:N`
 *   and `unbindable`, which decide whether a mount made underneath this one
 *   shows up elsewhere. A container that mounts something and finds the host
 *   sees it, or does not, is reading these four tags. See {@link propagationOf}.
 * - **Read-only twice.** `ro` in field 6 is *this* mount being read-only; `ro`
 *   in field 11 is the filesystem underneath it being read-only, for every
 *   mount of it. A read-only bind of a writable filesystem shows the first and
 *   not the second, and remounting it rw is a different operation in each case.
 *
 * Paths are escaped as they are in `/proc/mounts` — `\040` for a space, and so
 * on — so fields 4, 5 and 10 are unescaped here, with `unescapePath` from that
 * parser rather than a second copy of the table.
 */

/** One of the optional tags in field 7, and the peer group it names. */
export interface OptionalField {
  tag: string;
  /** The number after the colon, or null for a tag that carries none. */
  value: number | null;
}

export interface Mountinfo {
  id: number;
  /** The mount this one is mounted on. The root of the tree names itself. */
  parent: number;
  major: number;
  minor: number;
  /** Which part of the filesystem is mounted — `/` unless this is a bind. */
  root: string;
  mountPoint: string;
  /** Per-mount options: this mount's own view of the filesystem. */
  options: string[];
  optional: OptionalField[];
  type: string;
  source: string;
  /** Per-superblock options: the filesystem's, shared by every mount of it. */
  superOptions: string[];
  /** This mount is read-only, whatever the filesystem underneath allows. */
  readOnly: boolean;
  /** The filesystem itself is read-only, so every mount of it is too. */
  superReadOnly: boolean;
  /** A subtree of a filesystem mounted somewhere else, rather than the whole. */
  bind: boolean;
  /** 1-based line in the file, which is the order the kernel listed them in. */
  line: number;
}

/** What the optional tags say about mounts made underneath this one. */
export type Propagation = 'shared' | 'slave' | 'shared and slave' | 'unbindable' | 'private';

/**
 * A filesystem with no block device behind it reports major 0 — the kernel
 * hands out an anonymous minor per superblock. `tmpfs`, `proc`, `cgroup2` and
 * every other thing the kernel makes up are major 0; `/dev/sda2` is not.
 */
export function hasDevice(mount: Mountinfo): boolean {
  return mount.major !== 0;
}

/**
 * The tags in field 7, which is everything between the options and the `-`.
 * A tag is `name` or `name:value`; anything else is kept as a tag with no
 * value rather than dropped, since this field is the one the kernel is free to
 * add to.
 */
function parseOptional(fields: readonly string[]): OptionalField[] {
  return fields.map((field) => {
    const colon = field.indexOf(':');
    if (colon === -1) return { tag: field, value: null };

    const value = Number(field.slice(colon + 1));
    return {
      tag: field.slice(0, colon),
      value: Number.isInteger(value) ? value : null,
    };
  });
}

/**
 * What this mount does to mounts made underneath it.
 *
 * - `shared:N` — it is in peer group N, and a mount under it appears under
 *   every other member.
 * - `master:N` — it receives from peer group N without sending back.
 * - both — it forwards on: a slave of one group and shared with another.
 * - `unbindable` — it cannot be bound or propagated at all.
 * - none of them — private, which is the default and the quiet case.
 *
 * `propagate_from:N` names where a slave's events come from when the sender is
 * not reachable from this namespace; it says nothing more about the kind, so it
 * is left in {@link Mountinfo.optional} for whoever wants it.
 */
export function propagationOf(mount: Mountinfo): Propagation {
  const has = (tag: string): boolean => mount.optional.some((field) => field.tag === tag);

  if (has('unbindable')) return 'unbindable';
  if (has('shared') && has('master')) return 'shared and slave';
  if (has('shared')) return 'shared';
  if (has('master')) return 'slave';
  return 'private';
}

/** The peer group of a tag, e.g. `shared:7` -> 7, for naming what it shares with. */
export function peerGroup(mount: Mountinfo, tag: string): number | null {
  return mount.optional.find((field) => field.tag === tag)?.value ?? null;
}

export function parseMountinfo(text: string): Mountinfo[] {
  const mounts: Mountinfo[] = [];

  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '') return;

    const fields = trimmed.split(/\s+/);
    // The separator is what makes the line readable at all: everything before
    // it is a known count plus the optional tags, everything after is fixed.
    const separator = fields.indexOf('-');
    if (separator === -1) return;

    const before = fields.slice(0, separator);
    const after = fields.slice(separator + 1);
    // Six fields lead, three follow. A line with fewer of either is not one of
    // these, however much of it parses.
    if (before.length < 6 || after.length < 2) return;

    const [id, parent, device, root, mountPoint, options] = before as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const [type, source, superOptions] = after as [string, string, string | undefined];

    const [major, minor] = device.split(':');
    if (major === undefined || minor === undefined) return;

    const optionList = options.split(',').filter((option) => option !== '');
    const superList = (superOptions ?? '').split(',').filter((option) => option !== '');
    const unescapedRoot = unescapePath(root);

    mounts.push({
      id: Number(id),
      parent: Number(parent),
      major: Number(major),
      minor: Number(minor),
      root: unescapedRoot,
      mountPoint: unescapePath(mountPoint),
      options: optionList,
      optional: parseOptional(before.slice(6)),
      type,
      source: unescapePath(source),
      superOptions: superList,
      readOnly: optionList.includes('ro'),
      superReadOnly: superList.includes('ro'),
      bind: unescapedRoot !== '/',
      line: index + 1,
    });
  });

  return mounts;
}

/**
 * How deep a mount sits in the tree, by following parent ids up to a mount that
 * is not in this file.
 *
 * The chain always ends: a namespace's root names itself as its parent, and a
 * mount whose parent is outside the namespace — which is what a chroot leaves
 * behind — has nothing above it here either. The walk is capped anyway, since
 * the ids come out of a file and a file can say anything.
 */
export function depthOf(mount: Mountinfo, byId: ReadonlyMap<number, Mountinfo>): number {
  let depth = 0;
  let current = mount;

  while (depth < byId.size) {
    const parent = byId.get(current.parent);
    if (parent === undefined || parent.id === current.id) break;

    depth += 1;
    current = parent;
  }

  return depth;
}

/** The mounts by id, for walking parents without searching the list each time. */
export function byId(mounts: readonly Mountinfo[]): Map<number, Mountinfo> {
  return new Map(mounts.map((mount) => [mount.id, mount]));
}

export interface MountinfoSummary {
  total: number;
  /** Mounts that are a subtree of a filesystem rather than the whole of one. */
  binds: number;
  /** Mounts that are read-only, by their own option rather than the filesystem's. */
  readOnly: number;
  /** How many are shared, slave, unbindable or private. */
  propagation: { kind: Propagation; count: number }[];
  /** Filesystem types with how many mounts use each, most used first. */
  types: { type: string; count: number }[];
  /** The mount at `/`, when this process can see one. */
  root: Mountinfo | undefined;
}

export function summarize(mounts: readonly Mountinfo[]): MountinfoSummary {
  const types = new Map<string, number>();
  const kinds = new Map<Propagation, number>();

  for (const mount of mounts) {
    types.set(mount.type, (types.get(mount.type) ?? 0) + 1);
    const kind = propagationOf(mount);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }

  return {
    total: mounts.length,
    binds: mounts.filter((mount) => mount.bind).length,
    readOnly: mounts.filter((mount) => mount.readOnly).length,
    propagation: [...kinds]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    types: [...types]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    root: mounts.find((mount) => mount.mountPoint === '/'),
  };
}
