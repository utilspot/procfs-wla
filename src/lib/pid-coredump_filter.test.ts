import { describe, expect, it } from 'vitest';
import { readPidCoredumpFilterFixture as fixture } from '../test/fixtures';
import {
  againstDefault,
  beyondDefault,
  BITS,
  DEFAULT_MASK,
  FILTER_BITS,
  FILTER_MASK,
  filterMask,
  formatMask,
  headersRedundant,
  isDefault,
  isEmpty,
  isEverything,
  isNothing,
  isUnreadable,
  missingFromDefault,
  parseCoredumpFilter,
  roundTrip,
  setBits,
  SHIFT,
  unsymbolisable,
  WIDTH,
} from './pid-coredump_filter';

describe('parseCoredumpFilter — the filter a process is born with', () => {
  const filter = parseCoredumpFilter(fixture('default'));

  /** `33` is bits 0, 1, 4 and 5, not a number worth thirty-three of anything. */
  it('reads the digits as the nine bits they are', () => {
    expect(filter.mask).toBe(0x33);
    expect(filter.bits).toHaveLength(FILTER_BITS);
    expect(setBits(filter).map((bit) => bit.bit)).toEqual([0, 1, 4, 5]);
    expect(filter.bits[2]!.set).toBe(false);
  });

  it('is the kernel default, and knows it', () => {
    expect(DEFAULT_MASK).toBe(0x33);
    expect(isDefault(filter)).toBe(true);
    expect(againstDefault(filter)).toBe('default');
    expect(missingFromDefault(filter)).toEqual([]);
    expect(beyondDefault(filter)).toEqual([]);
  });

  it('sees the shape %08lx writes, and the newline after it', () => {
    expect(filter.value).toBe('00000033');
    expect(filter.printed).toBe(true);
    expect(filter.terminated).toBe(true);
    expect(filter.bytes).toBe(WIDTH + 1);
    expect(isEmpty(filter)).toBe(false);
    expect(isUnreadable(filter)).toBe(false);
  });

  /**
   * The headers bit without the mapped-files bit is the whole point of the
   * default: a debugger can name every library without the core carrying one.
   */
  it('takes the ELF headers instead of the mapped files, not as well', () => {
    expect(filter.bits[4]!.set).toBe(true);
    expect(headersRedundant(filter)).toBe(false);
    expect(unsymbolisable(filter)).toBe(false);
  });
});

describe('parseCoredumpFilter — every bit the file has', () => {
  const filter = parseCoredumpFilter(fixture('everything'));

  it('reads 0x1ff as all nine', () => {
    expect(filter.mask).toBe(FILTER_MASK);
    expect(setBits(filter)).toHaveLength(FILTER_BITS);
    expect(isEverything(filter)).toBe(true);
    expect(filter.unknown).toEqual([]);
  });

  it('is the default with the other five on top of it', () => {
    expect(againstDefault(filter)).toBe('wider');
    expect(beyondDefault(filter).map((bit) => bit.bit)).toEqual([2, 3, 6, 7, 8]);
    // Bit 2 dumps the mappings whole, so bit 4 above it decides nothing.
    expect(headersRedundant(filter)).toBe(true);
  });
});

describe('parseCoredumpFilter — a filter narrowed to nothing', () => {
  const filter = parseCoredumpFilter(fixture('nothing', '12282'));

  it('reads all zeroes as a filter rather than as an empty file', () => {
    expect(isEmpty(filter)).toBe(false);
    expect(filter.readable).toBe(true);
    expect(filter.mask).toBe(0);
    expect(setBits(filter)).toEqual([]);
    expect(isNothing(filter)).toBe(true);
  });

  it('is the default with everything taken out of it', () => {
    expect(againstDefault(filter)).toBe('narrower');
    expect(missingFromDefault(filter).map((bit) => bit.bit)).toEqual([0, 1, 4, 5]);
    // No mapped files and no headers: nothing to read a backtrace against.
    expect(unsymbolisable(filter)).toBe(true);
  });
});

describe('parseCoredumpFilter — the mapped files dumped whole', () => {
  const filter = parseCoredumpFilter(fixture('mapped-too'));

  it('reads the default with bit 2 added', () => {
    expect(filter.mask).toBe(0x37);
    expect(setBits(filter).map((bit) => bit.bit)).toEqual([0, 1, 2, 4, 5]);
    expect(againstDefault(filter)).toBe('wider');
    expect(beyondDefault(filter).map((bit) => bit.bit)).toEqual([2]);
  });

  it('says the header bit is doing no work behind it', () => {
    expect(headersRedundant(filter)).toBe(true);
    expect(unsymbolisable(filter)).toBe(false);
  });
});

/** No `mm`, so `get_task_mm` fails and the read prints nothing at all. */
describe('parseCoredumpFilter — nothing to print from', () => {
  const filter = parseCoredumpFilter(fixture('kernel-thread', '1234'));

  it('reads an empty file as empty rather than as zero', () => {
    expect(isEmpty(filter)).toBe(true);
    expect(filter.readable).toBe(false);
    expect(isNothing(filter)).toBe(false);
    expect(isUnreadable(filter)).toBe(false);
    expect(filter.bytes).toBe(0);
    expect(setBits(filter)).toEqual([]);
  });
});

describe('parseCoredumpFilter — a filter that is neither more nor less', () => {
  /** Anonymous shared out, the mapped files in: a different core, not a wider one. */
  const filter = parseCoredumpFilter('00000035\n');

  it('is the default rearranged rather than narrowed or widened', () => {
    expect(againstDefault(filter)).toBe('different');
    expect(missingFromDefault(filter).map((bit) => bit.bit)).toEqual([1]);
    expect(beyondDefault(filter).map((bit) => bit.bit)).toEqual([2]);
  });
});

describe('parseCoredumpFilter — what this file cannot hold', () => {
  it('reads nothing out of an empty file', () => {
    expect(parseCoredumpFilter('')).toMatchObject({ mask: 0, readable: false, bytes: 0 });
  });

  it('refuses a value that is not hex digits', () => {
    const filter = parseCoredumpFilter('all\n');

    expect(isUnreadable(filter)).toBe(true);
    expect(filter.readable).toBe(false);
    expect(setBits(filter)).toEqual([]);
  });

  /** `%08lx` is eight lowercase digits; anything else was reformatted. */
  it('reads a value that is not printed the kernel way, and says so', () => {
    expect(parseCoredumpFilter('33\n').printed).toBe(false);
    expect(parseCoredumpFilter('00000033').terminated).toBe(false);
    expect(parseCoredumpFilter('0x33\n').readable).toBe(false);
    // Still eight digits, still readable, just not the case the kernel uses.
    expect(parseCoredumpFilter('000001FF\n')).toMatchObject({ readable: true, printed: false });
    expect(filterMask(parseCoredumpFilter('000001FF\n'))).toBe(FILTER_MASK);
  });

  /**
   * A write walks nine bits and drops the rest, so a wider value never came
   * through the interface that writes this file.
   */
  it('names the bits above the nine, which no write can set', () => {
    const filter = parseCoredumpFilter('ffffffff\n');

    expect(filter.unknown[0]).toBe(FILTER_BITS);
    expect(filter.unknown).toHaveLength(32 - FILTER_BITS);
    expect(filterMask(filter)).toBe(FILTER_MASK);
    expect(setBits(filter)).toHaveLength(FILTER_BITS);
  });
});

describe('BITS', () => {
  it('is the nine the kernel has, in file order', () => {
    expect(BITS).toHaveLength(FILTER_BITS);
    expect(BITS.map((bit) => bit.bit)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(BITS.map((bit) => bit.mask)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256]);
  });

  /** The default is exactly the bits the table marks as standard. */
  it('marks the four MMF_DUMP_FILTER_DEFAULT sets', () => {
    const standard = BITS.filter((bit) => bit.standard);

    expect(standard.map((bit) => bit.bit)).toEqual([0, 1, 4, 5]);
    expect(standard.reduce((mask, bit) => mask | bit.mask, 0)).toBe(DEFAULT_MASK);
  });

  /** Bit 0 is `mm->flags` bit 2, which is what the shift in the read is for. */
  it('names each bit as the kernel does, two above its place here', () => {
    expect(SHIFT).toBe(2);
    expect(BITS[0]!.flag).toBe('MMF_DUMP_ANON_PRIVATE');
    expect(BITS[4]!.flag).toBe('MMF_DUMP_ELF_HEADERS');
    expect(BITS[8]!.flag).toBe('MMF_DUMP_DAX_SHARED');
  });
});

describe('formatMask', () => {
  it('writes a value the way %08lx does', () => {
    expect(formatMask(0)).toBe('00000000');
    expect(formatMask(DEFAULT_MASK)).toBe('00000033');
    expect(formatMask(FILTER_MASK)).toBe('000001ff');
  });
});

/**
 * The read prints hex with no `0x`; the write is parsed base 0, where a leading
 * zero means octal. So the file's own output is not something it takes back.
 */
describe('roundTrip', () => {
  it('reads the default back as octal, which is a different filter', () => {
    const back = roundTrip(parseCoredumpFilter(fixture('default')))!;

    expect(back).toMatchObject({ text: '00000033', base: 8, same: false });
    // Octal 33 is 27, which is 0x1b — the mapped files in, the huge pages out.
    expect(back.mask).toBe(0x1b);
    expect(formatMask(back.mask!)).toBe('0000001b');
  });

  /** `f` is not an octal digit, so `kstrtouint` stops rather than truncating. */
  it('has the write refused where the digits are not octal', () => {
    const back = roundTrip(parseCoredumpFilter(fixture('everything')))!;

    expect(back).toMatchObject({ base: 8, mask: null, same: false });
  });

  it('is harmless for the one value octal and hex agree on', () => {
    const back = roundTrip(parseCoredumpFilter(fixture('nothing', '12282')))!;

    expect(back).toMatchObject({ base: 8, mask: 0, same: true });
  });

  it('reads a value with no leading zero as decimal, and 0x as hex', () => {
    expect(roundTrip(parseCoredumpFilter('33\n'))).toMatchObject({ base: 10, mask: 33, same: false });
    expect(roundTrip(parseCoredumpFilter('0x33\n'))).toBeNull();
  });

  /** A write sets nine bits and drops the rest, so what lands is never wider. */
  it('drops what a write could not have set', () => {
    expect(roundTrip(parseCoredumpFilter('07777777\n'))!.mask).toBe(FILTER_MASK);
  });

  it('has nothing to say about a file with no number in it', () => {
    expect(roundTrip(parseCoredumpFilter(''))).toBeNull();
    expect(roundTrip(parseCoredumpFilter('all\n'))).toBeNull();
  });
});
