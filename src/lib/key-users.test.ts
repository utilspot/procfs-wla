import { describe, expect, it } from 'vitest';
import { readKeyUsersFixture as fixture } from '../test/fixtures';
import {
  byteShare,
  isRoot,
  keyShare,
  nearQuota,
  parseKeyUsers,
  summarize,
  uninstantiated,
  worstShare,
} from './key-users';

describe('parseKeyUsers — an ordinary desktop', () => {
  const info = parseKeyUsers(fixture('desktop'));

  it('reads the uid, the reference count and the three pairs', () => {
    expect(info.users[1]).toEqual({
      uid: 1000,
      usage: 2,
      keys: 9,
      instantiated: 9,
      quotaKeys: 9,
      maxKeys: 200,
      quotaBytes: 384,
      maxBytes: 20000,
    });
  });

  /**
   * Root has its own limits, which is why they are printed per line rather
   * than being one number for the machine.
   */
  it('reads root’s larger quota from its own line', () => {
    const [root, user] = info.users;

    expect(isRoot(root!)).toBe(true);
    expect(root!.maxKeys).toBe(1000000);
    expect(root!.maxBytes).toBe(25000000);
    expect(user!.maxKeys).toBe(200);
    expect(isRoot(user!)).toBe(false);
  });

  it('works out how much of each quota is used', () => {
    const user = info.users[1]!;

    expect(keyShare(user)).toBeCloseTo(9 / 200);
    expect(byteShare(user)).toBeCloseTo(384 / 20000);
    // The key quota is the tighter of the two here.
    expect(worstShare(user)).toBeCloseTo(9 / 200);
    expect(nearQuota(user)).toBe(false);
  });

  it('summarizes the keys held across the users', () => {
    expect(summarize(info)).toMatchObject({ users: 2, keys: 13, uninstantiated: 0 });
    expect(summarize(info).nearQuota).toEqual([]);
    expect(summarize(info).closest?.uid).toBe(1000);
  });
});

describe('parseKeyUsers — a multi-user server', () => {
  const info = parseKeyUsers(fixture('many-users'));

  it('reads a line per uid holding keys', () => {
    expect(info.users.map((user) => user.uid)).toEqual([0, 33, 999, 1000, 1001, 1002]);
    expect(summarize(info).keys).toBe(50);
  });

  // Service accounts get the ordinary quota, root alone gets the larger one.
  it('gives every uid but root the same limits', () => {
    const others = info.users.filter((user) => !isRoot(user));

    expect(others.every((user) => user.maxKeys === 200)).toBe(true);
    expect(others.every((user) => user.maxBytes === 20000)).toBe(true);
  });

  it('picks out the user closest to a quota', () => {
    expect(summarize(info).closest?.uid).toBe(1000);
  });
});

describe('parseKeyUsers — a user close to the limit', () => {
  const info = parseKeyUsers(fixture('near-quota'));

  /**
   * A key past the quota fails rather than evicting anything, so being close
   * to it is worth saying before it happens.
   */
  it('reports the user near both quotas', () => {
    const summary = summarize(info);

    expect(summary.nearQuota.map((user) => user.uid)).toEqual([1000]);
    expect(nearQuota(info.users[1]!)).toBe(true);
    expect(keyShare(info.users[1]!)).toBeCloseTo(193 / 200);
    expect(byteShare(info.users[1]!)).toBeCloseTo(19604 / 20000);
  });

  it('leaves the users with room alone', () => {
    expect(nearQuota(info.users[0]!)).toBe(false);
    expect(nearQuota(info.users[2]!)).toBe(false);
  });

  // Root's usage is nothing against a quota that large.
  it('measures root against root’s own quota', () => {
    expect(keyShare(info.users[0]!)).toBeCloseTo(5 / 1000000);
  });

  it('takes a threshold, since 80% is only a default', () => {
    expect(nearQuota(info.users[2]!, 0.05)).toBe(true);
    expect(summarize(info, 0.05).nearQuota.map((user) => user.uid)).toEqual([1000, 1001]);
  });
});

describe('parseKeyUsers — keys not yet instantiated', () => {
  const info = parseKeyUsers(fixture('uninstantiated'));

  /**
   * The first pair is not a quota: both numbers describe the same keys, and
   * the gap is the ones with no payload yet.
   */
  it('reads the gap between keys held and keys instantiated', () => {
    const user = info.users[1]!;

    expect(user.keys).toBe(12);
    expect(user.instantiated).toBe(9);
    expect(uninstantiated(user)).toBe(3);
    expect(summarize(info).uninstantiated).toBe(3);
  });

  // Those keys still count against the quota.
  it('counts them against the quota all the same', () => {
    expect(info.users[1]!.quotaKeys).toBe(12);
  });
});

describe('parseKeyUsers — only root', () => {
  const info = parseKeyUsers(fixture('root-only'));

  it('reads a file with a single line', () => {
    expect(info.users).toHaveLength(1);
    expect(summarize(info)).toMatchObject({ users: 1, keys: 7 });
    expect(summarize(info).closest?.uid).toBe(0);
  });
});

describe('parseKeyUsers — every fixture', () => {
  const names = ['desktop', 'many-users', 'near-quota', 'uninstantiated', 'root-only'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseKeyUsers(fixture(name));
    const summary = summarize(info);

    expect(summary.users).toBeGreaterThan(0);

    for (const user of info.users) {
      expect(Number.isInteger(user.uid)).toBe(true);
      expect(user.usage).toBeGreaterThan(0);
      // Instantiated keys are a subset of the keys held.
      expect(user.instantiated).toBeLessThanOrEqual(user.keys);
      // Only keys flagged Q count against the quota, so it cannot exceed them.
      expect(user.quotaKeys).toBeLessThanOrEqual(user.keys);
      // Nothing is over its limit: the kernel refuses the key instead.
      expect(user.quotaKeys).toBeLessThanOrEqual(user.maxKeys);
      expect(user.quotaBytes).toBeLessThanOrEqual(user.maxBytes);
      expect(worstShare(user)).toBeLessThanOrEqual(1);

      // Root's limits are the larger pair, and only root's.
      if (isRoot(user)) expect(user.maxKeys).toBeGreaterThan(200);
      else expect(user.maxKeys).toBe(200);
    }

    // A uid appears once.
    expect(new Set(info.users.map((user) => user.uid)).size).toBe(summary.users);
    // The users near a quota are the ones the threshold picks out.
    expect(summary.nearQuota.every((user) => nearQuota(user))).toBe(true);
  });
});

describe('parseKeyUsers — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseKeyUsers('').users).toEqual([]);
    expect(summarize(parseKeyUsers(''))).toMatchObject({ users: 0, keys: 0, closest: null });
  });

  it('returns nothing for a file that is not /proc/key-users', () => {
    expect(parseKeyUsers('processor\t: 0\n').users).toEqual([]);
  });

  it('reads a line however it is spaced', () => {
    expect(parseKeyUsers('0: 3 4/4 4/1000000 92/25000000\n').users[0]).toMatchObject({
      uid: 0,
      usage: 3,
      keys: 4,
    });
  });

  it('skips a line with a pair missing', () => {
    expect(parseKeyUsers('    0:     3 4/4 4/1000000\n').users).toEqual([]);
  });

  it('skips a line with no colon after the uid', () => {
    expect(parseKeyUsers('    0     3 4/4 4/1000000 92/25000000\n').users).toEqual([]);
  });

  // A limit of zero is a share of nothing, not a division by zero.
  it('claims no share when the limit is zero', () => {
    const info = parseKeyUsers('    0:     3 4/4 0/0 0/0\n');

    expect(keyShare(info.users[0]!)).toBeNull();
    expect(byteShare(info.users[0]!)).toBeNull();
    expect(worstShare(info.users[0]!)).toBeNull();
    expect(nearQuota(info.users[0]!)).toBe(false);
    expect(summarize(info).closest).toBeNull();
  });

  // Both numbers describe the same keys, so this cannot really happen — and if
  // it does, it is not a negative count of anything.
  it('never reports fewer than no uninstantiated keys', () => {
    const info = parseKeyUsers('    0:     3 4/9 4/1000000 92/25000000\n');

    expect(uninstantiated(info.users[0]!)).toBe(0);
    expect(summarize(info).uninstantiated).toBe(0);
  });

  it('reads a user at exactly the quota', () => {
    const info = parseKeyUsers(' 1000:     3 200/200 200/200 20000/20000\n');

    expect(keyShare(info.users[0]!)).toBe(1);
    expect(nearQuota(info.users[0]!)).toBe(true);
  });
});
