import { describe, expect, it } from 'vitest';
import { readUidMapFixture as fixture } from '../test/fixtures';
import {
  coversInvalidId,
  describeExtent,
  describeId,
  EXTENTS_MAX_LEGACY,
  formatRange,
  INVALID_UID,
  isDelegated,
  isIdentity,
  isPassthrough,
  isRootRemapped,
  isSelfMap,
  isUnmapped,
  lastInside,
  lastOutside,
  overlaps,
  parseUidMap,
  rootOutside,
  summarize,
  toInside,
  toOutside,
  totalMapped,
} from './uid_map';

describe('parseUidMap', () => {
  it('reads the three columns off a line, in written order', () => {
    const map = parseUidMap(fixture('rootless', 'self'));

    expect(map.extents).toHaveLength(2);
    expect(map.extents[0]).toMatchObject({ inside: 0, outside: 1000, length: 1, line: 1 });
    expect(map.extents[1]).toMatchObject({ inside: 1, outside: 100000, length: 65536, line: 2 });
  });

  /** The kernel pads each field to ten columns, so the padding is not data. */
  it('does not mind how the numbers are spaced', () => {
    expect(parseUidMap('0 1000 1\n').extents[0]).toMatchObject({
      inside: 0,
      outside: 1000,
      length: 1,
    });
  });

  it('reads an empty file as a namespace with no map written', () => {
    expect(isUnmapped(parseUidMap(''))).toBe(true);
    expect(isUnmapped(parseUidMap('\n'))).toBe(true);
    expect(isUnmapped(parseUidMap(fixture('unmapped', 'self')))).toBe(true);
    expect(isUnmapped(parseUidMap(fixture('initial', 'self')))).toBe(false);
  });

  /**
   * A line that is not three numbers is not a range, and half of one is worse
   * than none — so it is kept aside for the page to say so rather than parsed.
   */
  it('keeps a line that is not three numbers rather than reading a range out of it', () => {
    const map = parseUidMap('         0       1000          1\n0 1000\nnot a mapping\n');

    expect(map.extents).toHaveLength(1);
    expect(map.malformed).toEqual(['0 1000', 'not a mapping']);
  });

  it('does not take a negative number for an id', () => {
    expect(parseUidMap('-1 1000 1\n').extents).toHaveLength(0);
  });
});

describe('the ends of a range', () => {
  const [extent] = parseUidMap(fixture('rootless', 'self')).extents.slice(1);

  it('are the first id plus the count, less one', () => {
    expect(lastInside(extent!)).toBe(65536);
    expect(lastOutside(extent!)).toBe(165535);
  });

  it('are the first id itself where the range is one long', () => {
    const [single] = parseUidMap(fixture('rootless', 'self')).extents;

    expect(lastInside(single!)).toBe(0);
    expect(lastOutside(single!)).toBe(1000);
  });
});

describe('translating an id', () => {
  const map = parseUidMap(fixture('rootless', 'self'));

  it('carries the offset within the range across', () => {
    expect(toOutside(map, 0)).toBe(1000);
    expect(toOutside(map, 1)).toBe(100000);
    expect(toOutside(map, 1000)).toBe(100999);
    expect(toOutside(map, 65536)).toBe(165535);
  });

  it('goes back the other way', () => {
    expect(toInside(map, 1000)).toBe(0);
    expect(toInside(map, 100000)).toBe(1);
    expect(toInside(map, 165535)).toBe(65536);
  });

  /** Which is what the overflow uid stands for, on whichever side cannot see it. */
  it('answers with nothing for an id no range covers', () => {
    expect(toOutside(map, 65537)).toBeNull();
    expect(toInside(map, 999)).toBeNull();
    expect(toInside(map, 165536)).toBeNull();
  });

  it('has nothing to say at all where no map was written', () => {
    expect(toOutside(parseUidMap(''), 0)).toBeNull();
  });
});

describe('isIdentity', () => {
  /** The map every process in the initial user namespace has. */
  it('is true for every id standing for itself', () => {
    expect(isIdentity(parseUidMap(fixture('initial', 'self')))).toBe(true);
  });

  it('is false for a map that only starts at zero', () => {
    expect(isIdentity(parseUidMap(fixture('rootless', 'self')))).toBe(false);
    expect(isIdentity(parseUidMap('0 0 65536\n'))).toBe(false);
  });

  it('is false where no map was written', () => {
    expect(isIdentity(parseUidMap(''))).toBe(false);
  });

  /**
   * `0 0 4294967295` covers 0 through 4294967294, stopping one short of
   * `(uid_t)-1` — which is the kernel's "no id" value rather than a user.
   */
  it('stops one id short of (uid_t)-1', () => {
    const [identity] = parseUidMap(fixture('initial', 'self')).extents;

    expect(lastInside(identity!)).toBe(INVALID_UID - 1);
    expect(coversInvalidId(identity!)).toBe(false);
    expect(coversInvalidId({ ...identity!, length: INVALID_UID + 1 })).toBe(true);
  });
});

describe('root inside the namespace', () => {
  it('is an ordinary user outside it, for a rootless container', () => {
    const map = parseUidMap(fixture('rootless', 'self'));

    expect(rootOutside(map)).toBe(1000);
    expect(isRootRemapped(map)).toBe(true);
  });

  it('is root outside it in the initial namespace', () => {
    const map = parseUidMap(fixture('initial', 'self'));

    expect(rootOutside(map)).toBe(0);
    expect(isRootRemapped(map)).toBe(false);
  });

  /** A map need not include uid 0 at all, and one written unprivileged rarely does. */
  it('is not there at all where nothing maps id 0', () => {
    const map = parseUidMap(fixture('map-self', 'self'));

    expect(rootOutside(map)).toBeNull();
    expect(isRootRemapped(map)).toBe(false);
  });
});

/**
 * Without CAP_SETUID in the parent namespace the kernel accepts one line
 * mapping the caller's own id, and nothing more — which is what `unshare -U`
 * on its own leaves behind.
 */
describe('isSelfMap', () => {
  it('is true for one range of one id', () => {
    expect(isSelfMap(parseUidMap(fixture('map-self', 'self')))).toBe(true);
    expect(isSelfMap(parseUidMap(fixture('map-self', '4242')))).toBe(true);
  });

  it('is false for a range wider than one id', () => {
    expect(isSelfMap(parseUidMap(fixture('rootless', 'self')))).toBe(false);
    expect(isSelfMap(parseUidMap(fixture('initial', 'self')))).toBe(false);
  });

  /** The identity map is one line too, and is not this. */
  it('is not what the summary calls the identity map', () => {
    expect(summarize(parseUidMap(fixture('initial', 'self'))).selfMap).toBe(false);
  });
});

describe('the ranges within a larger map', () => {
  const map = parseUidMap(fixture('many-extents', 'self'));

  /** A host user shared in, so the files it owns keep one owner on both sides. */
  it('spots an id that is itself on both sides', () => {
    expect(map.extents.filter(isPassthrough).map((extent) => extent.inside)).toEqual([
      1000, 6000, 65534,
    ]);
  });

  it('spots the ones that come out of a delegated subuid range', () => {
    expect(map.extents.filter(isDelegated).map((extent) => extent.outside)).toEqual([
      1000000, 1001001, 1006001,
    ]);
  });

  it('does not call an unchanged id a delegated one, whatever its number', () => {
    expect(isDelegated(map.extents[5]!)).toBe(false);
    expect(isPassthrough(map.extents[5]!)).toBe(true);
  });

  it('counts every id the map accounts for', () => {
    expect(totalMapped(map)).toBe(65535);
    expect(totalMapped(parseUidMap(fixture('rootless', 'self')))).toBe(65537);
    expect(totalMapped(parseUidMap(''))).toBe(0);
  });
});

/**
 * The kernel refuses an overlapping map at write time, so a file holding one
 * did not come from a running namespace — and there is no honest answer to
 * what a doubly-mapped id translates to.
 */
describe('overlaps', () => {
  it('finds none in a map a kernel would have taken', () => {
    expect(overlaps(parseUidMap(fixture('many-extents', 'self')))).toEqual([]);
    expect(overlaps(parseUidMap(fixture('rootless', 'self')))).toEqual([]);
  });

  it('finds two ranges covering the same id inside', () => {
    const found = overlaps(parseUidMap('0 1000 100\n50 5000 10\n'));

    expect(found).toHaveLength(1);
    expect(found[0]!.side).toBe('inside');
  });

  it('finds two ranges covering the same id outside', () => {
    const found = overlaps(parseUidMap('0 1000 100\n500 1050 10\n'));

    expect(found).toHaveLength(1);
    expect(found[0]!.side).toBe('outside');
  });

  it('does not call two ranges that merely touch an overlap', () => {
    expect(overlaps(parseUidMap('0 1000 100\n100 1100 100\n'))).toEqual([]);
  });
});

describe('describeId', () => {
  it('names the ids worth naming', () => {
    expect(describeId(0)).toBe('root');
    expect(describeId(65534)).toContain('overflow uid');
    expect(describeId(INVALID_UID)).toContain('not an id at all');
  });

  it('says which side of the ordinary-account line an id falls', () => {
    expect(describeId(33)).toBe('a system account');
    expect(describeId(1000)).toBe('an ordinary user account');
    expect(describeId(100000)).toContain('delegated subuid');
  });
});

describe('describeExtent', () => {
  it('reads a one-id range as the single id it is', () => {
    const [extent] = parseUidMap(fixture('rootless', 'self')).extents;

    expect(describeExtent(extent!)).toBe('Id 0 inside is id 1000 outside');
  });

  it('reads a wider range as its two ends', () => {
    const [, extent] = parseUidMap(fixture('rootless', 'self')).extents;

    expect(describeExtent(extent!)).toContain('Ids 1–65536 inside are ids 100000–165535 outside');
    expect(describeExtent(extent!)).toContain('/etc/subuid');
  });

  it('says an unchanged id changes nothing rather than mapping it to itself', () => {
    const [, passthrough] = parseUidMap(fixture('many-extents', 'self')).extents;

    expect(describeExtent(passthrough!)).toContain('is itself on both sides');
  });
});

describe('formatRange', () => {
  it('is the one id where the range is one long', () => {
    expect(formatRange(1000, 1)).toBe('1,000');
  });

  it('is both ends otherwise, inclusive', () => {
    expect(formatRange(0, 65536)).toBe('0–65,535');
  });
});

describe('summarize', () => {
  it('reads the initial namespace as the identity map it is', () => {
    const summary = summarize(parseUidMap(fixture('initial', 'self')));

    expect(summary).toMatchObject({
      extents: 1,
      unmapped: false,
      identity: true,
      selfMap: false,
      root: 0,
      rootRemapped: false,
      pastLegacyCap: false,
    });
    expect(summary.mapped).toBe(INVALID_UID);
  });

  it('reads a rootless container as root being somebody else', () => {
    const summary = summarize(parseUidMap(fixture('rootless', 'self')));

    expect(summary).toMatchObject({ extents: 2, identity: false, root: 1000, rootRemapped: true });
    expect(summary.delegated).toHaveLength(1);
  });

  it('reads an unwritten map as unmapped, with nothing else to say', () => {
    const summary = summarize(parseUidMap(fixture('unmapped', 'self')));

    expect(summary).toMatchObject({ extents: 0, unmapped: true, root: null, mapped: 0 });
    expect(summary.overlaps).toEqual([]);
  });

  /** A map longer than five ranges was written on 4.15 or newer. */
  it('says when a map has more ranges than an older kernel would have taken', () => {
    const summary = summarize(parseUidMap(fixture('many-extents', 'self')));

    expect(summary.extents).toBeGreaterThan(EXTENTS_MAX_LEGACY);
    expect(summary.pastLegacyCap).toBe(true);
    expect(summary.passthrough).toHaveLength(3);
    expect(summarize(parseUidMap(fixture('rootless', 'self'))).pastLegacyCap).toBe(false);
  });

  it('carries the lines it could not read through', () => {
    expect(summarize(parseUidMap('nonsense\n')).malformed).toEqual(['nonsense']);
  });
});

// Any of these can turn up on a given server run, so every one is parsed here.
describe.each([
  { fixture: 'initial', pid: 'self', extents: 1 },
  { fixture: 'initial', pid: '12282', extents: 1 },
  { fixture: 'rootless', pid: 'self', extents: 2 },
  { fixture: 'rootless', pid: '3117', extents: 2 },
  { fixture: 'unmapped', pid: 'self', extents: 0 },
  { fixture: 'unmapped', pid: '901', extents: 1 },
  { fixture: 'map-self', pid: 'self', extents: 1 },
  { fixture: 'map-self', pid: '4242', extents: 1 },
  { fixture: 'many-extents', pid: 'self', extents: 6 },
  { fixture: 'many-extents', pid: '5150', extents: 1 },
])('every fixture: $fixture, pid $pid', ({ fixture: name, pid, extents }) => {
  it(`parses into ${extents} ranges, all of them sound`, () => {
    const map = parseUidMap(fixture(name, pid));

    expect(map.extents).toHaveLength(extents);
    expect(map.malformed).toEqual([]);
    expect(overlaps(map)).toEqual([]);
    expect(map.extents.every((extent) => extent.length > 0)).toBe(true);
    expect(map.extents.some(coversInvalidId)).toBe(false);
  });
});
