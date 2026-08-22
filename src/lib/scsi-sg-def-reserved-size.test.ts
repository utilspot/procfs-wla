import { describe, expect, it } from 'vitest';
import { readSgDefReservedSizeFixture as fixture } from '../test/fixtures';
import {
  DEFAULT,
  DEFAULT_SPELLING,
  formatBytes,
  GET_IOCTL,
  isAboveWritableCeiling,
  isDefault,
  isZero,
  MAX_WRITABLE,
  pagesOf,
  parseDefReservedSize,
  SET_IOCTL,
  summarize,
  timesDefault,
} from './scsi-sg-def-reserved-size';

describe('parseDefReservedSize — the compiled default', () => {
  const size = parseDefReservedSize(fixture('default'))!;

  it('reads the one number the file holds', () => {
    expect(size.bytes).toBe(32768);
    expect(size.raw).toBe('32768');
  });

  /** `SG_DEF_RESERVED_SIZE` is `SG_SCATTER_SZ` is `8 * 4096`. */
  it('is the size the driver starts with', () => {
    expect(isDefault(size)).toBe(true);
    expect(DEFAULT).toBe(32768);
    expect(DEFAULT_SPELLING).toBe('8 * 4096');
    expect(pagesOf(size.bytes)).toBe(8);
  });

  it('summarizes it as the untouched default it is', () => {
    expect(summarize(size)).toMatchObject({
      bytes: 32768,
      readable: '32 KiB',
      isDefault: true,
      isZero: false,
      aboveCeiling: false,
      timesDefault: 1,
      pages: 8,
    });
  });

  it('names the ioctls that move one descriptor rather than the default', () => {
    expect(SET_IOCTL).toBe('SG_SET_RESERVED_SIZE');
    expect(GET_IOCTL).toBe('SG_GET_RESERVED_SIZE');
  });
});

describe('parseDefReservedSize — a machine that raised it', () => {
  const size = parseDefReservedSize(fixture('raised'))!;

  it('reads it against the default it was moved from', () => {
    expect(size.bytes).toBe(524288);
    expect(isDefault(size)).toBe(false);
    expect(timesDefault(size)).toBe(16);
    expect(summarize(size).readable).toBe('512 KiB');
  });

  /** Still inside the megabyte the write path takes. */
  it('is a value this file could have been written', () => {
    expect(isAboveWritableCeiling(size)).toBe(false);
    expect(size.bytes).toBeLessThanOrEqual(MAX_WRITABLE);
  });
});

describe('parseDefReservedSize — no reserve at all', () => {
  const size = parseDefReservedSize(fixture('zero'))!;

  /** Allowed: the memory is then found when a command is made, not at open. */
  it('reads zero as a size rather than as a missing value', () => {
    expect(size.bytes).toBe(0);
    expect(isZero(size)).toBe(true);
    expect(summarize(size)).toMatchObject({ readable: '0', timesDefault: 0, pages: 0 });
  });
});

describe('parseDefReservedSize — larger than the write path takes', () => {
  const size = parseDefReservedSize(fixture('ceiling'))!;

  /**
   * The megabyte is a limit on the write, not on the value: the module
   * parameter is not clamped, so a larger number is possible and simply did not
   * come from here.
   */
  it('reads a value this file could not have been written', () => {
    expect(size.bytes).toBe(4194304);
    expect(isAboveWritableCeiling(size)).toBe(true);
    expect(MAX_WRITABLE).toBe(1048576);
    expect(summarize(size)).toMatchObject({ readable: '4 MiB', aboveCeiling: true });
  });
});

describe('formatBytes', () => {
  it('gives the units these sizes are thought in', () => {
    expect(formatBytes(32768)).toBe('32 KiB');
    expect(formatBytes(1048576)).toBe('1 MiB');
    expect(formatBytes(0)).toBe('0');
  });

  /** A size that is not a whole number of KiB is left in bytes rather than rounded. */
  it('leaves an odd size as the bytes it is', () => {
    expect(formatBytes(4095)).toBe('4095 B');
    expect(summarize({ bytes: 4095, raw: '4095' }).pages).toBeNull();
  });
});

describe('parseDefReservedSize — files that are not one number', () => {
  it('reads anything but a number as no value at all', () => {
    expect(parseDefReservedSize(fixture('odd'))).toBeNull();
    expect(parseDefReservedSize('32768 65536\n')).toBeNull();
    expect(parseDefReservedSize('-1\n')).toBeNull();
  });

  it('reads an empty file as no value, and a second line as too many', () => {
    expect(parseDefReservedSize('')).toBeNull();
    expect(parseDefReservedSize('32768\n65536\n')).toBeNull();
  });

  /** The trailing newline is the file's, and whitespace around it is harmless. */
  it('reads the number whatever whitespace it came with', () => {
    expect(parseDefReservedSize('32768')?.bytes).toBe(32768);
    expect(parseDefReservedSize('  32768  \n')?.bytes).toBe(32768);
  });
});
