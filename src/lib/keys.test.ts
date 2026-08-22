import { describe as suite, expect, it } from 'vitest';
import { readKeysFixture as fixture } from '../test/fixtures';
import {
  countTypes,
  describe,
  flagsOf,
  formatPermissionByte,
  hasFlag,
  isExpired,
  isPermanent,
  maybeTruncated,
  parseKeys,
  permissionByte,
  permissionsOf,
  summarize,
  TYPE_WIDTH,
} from './keys';

suite('parseKeys — an ordinary desktop session', () => {
  const info = parseKeys(fixture('desktop-session'));

  it('reads every field of a line', () => {
    expect(info.keys[0]).toEqual({
      serial: '0083c4a2',
      flags: 'I--Q---',
      usage: 3,
      timeout: 'perm',
      permissions: 0x3f030000,
      uid: 1000,
      gid: 1000,
      type: 'keyring',
      description: '_ses: 2',
    });
  });

  /**
   * The flags are positional: the third character is `dead` whatever else is
   * set, and a `-` there means it is not.
   */
  it('reads the flags by position rather than by letter', () => {
    const key = info.keys[0]!;

    expect(flagsOf(key).map((flag) => flag.name)).toEqual(['instantiated', 'quota']);
    expect(hasFlag(key, 'instantiated')).toBe(true);
    expect(hasFlag(key, 'quota')).toBe(true);
    expect(hasFlag(key, 'revoked')).toBe(false);
    expect(hasFlag(key, 'dead')).toBe(false);
  });

  /**
   * The mask is four bytes: possessor, owning user, owning group, everyone
   * else — `3f030000` being everything, then view and read, then nothing.
   */
  it('splits the permission mask into its four subjects', () => {
    const key = info.keys[0]!;

    expect(permissionByte(key, 'possessor')).toBe(0x3f);
    expect(permissionByte(key, 'user')).toBe(0x03);
    expect(permissionByte(key, 'group')).toBe(0x00);
    expect(permissionByte(key, 'other')).toBe(0x00);

    expect(permissionsOf(key, 'possessor')).toEqual([
      'view',
      'read',
      'write',
      'search',
      'link',
      'setattr',
    ]);
    expect(permissionsOf(key, 'user')).toEqual(['view', 'read']);
    expect(permissionsOf(key, 'other')).toEqual([]);
  });

  // Written the way keyctl writes it: two unused, then a l s w r v.
  it('formats a permission byte the way keyctl does', () => {
    expect(formatPermissionByte(0x3f)).toBe('--alswrv');
    expect(formatPermissionByte(0x03)).toBe('------rv');
    expect(formatPermissionByte(0x00)).toBe('--------');
    expect(formatPermissionByte(0x08)).toBe('----s---');
  });

  it('splits the description from the detail the type appended', () => {
    expect(describe(info.keys[0]!)).toEqual({ name: '_ses', detail: '2' });
    expect(describe(info.keys[3]!)).toEqual({ name: 'wifi_psk', detail: '32' });
    expect(describe(info.keys[4]!)).toEqual({ name: '.dns_resolver', detail: 'empty' });
  });

  it('counts the keyrings among the keys', () => {
    expect(summarize(info)).toMatchObject({ total: 5, keyrings: 4 });
    expect(summarize(info).unusable).toEqual([]);
  });
});

suite('parseKeys — a Kerberos user', () => {
  const info = parseKeys(fixture('kerberos-user'));

  // perm never expires; anything else is a time the kernel wrote out.
  it('reads a timeout as the kernel printed it', () => {
    const timeouts = info.keys.map((key) => key.timeout);

    expect(timeouts).toEqual(['perm', '9h', '9h', '43m', '7d', '2w']);
    expect(isPermanent(info.keys[0]!)).toBe(true);
    expect(isPermanent(info.keys[1]!)).toBe(false);
    expect(info.keys.some((key) => isExpired(key))).toBe(false);
  });

  it('counts the keys that will expire', () => {
    const summary = summarize(info);

    expect(summary.expiring).toHaveLength(5);
    expect(summary.expired).toEqual([]);
  });

  it('counts the types, commonest first', () => {
    expect(countTypes(info)).toEqual([
      { type: 'keyring', count: 2 },
      { type: 'user', count: 2 },
      { type: 'big_key', count: 1 },
      { type: 'logon', count: 1 },
    ]);
  });

  it('reads a description holding a colon of its own', () => {
    const afs = info.keys.find((key) => key.type === 'logon')!;

    // The type wrote `afs:cell.example: 48`, so only the last `: ` splits it.
    expect(describe(afs)).toEqual({ name: 'afs:cell.example', detail: '48' });
  });
});

suite('parseKeys — keys in every unhappy state', () => {
  const info = parseKeys(fixture('expired-and-revoked'));

  it('reads an expired key', () => {
    const expired = info.keys.find((key) => key.timeout === 'expd')!;

    expect(isExpired(expired)).toBe(true);
    expect(describe(expired).name).toBe('stale_token');
  });

  it('reads revoked, invalidated, negative and under-construction keys', () => {
    const named = (name: string) => info.keys.find((key) => describe(key).name === name)!;

    expect(hasFlag(named('revoked_key'), 'revoked')).toBe(true);
    expect(hasFlag(named('gone_key'), 'invalidated')).toBe(true);
    expect(hasFlag(named('missing.example.com'), 'negative')).toBe(true);
    expect(hasFlag(named('server.example'), 'under construction')).toBe(true);
  });

  /**
   * A negative key is a cached failure, so it was never instantiated — which
   * is a different thing from being revoked afterwards.
   */
  it('tells a cached failure from a key that was instantiated', () => {
    const negative = info.keys.find((key) => hasFlag(key, 'negative'))!;

    expect(hasFlag(negative, 'instantiated')).toBe(false);
    expect(hasFlag(info.keys[0]!, 'instantiated')).toBe(true);
  });

  it('gathers the keys that can no longer be used', () => {
    const summary = summarize(info);

    expect(summary.unusable.map((key) => describe(key).name)).toEqual([
      'stale_token',
      'revoked_key',
      'gone_key',
    ]);
    expect(summary.expired).toHaveLength(1);
  });
});

suite('parseKeys — read as root', () => {
  const info = parseKeys(fixture('root-view'));

  /**
   * The kernel prints the type through `%-9.9s`, so `asymmetric` arrives a
   * character short and nothing here can put it back.
   */
  it('reads a type name the kernel cut short', () => {
    const asymmetric = info.keys.filter((key) => key.type === 'asymmetri');

    expect(asymmetric).toHaveLength(2);
    expect(asymmetric[0]!.type).toHaveLength(TYPE_WIDTH);
    expect(maybeTruncated(asymmetric[0]!)).toBe(true);
    expect(maybeTruncated(info.keys[0]!)).toBe(false);
  });

  it('reads the keys root can see and nobody else', () => {
    expect(describe(info.keys[0]!).name).toBe('.builtin_trusted_keys');
    expect(summarize(info)).toMatchObject({ total: 6, keyrings: 2 });
  });

  it('reads a mask granting the group nothing', () => {
    const builtin = info.keys[0]!;

    expect(permissionByte(builtin, 'possessor')).toBe(0x1f);
    expect(permissionsOf(builtin, 'possessor')).not.toContain('setattr');
    expect(permissionsOf(builtin, 'user')).toEqual(['view', 'read', 'write', 'search']);
    expect(permissionsOf(builtin, 'group')).toEqual([]);
  });
});

suite('parseKeys — nothing the reader may see', () => {
  const info = parseKeys(fixture('no-keys'));

  /**
   * The file lists what the reader has View permission on, so empty says
   * something about the reader rather than about the machine.
   */
  it('reads an empty file as no visible keys', () => {
    expect(info.keys).toEqual([]);
    expect(summarize(info)).toMatchObject({ total: 0, keyrings: 0 });
    expect(summarize(info).types).toEqual([]);
  });
});

suite('parseKeys — every fixture', () => {
  const names = [
    'desktop-session',
    'kerberos-user',
    'expired-and-revoked',
    'root-view',
    'no-keys',
  ];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseKeys(fixture(name));
    const summary = summarize(info);

    for (const key of info.keys) {
      expect(key.serial).toMatch(/^[0-9a-f]{8}$/);
      expect(key.flags).toHaveLength(7);
      expect(key.type).not.toBe('');
      expect(key.type.length).toBeLessThanOrEqual(TYPE_WIDTH);
      expect(key.usage).toBeGreaterThan(0);
      expect(Number.isInteger(key.uid)).toBe(true);
      expect(key.permissions).toBeGreaterThanOrEqual(0);

      // The four bytes together are the whole mask.
      const bytes =
        (permissionByte(key, 'possessor') << 24) |
        (permissionByte(key, 'user') << 16) |
        (permissionByte(key, 'group') << 8) |
        permissionByte(key, 'other');
      expect(bytes >>> 0).toBe(key.permissions);

      // A flag is set only where its own position holds something.
      for (const flag of flagsOf(key)) expect(hasFlag(key, flag.name)).toBe(true);
    }

    // A serial identifies one key.
    expect(new Set(info.keys.map((key) => key.serial)).size).toBe(summary.total);
    // Every key is counted once under its type.
    expect(summary.types.reduce((total, entry) => total + entry.count, 0)).toBe(summary.total);
    // Expired keys are a subset of the ones that can no longer be used.
    for (const key of summary.expired) expect(summary.unusable).toContain(key);
  });
});

suite('parseKeys — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseKeys('').keys).toEqual([]);
  });

  it('returns nothing for a file that is not /proc/keys', () => {
    expect(parseKeys('processor\t: 0\n').keys).toEqual([]);
  });

  it('reads a key whose type printed no detail', () => {
    const info = parseKeys('0083c4a2 I--Q---     1 perm 3f030000     0     0 user      bare\n');

    expect(describe(info.keys[0]!)).toEqual({ name: 'bare', detail: null });
  });

  it('reads a key with no description at all', () => {
    const info = parseKeys('0083c4a2 I--Q---     1 perm 3f030000     0     0 keyring\n');

    expect(info.keys[0]?.description).toBe('');
    expect(describe(info.keys[0]!)).toEqual({ name: '', detail: null });
  });

  it('skips a line whose flags field is the wrong width', () => {
    expect(parseKeys('0083c4a2 I--Q 1 perm 3f030000 0 0 user x\n').keys).toEqual([]);
  });

  it('keeps the leading zeros of a serial', () => {
    const info = parseKeys('00000001 I--Q---     9 perm 1f0f0000     0     0 keyring   .x: 3\n');

    expect(info.keys[0]?.serial).toBe('00000001');
  });

  it('reads a mask granting everyone everything', () => {
    const info = parseKeys('0083c4a2 I--Q---     1 perm 3f3f3f3f     0     0 user      x: 1\n');
    const key = info.keys[0]!;

    for (const subject of ['possessor', 'user', 'group', 'other'] as const) {
      expect(formatPermissionByte(permissionByte(key, subject))).toBe('--alswrv');
    }
  });

  // The high bit of the mask would make a signed shift go negative.
  it('reads a mask with the top bit set', () => {
    const info = parseKeys('0083c4a2 I--Q---     1 perm ff000000     0     0 user      x: 1\n');
    const key = info.keys[0]!;

    expect(key.permissions).toBe(0xff000000);
    expect(permissionByte(key, 'possessor')).toBe(0xff);
    expect(permissionsOf(key, 'possessor')).toHaveLength(6);
  });

  it('has no flags at all when every position is a dash', () => {
    const info = parseKeys('0083c4a2 -------     1 perm 3f030000     0     0 user      x: 1\n');

    expect(flagsOf(info.keys[0]!)).toEqual([]);
    expect(hasFlag(info.keys[0]!, 'instantiated')).toBe(false);
  });
});
