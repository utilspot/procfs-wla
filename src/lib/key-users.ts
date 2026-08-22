/**
 * Parser for `/proc/key-users`.
 *
 * One line per uid that holds keys, written as `%5u: %5d %d/%d %d/%d %d/%d`:
 *
 *        0:     3 4/4 4/1000000 92/25000000
 *     1000:     2 9/9 9/200 384/20000
 *
 * That is the uid, the reference count on the kernel's record for it, and then
 * **three pairs which are not the same kind of thing**:
 *
 *  - `nkeys/nikeys` — keys held, and of those how many are **instantiated**.
 *    Both numbers describe the same set, so the second is never the larger;
 *    the gap is keys still being constructed or negatively instantiated. This
 *    is the one pair that is not a quota.
 *  - `qnkeys/maxkeys` — keys counted against the quota, and the limit.
 *  - `qnbytes/maxbytes` — payload bytes counted against the quota, and the
 *    limit.
 *
 * Only keys carrying the `Q` flag in `/proc/keys` count towards a quota, so
 * the quota count can be lower than the number of keys held.
 *
 * The limits are printed per line because **root has its own, far larger**:
 * a kernel's defaults are 200 keys and 20000 bytes for an ordinary user
 * against 1000000 and 25000000 for root. Nothing is assumed about them here —
 * both are read from the line, since either can be changed through
 * `/proc/sys/kernel/keys/`.
 */

/** The uid the kernel gives its own, larger quota to. */
export const ROOT_UID = 0;

/** Share of a quota at which the page starts saying so. */
export const NEAR_QUOTA = 0.8;

export interface KeyUser {
  uid: number;
  /** References held on the kernel's record for this user. */
  usage: number;
  /** Keys held. */
  keys: number;
  /** Of those, the ones with a payload. */
  instantiated: number;
  /** Keys counted against the quota — only those flagged `Q`. */
  quotaKeys: number;
  maxKeys: number;
  /** Payload bytes counted against the quota. */
  quotaBytes: number;
  maxBytes: number;
}

export interface KeyUsersInfo {
  users: KeyUser[];
}

/** `    0:     3 4/4 4/1000000 92/25000000` */
const LINE = /^\s*(\d+):\s*(\d+)\s+(\d+)\/(\d+)\s+(\d+)\/(\d+)\s+(\d+)\/(\d+)\s*$/;

export function parseKeyUsers(text: string): KeyUsersInfo {
  const users: KeyUser[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = LINE.exec(line);
    if (match === null) continue;

    const [, uid, usage, keys, instantiated, quotaKeys, maxKeys, quotaBytes, maxBytes] = match;

    users.push({
      uid: Number(uid),
      usage: Number(usage),
      keys: Number(keys),
      instantiated: Number(instantiated),
      quotaKeys: Number(quotaKeys),
      maxKeys: Number(maxKeys),
      quotaBytes: Number(quotaBytes),
      maxBytes: Number(maxBytes),
    });
  }

  return { users };
}

/**
 * Keys held without a payload yet: under construction, or a cached lookup
 * failure. Never negative, since the instantiated ones are a subset.
 */
export function uninstantiated(user: KeyUser): number {
  return Math.max(0, user.keys - user.instantiated);
}

/** The user root's quota is the kernel's larger one. */
export function isRoot(user: KeyUser): boolean {
  return user.uid === ROOT_UID;
}

/**
 * How much of a quota is used, from 0 to 1. Null when the limit is zero:
 * a share of nothing cannot be worked out, and would divide by zero.
 */
function share(used: number, limit: number): number | null {
  return limit === 0 ? null : used / limit;
}

/** Share of the key quota used. */
export function keyShare(user: KeyUser): number | null {
  return share(user.quotaKeys, user.maxKeys);
}

/** Share of the byte quota used. */
export function byteShare(user: KeyUser): number | null {
  return share(user.quotaBytes, user.maxBytes);
}

/** The larger of the two shares, which is the one that will bite first. */
export function worstShare(user: KeyUser): number | null {
  const shares = [keyShare(user), byteShare(user)].filter(
    (value): value is number => value !== null,
  );

  return shares.length === 0 ? null : Math.max(...shares);
}

/** Whether either quota is close enough to its limit to be worth saying. */
export function nearQuota(user: KeyUser, threshold = NEAR_QUOTA): boolean {
  const worst = worstShare(user);
  return worst !== null && worst >= threshold;
}

export interface KeyUsersSummary {
  users: number;
  /** Keys held across every user. */
  keys: number;
  /** Of those, the ones still without a payload. */
  uninstantiated: number;
  /** Users with either quota at or past the threshold. */
  nearQuota: KeyUser[];
  /** The user closest to a quota, or null when none can be worked out. */
  closest: KeyUser | null;
}

export function summarize(info: KeyUsersInfo, threshold = NEAR_QUOTA): KeyUsersSummary {
  const ranked = info.users
    .filter((user) => worstShare(user) !== null)
    .sort((a, b) => worstShare(b)! - worstShare(a)! || a.uid - b.uid);

  return {
    users: info.users.length,
    keys: info.users.reduce((total, user) => total + user.keys, 0),
    uninstantiated: info.users.reduce((total, user) => total + uninstantiated(user), 0),
    nearQuota: info.users.filter((user) => nearQuota(user, threshold)),
    closest: ranked[0] ?? null,
  };
}
