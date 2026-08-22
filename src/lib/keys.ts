/**
 * Parser for `/proc/keys`.
 *
 * The keys in the kernel's keyring that the reader is allowed to see, one per
 * line, written as `%08x %c%c%c%c%c%c%c %5d %4s %08x %5d %5d %-9.9s ` followed
 * by whatever the key's type has to say about it:
 *
 *    0083c4a2 I--Q---     3 perm 3f030000  1000  1000 keyring   _ses: 2
 *    30ab8c66 I--Q---     1 expd 3f3f0000  1000  1000 user      wifi_psk: 32
 *
 * Reading left to right: the serial, seven flag positions, the reference
 * count, when it expires, the permission mask, the owning uid and gid, the key
 * type, and the description.
 *
 * Two fields carry most of the meaning and neither is readable as printed.
 *
 * The **flags** are positional, not a set: each of the seven characters is
 * either its own letter or `-`, and the position is what says which flag it
 * is. See {@link FLAGS} and {@link flagsOf}.
 *
 * The **permission mask** is four bytes, one each for the possessor, the
 * owning user, the owning group and everyone else, and each byte holds six
 * bits — view, read, write, search, link and setattr. `3f030000` is therefore
 * everything for a possessor, view and read for the owner, and nothing at all
 * for anyone else. See {@link permissionsOf}.
 *
 * Two smaller things. The type is printed through `%-9.9s`, so a name longer
 * than nine characters **is cut short** — `asymmetric` arrives as `asymmetri`
 * — and {@link maybeTruncated} is the most that can be said about one. And a
 * key absent from this file is not a key that does not exist: the file lists
 * what the reader has View permission on, so an empty one means none are
 * visible rather than none are held.
 */

/**
 * The seven flag positions, in the order the kernel writes them. A position
 * holds its letter when the flag is set and `-` when it is not.
 */
export const FLAGS: readonly { letter: string; name: string; description: string }[] = [
  {
    letter: 'I',
    name: 'instantiated',
    description: 'Has a payload — a key is uninstantiated until something fills it in',
  },
  { letter: 'R', name: 'revoked', description: 'Revoked, so it can no longer be used' },
  { letter: 'D', name: 'dead', description: 'Its type was unregistered, leaving it unusable' },
  {
    letter: 'Q',
    name: 'quota',
    description: "Counts against the owning user's quota of keys",
  },
  {
    letter: 'U',
    name: 'under construction',
    description: 'Being constructed by a callout to userspace right now',
  },
  {
    letter: 'N',
    name: 'negative',
    description: 'A lookup that failed, cached so the failure need not be repeated',
  },
  { letter: 'i', name: 'invalidated', description: 'Invalidated, and waiting to be collected' },
];

/** The six rights in each byte of the permission mask, low bit first. */
export const RIGHTS: readonly { bit: number; letter: string; name: string }[] = [
  { bit: 0x01, letter: 'v', name: 'view' },
  { bit: 0x02, letter: 'r', name: 'read' },
  { bit: 0x04, letter: 'w', name: 'write' },
  { bit: 0x08, letter: 's', name: 'search' },
  { bit: 0x10, letter: 'l', name: 'link' },
  { bit: 0x20, letter: 'a', name: 'setattr' },
];

/** Who each byte of the mask grants rights to, highest byte first. */
export const SUBJECTS = ['possessor', 'user', 'group', 'other'] as const;

export type Subject = (typeof SUBJECTS)[number];

/** How wide the type field is before the kernel cuts it short. */
export const TYPE_WIDTH = 9;

export interface Key {
  /** Serial as printed, in hex — the leading zeros are part of it. */
  serial: string;
  /** The seven flag characters, positions included. */
  flags: string;
  /** References held on the key. */
  usage: number;
  /** `perm`, `expd`, or a time such as `9h` — as printed. */
  timeout: string;
  /** The permission mask, as a number: it is four bytes, so it fits. */
  permissions: number;
  uid: number;
  gid: number;
  /** Key type, cut to nine characters by the kernel. */
  type: string;
  /** Whatever the type printed: usually `<description>: <detail>`. */
  description: string;
}

export interface KeysInfo {
  keys: Key[];
}

const LINE =
  /^([0-9a-f]+)\s+([A-Za-z-]{7})\s+(\d+)\s+(\S+)\s+([0-9a-f]+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/;

export function parseKeys(text: string): KeysInfo {
  const keys: Key[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = LINE.exec(line);
    if (match === null) continue;

    keys.push({
      serial: (match[1] ?? '').toLowerCase(),
      flags: match[2] ?? '',
      usage: Number(match[3]),
      timeout: match[4] ?? '',
      permissions: Number.parseInt(match[5] ?? '', 16),
      uid: Number(match[6]),
      gid: Number(match[7]),
      type: match[8] ?? '',
      description: (match[9] ?? '').trim(),
    });
  }

  return { keys };
}

/**
 * The flags this key has set. A position holding anything other than `-` is
 * the flag for that position, whatever character is in it.
 */
export function flagsOf(key: Key): typeof FLAGS {
  return FLAGS.filter((_, index) => key.flags[index] !== undefined && key.flags[index] !== '-');
}

/** Whether one named flag is set, by its position rather than by searching. */
export function hasFlag(key: Key, name: string): boolean {
  const index = FLAGS.findIndex((flag) => flag.name === name);
  return index !== -1 && key.flags[index] !== undefined && key.flags[index] !== '-';
}

/** The byte of the mask that applies to one subject. */
export function permissionByte(key: Key, subject: Subject): number {
  const shift = (SUBJECTS.length - 1 - SUBJECTS.indexOf(subject)) * 8;
  return (key.permissions >>> shift) & 0xff;
}

/** The rights one subject is granted, in the order the bits run. */
export function permissionsOf(key: Key, subject: Subject): string[] {
  const byte = permissionByte(key, subject);
  return RIGHTS.filter((right) => (byte & right.bit) !== 0).map((right) => right.name);
}

/**
 * A byte of the mask the way `keyctl` writes it: two unused positions, then
 * setattr, link, search, write, read and view, highest bit first.
 */
export function formatPermissionByte(byte: number): string {
  const letters = [...RIGHTS]
    .reverse()
    .map((right) => ((byte & right.bit) !== 0 ? right.letter : '-'))
    .join('');

  return `--${letters}`;
}

/** Whether the key has expired but is still listed, waiting to be collected. */
export function isExpired(key: Key): boolean {
  return key.timeout === 'expd';
}

/** Whether the key never expires. */
export function isPermanent(key: Key): boolean {
  return key.timeout === 'perm';
}

/**
 * Whether the type name may have been cut short. Nine characters is the width
 * the kernel prints it in, so a name of exactly nine may be whole or may not,
 * and there is no telling which from here.
 */
export function maybeTruncated(key: Key): boolean {
  return key.type.length === TYPE_WIDTH;
}

export interface Described {
  /** The part before the type's trailing detail. */
  name: string;
  /** What the type added — a key count, a payload length — or null. */
  detail: string | null;
}

/**
 * Splits what the type printed into the key's description and the detail the
 * type appended. Most types write `<description>: <detail>`, so the split is
 * on the **last** `: ` — a description containing one of its own keeps it.
 * With no separator at all, the whole thing is the description.
 */
export function describe(key: Key): Described {
  const at = key.description.lastIndexOf(': ');
  if (at === -1) return { name: key.description, detail: null };

  return { name: key.description.slice(0, at), detail: key.description.slice(at + 2) };
}

export interface TypeCount {
  type: string;
  count: number;
}

/** How many keys of each type, commonest first. */
export function countTypes(info: KeysInfo): TypeCount[] {
  const counts = new Map<string, number>();
  for (const key of info.keys) counts.set(key.type, (counts.get(key.type) ?? 0) + 1);

  return Array.from(counts, ([type, count]) => ({ type, count })).sort(
    (a, b) => b.count - a.count || a.type.localeCompare(b.type),
  );
}

export interface KeysSummary {
  total: number;
  keyrings: number;
  types: TypeCount[];
  /** Keys in a state that means they can no longer be used. */
  unusable: Key[];
  expired: Key[];
  /** Keys with an expiry that has not passed yet. */
  expiring: Key[];
}

export function summarize(info: KeysInfo): KeysSummary {
  return {
    total: info.keys.length,
    keyrings: info.keys.filter((key) => key.type === 'keyring').length,
    types: countTypes(info),
    unusable: info.keys.filter(
      (key) =>
        isExpired(key) ||
        hasFlag(key, 'revoked') ||
        hasFlag(key, 'dead') ||
        hasFlag(key, 'invalidated'),
    ),
    expired: info.keys.filter((key) => isExpired(key)),
    expiring: info.keys.filter((key) => !isPermanent(key) && !isExpired(key)),
  };
}
