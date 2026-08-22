import { describe, expect, it } from 'vitest';
import { readGidMapFixture as fixture } from '../test/fixtures';
import {
  describeGroupExtent,
  describeGroupId,
  groupsFrozen,
  INVALID_GID,
  isDelegatedGroup,
  isPassthroughGroup,
  OVERFLOW_GID,
  parseGidMap,
  SETGROUPS_ALLOW,
  SETGROUPS_DENY,
  setgroupsEvidence,
  SUBGID_BASE,
} from './gid_map';
import { summarize, toInside, toOutside } from './uid_map';

/**
 * The format is `uid_map`'s, so this is checked once rather than again per
 * function: the three columns parse into the same ranges the other file's
 * parser produces, because they are that parser.
 */
describe('parseGidMap — the same three columns as uid_map', () => {
  const map = parseGidMap(fixture('rootless', 'self'));

  it('reads a line as first inside, first outside, how many', () => {
    expect(map.extents).toHaveLength(2);
    expect(map.extents[0]).toMatchObject({ inside: 0, outside: 1000, length: 1, line: 1 });
    expect(map.extents[1]).toMatchObject({ inside: 1, outside: 100000, length: 65536, line: 2 });
    expect(map.malformed).toEqual([]);
  });

  it('translates a group in either direction, and answers nothing outside the ranges', () => {
    expect(toOutside(map, 0)).toBe(1000);
    expect(toOutside(map, 5)).toBe(100004);
    expect(toInside(map, 100004)).toBe(5);
    // Past the end of every range, so it reads as the overflow gid instead.
    expect(toOutside(map, 70000)).toBeNull();
  });

  it('keeps a line that is not three numbers aside rather than reading half of it', () => {
    const broken = parseGidMap('         0       1000          1\nnot a mapping\n');

    expect(broken.extents).toHaveLength(1);
    expect(broken.malformed).toEqual(['not a mapping']);
  });
});

/**
 * The point of the page. An unprivileged writer may put one range of one id
 * here and reaches the file only by turning `setgroups()` off first; anything
 * wider took `CAP_SETGID`, which needs no such thing.
 */
describe('setgroupsEvidence', () => {
  it('reads a one-id map as a writer that must have denied setgroups', () => {
    const evidence = setgroupsEvidence(parseGidMap(fixture('unshared', 'self')));

    expect(evidence.value).toBe(SETGROUPS_DENY);
    expect(evidence.reason).toContain('CAP_SETGID');
    // Root can write the same line, so the shape points at it rather than settling it.
    expect(evidence.certain).toBe(false);
    expect(groupsFrozen(parseGidMap(fixture('unshared', 'self')))).toBe(true);
  });

  /** `unshare -Ur` maps group 0 rather than the caller's own, still one id. */
  it('reads a remapped root group of one id the same way', () => {
    expect(setgroupsEvidence(parseGidMap(fixture('unshared', '4242'))).value).toBe(SETGROUPS_DENY);
  });

  it('reads a map wider than one id as one an unprivileged writer could not have made', () => {
    const evidence = setgroupsEvidence(parseGidMap(fixture('rootless', 'self')));

    expect(evidence.value).toBe(SETGROUPS_ALLOW);
    expect(evidence.certain).toBe(false);
    expect(groupsFrozen(parseGidMap(fixture('rootless', 'self')))).toBe(false);
  });

  /**
   * The one shape that settles it: a written `gid_map` is what makes
   * `setgroups` unwritable, and the initial namespace's was written long ago.
   */
  it('is certain only about the initial namespace', () => {
    const evidence = setgroupsEvidence(parseGidMap(fixture('initial', 'self')));

    expect(evidence).toMatchObject({ value: SETGROUPS_ALLOW, certain: true });
  });

  it('says nothing at all about a map that has not been written', () => {
    const evidence = setgroupsEvidence(parseGidMap(fixture('unmapped', 'self')));

    expect(evidence).toMatchObject({ value: null, certain: false });
    expect(evidence.reason).toContain('either way');
    expect(groupsFrozen(parseGidMap(fixture('unmapped', 'self')))).toBe(false);
  });
});

describe('parseGidMap — device groups punched through a delegated range', () => {
  const map = parseGidMap(fixture('shared-groups', 'self'));
  const summary = summarize(map);

  it('reads seven ranges, more than a kernel before 4.15 would take', () => {
    expect(map.extents).toHaveLength(7);
    expect(summary.pastLegacyCap).toBe(true);
    // None of them tread on each other, or the kernel would have refused it.
    expect(summary.overlaps).toEqual([]);
  });

  it('tells a group held at its host number from a delegated one', () => {
    const audio = map.extents.find((extent) => extent.inside === 29)!;
    const delegated = map.extents[0]!;

    expect(isPassthroughGroup(audio)).toBe(true);
    expect(isDelegatedGroup(audio)).toBe(false);
    expect(isDelegatedGroup(delegated)).toBe(true);
    expect(summary.passthrough.map((extent) => extent.inside)).toEqual([29, 44, 1000]);
  });

  /** A device group only stays usable inside while it keeps its host number. */
  it('keeps the device groups at the same id on both sides', () => {
    expect(toOutside(map, 29)).toBe(29);
    expect(toOutside(map, 44)).toBe(44);
    // While everything around them is shifted into the delegated range.
    expect(toOutside(map, 28)).toBe(1000028);
    expect(toOutside(map, 45)).toBe(1000045);
  });
});

describe('describeGroupId', () => {
  it('names the ids a reader would otherwise have to look up', () => {
    expect(describeGroupId(0)).toContain('root');
    expect(describeGroupId(29)).toContain('audio');
    expect(describeGroupId(44)).toContain('video');
    expect(describeGroupId(OVERFLOW_GID)).toContain('nogroup');
    expect(describeGroupId(INVALID_GID)).toContain('(gid_t)-1');
  });

  /** Device numbers are a distribution's, not the kernel's, and say so. */
  it('does not pass off a distribution’s numbering as the kernel’s', () => {
    expect(describeGroupId(29)).toContain('Debian and Ubuntu');
    expect(describeGroupId(SUBGID_BASE)).toContain('by convention rather than by any kernel rule');
  });

  it('falls back to what kind of group an id is', () => {
    expect(describeGroupId(3)).toBe('a system group');
    expect(describeGroupId(1000)).toContain('own group');
  });
});

describe('describeGroupExtent', () => {
  it('reads a shifted range as the groups on each side', () => {
    const map = parseGidMap(fixture('rootless', 'self'));

    expect(describeGroupExtent(map.extents[0]!)).toBe('Group 0 inside is group 1000 outside');
    expect(describeGroupExtent(map.extents[1]!)).toContain('/etc/subgid');
  });

  /** The reason to punch a hole in a gid_map is usually a device group. */
  it('names a group held the same on both sides', () => {
    const map = parseGidMap(fixture('shared-groups', 'self'));
    const audio = map.extents.find((extent) => extent.inside === 29)!;

    expect(describeGroupExtent(audio)).toContain('itself on both sides');
    expect(describeGroupExtent(audio)).toContain('audio');
  });
});
