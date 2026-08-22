import { describe, expect, it } from 'vitest';
import { readSgVersionFixture as fixture } from '../test/fixtures';
import {
  COMPONENT_DIGITS,
  decodeDate,
  decodeNumber,
  formatDate,
  IOCTL,
  numberAgrees,
  parseSgVersion,
  summarize,
  versionFromNumber,
} from './scsi-sg-version';

describe('parseSgVersion — what a current kernel prints', () => {
  const version = parseSgVersion(fixture('stock'))!;

  it('reads the three fields of the one line', () => {
    expect(version).toMatchObject({
      number: 30536,
      version: '3.5.36',
      date: '20140603',
    });
    expect(version.raw).toBe('30536\t3.5.36 [20140603]');
  });

  /** The number is the version packed two digits to a component. */
  it('reads the number as the version it holds', () => {
    expect(decodeNumber(version.number)).toEqual({ major: 3, minor: 5, patch: 36 });
    expect(versionFromNumber(version.number)).toBe('3.5.36');
    expect(COMPONENT_DIGITS).toBe(2);
  });

  /** Which is the same thing the string says, in every stock kernel. */
  it('finds the number and the string agreeing', () => {
    expect(numberAgrees(version)).toBe(true);
    expect(IOCTL).toBe('SG_GET_VERSION_NUM');
  });

  it('reads the date as the date it is', () => {
    expect(decodeDate(version.date)).toEqual({ year: 2014, month: 6, day: 3 });
    expect(formatDate(version.date)).toBe('3 June 2014');
  });

  it('summarizes the line as the one fact said twice', () => {
    expect(summarize(version)).toMatchObject({
      version: '3.5.36',
      number: 30536,
      decoded: '3.5.36',
      agrees: true,
      dated: '3 June 2014',
    });
  });
});

describe('parseSgVersion — an older driver', () => {
  const version = parseSgVersion(fixture('older'))!;

  it('reads a number whose components are not the current ones', () => {
    expect(version.number).toBe(30534);
    expect(versionFromNumber(version.number)).toBe('3.5.34');
    expect(numberAgrees(version)).toBe(true);
  });

  it('reads the driver date that goes with it', () => {
    expect(formatDate(version.date)).toBe('27 October 2006');
  });
});

describe('parseSgVersion — a build that disagrees with itself', () => {
  const version = parseSgVersion(fixture('mismatch'))!;

  /** The number is what SG_GET_VERSION_NUM hands a program, so it is the one to believe. */
  it('finds the number and the string saying different things', () => {
    expect(version).toMatchObject({ number: 30536, version: '3.5.37' });
    expect(versionFromNumber(version.number)).toBe('3.5.36');
    expect(numberAgrees(version)).toBe(false);
  });
});

describe('decodeNumber', () => {
  it('takes two digits per component, from the right', () => {
    expect(decodeNumber(30536)).toEqual({ major: 3, minor: 5, patch: 36 });
    expect(decodeNumber(30500)).toEqual({ major: 3, minor: 5, patch: 0 });
    expect(decodeNumber(120199)).toEqual({ major: 12, minor: 1, patch: 99 });
  });

  it('refuses what is not a whole number of them', () => {
    expect(decodeNumber(null)).toBeNull();
    expect(decodeNumber(-1)).toBeNull();
    expect(decodeNumber(3.5)).toBeNull();
  });
});

describe('decodeDate', () => {
  it('reads eight digits as a date', () => {
    expect(decodeDate('20140603')).toEqual({ year: 2014, month: 6, day: 3 });
    expect(formatDate('19991231')).toBe('31 December 1999');
  });

  /** A field that is not a date is left as the field it is. */
  it('refuses anything else, rather than reading a date into it', () => {
    expect(decodeDate('2014')).toBeNull();
    expect(decodeDate('20141301')).toBeNull();
    expect(decodeDate('2014-06-03')).toBeNull();
    expect(formatDate(null)).toBeNull();
  });
});

describe('parseSgVersion — a file that holds no version line', () => {
  it('reads a line of the wrong shape as none at all', () => {
    expect(parseSgVersion(fixture('odd'))).toBeNull();
  });

  it('reads an empty file as none at all', () => {
    expect(parseSgVersion('')).toBeNull();
    expect(parseSgVersion('\n\n')).toBeNull();
  });

  /** The date is the only optional field: a driver that printed none still has a version. */
  it('reads a line with no bracketed date', () => {
    const version = parseSgVersion('30536\t3.5.36\n')!;

    expect(version).toMatchObject({ number: 30536, version: '3.5.36', date: null });
    expect(formatDate(version.date)).toBeNull();
    expect(numberAgrees(version)).toBe(true);
  });
});
