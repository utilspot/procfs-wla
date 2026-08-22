import { describe, expect, it } from 'vitest';
import { readSgAllowDioFixture as fixture } from '../test/fixtures';
import {
  DEFAULT,
  INFO_MASK,
  INFO_VALUES,
  isAllowed,
  isDefault,
  isUnexpected,
  MODULE_PARAM,
  parseAllowDio,
  REQUEST_FLAG,
  summarize,
} from './scsi-sg-allow-dio';

describe('parseAllowDio — the default', () => {
  const dio = parseAllowDio(fixture('off'))!;

  it('reads the one number the file holds', () => {
    expect(dio).toMatchObject({ value: 0, raw: '0' });
    expect(isAllowed(dio)).toBe(false);
    expect(isDefault(dio)).toBe(true);
    expect(DEFAULT).toBe(0);
  });

  /** Nothing fails: the request is copied instead, and is not told. */
  it('says what a request asking for direct I/O actually gets', () => {
    expect(summarize(dio)).toMatchObject({
      allowed: false,
      isDefault: true,
      unexpected: false,
    });
    expect(summarize(dio).outcome).toContain('copied through the reserved buffer');
    expect(summarize(dio).outcome).toContain('is not told');
  });
});

describe('parseAllowDio — permitted', () => {
  const dio = parseAllowDio(fixture('on'))!;

  /** Still only half of it: the request has to ask as well. */
  it('reads 1 as permission rather than as a transfer', () => {
    expect(isAllowed(dio)).toBe(true);
    expect(isDefault(dio)).toBe(false);
    expect(summarize(dio).outcome).toContain('can get it');
  });

  it('names the flag a request has to set and where the answer comes back', () => {
    expect(REQUEST_FLAG).toBe('SG_FLAG_DIRECT_IO');
    expect(INFO_MASK).toBe('SG_INFO_DIRECT_IO_MASK');
    expect(MODULE_PARAM).toBe('sg.allow_dio=');
  });
});

describe('INFO_VALUES', () => {
  /** The three answers the mask can hold, with the header's own numbers. */
  it('carries what the info field can say afterwards', () => {
    expect(INFO_VALUES.map((info) => [info.value, info.name])).toEqual([
      [0x0, 'SG_INFO_INDIRECT_IO'],
      [0x2, 'SG_INFO_DIRECT_IO'],
      [0x4, 'SG_INFO_MIXED_IO'],
    ]);
  });

  /** Which is the same bit the debug file reads to print `dio>>`. */
  it('says what each of them means', () => {
    expect(INFO_VALUES[1]!.what).toContain('asked for and done');
    expect(INFO_VALUES[2]!.what).toContain('part');
  });
});

describe('parseAllowDio — a value the write path could not store', () => {
  const dio = parseAllowDio(fixture('unexpected'))!;

  /** Anything not zero is normalised to 1, so a 2 came from somewhere else. */
  it('reads it as permission, and as a number this file could not have been written', () => {
    expect(dio.value).toBe(2);
    expect(isAllowed(dio)).toBe(true);
    expect(isUnexpected(dio)).toBe(true);
    expect(summarize(dio)).toMatchObject({ allowed: true, unexpected: true });
  });

  it('reads 0 and 1 as the values it can hold', () => {
    expect(isUnexpected(parseAllowDio('0\n')!)).toBe(false);
    expect(isUnexpected(parseAllowDio('1\n')!)).toBe(false);
  });
});

describe('parseAllowDio — files that are not one number', () => {
  it('reads anything else as no value at all', () => {
    expect(parseAllowDio(fixture('odd'))).toBeNull();
    expect(parseAllowDio('')).toBeNull();
    expect(parseAllowDio('0\n1\n')).toBeNull();
    expect(parseAllowDio('-1\n')).toBeNull();
  });

  it('reads the number whatever whitespace it came with', () => {
    expect(parseAllowDio('1')?.value).toBe(1);
    expect(parseAllowDio('  1  \n')?.value).toBe(1);
  });
});
