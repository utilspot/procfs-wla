import { describe, expect, it } from 'vitest';
import { readAutogroupFixture as fixture } from '../test/fixtures';
import {
  DEFAULT_WEIGHT,
  describeWeight,
  isDefaultGroup,
  isReniced,
  isUnreadable,
  MAX_NICE,
  MIN_NICE,
  parseAutogroup,
  sameGroup,
  timesDefault,
  weightFor,
  WEIGHTS,
} from './autogroup';

describe('parseAutogroup — an ordinary session', () => {
  const autogroup = parseAutogroup(fixture('desktop', 'self'));

  it('reads the group and its nice', () => {
    expect(autogroup.name).toBe('/autogroup-42');
    expect(autogroup.id).toBe(42);
    expect(autogroup.nice).toBe(0);
  });

  it('reads the newline the kernel writes after the line', () => {
    expect(autogroup.terminated).toBe(true);
    expect(autogroup.bytes).toBe(21);
  });

  it('is neither the default group nor unreadable', () => {
    expect(isDefaultGroup(autogroup)).toBe(false);
    expect(isUnreadable(autogroup)).toBe(false);
    expect(isReniced(autogroup)).toBe(false);
  });

  /** Different terminals, so different groups: they compete with each other. */
  it('tells one session from another', () => {
    const browser = parseAutogroup(fixture('desktop', '12282'));

    expect(browser.id).toBe(31);
    expect(sameGroup(autogroup, browser)).toBe(false);
  });
});

describe('parseAutogroup — the group belongs to the session', () => {
  /**
   * One `setsid()`, so one group: a shell and the command it started answer
   * identically, which is the comparison the id exists for.
   */
  it('reads the same group through two processes', () => {
    const shell = parseAutogroup(fixture('same-session', 'self'));
    const child = parseAutogroup(fixture('same-session', '5150'));

    expect(shell.id).toBe(57);
    expect(child.id).toBe(57);
    expect(sameGroup(shell, child)).toBe(true);
  });

  it('does not call two default groups the same group', () => {
    const init = parseAutogroup(fixture('kernel-threads', '1'));
    const kthread = parseAutogroup(fixture('kernel-threads', '74'));

    expect(isDefaultGroup(init)).toBe(true);
    expect(isDefaultGroup(kthread)).toBe(true);
    // Neither names a group, so there is nothing to match on.
    expect(sameGroup(init, kthread)).toBe(false);
  });
});

describe('parseAutogroup — the default group', () => {
  const init = parseAutogroup(fixture('desktop', '1'));

  /** Not a failure: the init task never called setsid() and never can. */
  it('reads an empty file as the default group', () => {
    expect(isDefaultGroup(init)).toBe(true);
    expect(isUnreadable(init)).toBe(false);
    expect(init.id).toBeNull();
    expect(init.nice).toBeNull();
    expect(init.bytes).toBe(0);
  });
});

describe('parseAutogroup — lines the fixtures do not hold', () => {
  it('reads a group that has been reniced up', () => {
    const autogroup = parseAutogroup(fixture('reniced', 'self'));

    expect(autogroup.nice).toBe(10);
    expect(isReniced(autogroup)).toBe(true);
  });

  it('reads a negative nice', () => {
    const autogroup = parseAutogroup(fixture('long-uptime', '12282'));

    expect(autogroup.id).toBe(284660);
    expect(autogroup.nice).toBe(-5);
    expect(isReniced(autogroup)).toBe(true);
  });

  it('reads a six-digit counter, which is a count of groups ever made', () => {
    expect(parseAutogroup(fixture('long-uptime', 'self')).id).toBe(284915);
  });

  it('notices a line the kernel would have ended with a newline', () => {
    expect(parseAutogroup('/autogroup-42 nice 0').terminated).toBe(false);
    expect(parseAutogroup('/autogroup-42 nice 0\n').terminated).toBe(true);
  });

  it('refuses anything that is not the line the kernel writes', () => {
    for (const text of ['/autogroup-42\n', 'autogroup-42 nice 0\n', '42 0\n', 'nice 0\n']) {
      const autogroup = parseAutogroup(text);
      expect(isUnreadable(autogroup)).toBe(true);
      expect(autogroup.id).toBeNull();
    }
  });

  it('tells an empty file from an unreadable one', () => {
    expect(isDefaultGroup(parseAutogroup('\n'))).toBe(true);
    expect(isUnreadable(parseAutogroup('\n'))).toBe(false);
  });
});

describe('the weight a nice level is', () => {
  it('is the kernel table, forty entries from MIN_NICE', () => {
    expect(WEIGHTS).toHaveLength(MAX_NICE - MIN_NICE + 1);
    expect(weightFor(0)).toBe(DEFAULT_WEIGHT);
    expect(weightFor(MIN_NICE)).toBe(88761);
    expect(weightFor(MAX_NICE)).toBe(15);
    expect(weightFor(10)).toBe(110);
    expect(weightFor(-5)).toBe(3121);
  });

  it('has nothing for a nice the kernel would refuse', () => {
    expect(weightFor(MIN_NICE - 1)).toBeNull();
    expect(weightFor(MAX_NICE + 1)).toBeNull();
    expect(describeWeight(20)).toBeNull();
  });

  /** Each step is about 1.25×, which is what makes a level worth roughly 10%. */
  it('reads a weight against a default group', () => {
    expect(timesDefault(0)).toBe(1);
    expect(timesDefault(10)).toBeCloseTo(0.107, 3);
    expect(timesDefault(-5)).toBeCloseTo(3.048, 3);
  });

  it('says what that ratio is worth', () => {
    expect(describeWeight(0)).toBe('the same as any other group');
    expect(describeWeight(10)).toBe('a ninth of a default group');
    expect(describeWeight(5)).toBe('a third of a default group');
    expect(describeWeight(-5)).toBe('3.0× a default group');
    expect(describeWeight(MIN_NICE)).toBe('87× a default group');
    // Past the point where English has a word for the fraction.
    expect(describeWeight(MAX_NICE)).toBe('1/68 of a default group');
  });
});
