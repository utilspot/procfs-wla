import { describe, expect, it } from 'vitest';
import { readScsiDeviceInfoFixture as fixture } from '../test/fixtures';
import {
  fillsField,
  flagAt,
  FLAGS,
  flagsOf,
  flagsUsed,
  formatFlags,
  hasNoVendor,
  isLunZeroOnly,
  isUnusedBit,
  maskOf,
  matchesAnyModel,
  MODEL_WIDTH,
  parseDeviceInfo,
  summarize,
  unnamedBits,
  UNUSED_BITS,
  vendorsOf,
  writeSpellingOf,
} from './scsi-device-info';

describe('parseDeviceInfo — the compiled-in list', () => {
  const list = parseDeviceInfo(fixture('stock'));

  it('reads a line as the three fields the printer quotes', () => {
    expect(list.entries).toHaveLength(182);
    expect(list.entries[0]).toMatchObject({
      vendor: 'Aashima',
      model: 'IMAGERY 2400SP',
      flags: 1n,
    });
    expect(list.unread).toEqual([]);
  });

  /** The quotes are the file's, so what is inside them is the field itself. */
  it('keeps the spaces inside the quotes, which belong to the model', () => {
    const iomega = list.entries.find((entry) => entry.model.startsWith('Io20S'))!;

    expect(iomega.model).toBe('Io20S         *');
    expect(iomega.raw).toContain("'Io20S         *'");
  });

  /** Bit 34 is in use, so a 32-bit mask would drop the flag and keep the rest. */
  it('reads a mask that does not fit in 32 bits', () => {
    const zip = list.entries.find((entry) => entry.model === 'ZIP')!;

    expect(zip.flags).toBe(0x400000021n);
    expect(flagsOf(zip).map((flag) => flag.name)).toEqual(['NOLUN', 'NOTQ', 'SKIP_IO_HINTS']);
    expect(formatFlags(zip.flags)).toBe('0x400000021');
  });

  /** The commonest flag by far, and the oldest thing in the file. */
  it('finds the flags the list actually uses, commonest first', () => {
    const used = flagsUsed(list);

    expect(used[0]!.flag.name).toBe('NOLUN');
    expect(used[0]!.count).toBeGreaterThan(50);
    expect(used.every((use) => use.count > 0)).toBe(true);
  });

  it('summarizes the list as the table of quirks it is', () => {
    const summary = summarize(list);

    expect(summary.entries).toBe(182);
    expect(summary.vendors.length).toBeGreaterThan(50);
    expect(summary.unnamed).toEqual([]);
    expect(summary.lunZeroOnly.length).toBe(50);
  });
});

describe('parseDeviceInfo — the entries worth reading', () => {
  const list = parseDeviceInfo(fixture('quirks'));
  const find = (model: string) => list.entries.find((entry) => entry.model === model)!;

  /** A RAID controller's configuration channel, which no upper-level driver takes. */
  it('names the flag behind a device with no /dev node of its own', () => {
    expect(flagsOf(find('PERCRAID')).map((flag) => flag.name)).toEqual(['NO_ULD_ATTACH']);
    expect(flagAt(20)).toMatchObject({ name: 'NO_ULD_ATTACH' });
  });

  /** Several bits at once, which is the ordinary case for an array. */
  it('reads every bit of a mask, in bit order', () => {
    expect(flagsOf(find('ARRAY CONTROLLE')).map((flag) => flag.bit)).toEqual([6, 9, 17, 23]);
  });

  /**
   * An empty model is a prefix of every model, so a compiled-in entry with one
   * covers the whole vendor.
   */
  it('reads an empty model as the whole vendor it matches', () => {
    const promise = list.entries.find((entry) => entry.vendor === 'Promise')!;

    expect(matchesAnyModel(promise)).toBe(true);
    expect(hasNoVendor(promise)).toBe(false);
  });

  /** And an empty vendor is a device that answered with none. */
  it('reads an empty vendor as a field, not as a missing one', () => {
    const scanner = find('Scanner');

    expect(hasNoVendor(scanner)).toBe(true);
    expect(matchesAnyModel(scanner)).toBe(false);
  });

  /** The model is the INQUIRY width, so a longer one would not have fitted. */
  it('reads a model against the field it has to fit', () => {
    expect(fillsField('ARRAY CONTROLLE', MODEL_WIDTH)).toBe(false);
    expect(fillsField('0123456789abcdef', MODEL_WIDTH)).toBe(true);
  });

  /** How the same entry goes back in, and what the boot parameter takes. */
  it('spells an entry the way it would be written back', () => {
    expect(writeSpellingOf(find('PERCRAID'))).toBe('DELL:PERCRAID:0x100000');
    expect(writeSpellingOf(find('ZIP'))).toBe('IOMEGA:ZIP:0x400000021');
  });

  it('tells the plain LUN-0 entries from the rest', () => {
    expect(isLunZeroOnly(find('Scanner'))).toBe(true);
    expect(isLunZeroOnly(find('ZIP'))).toBe(false);
    expect(summarize(list).lunZeroOnly).toHaveLength(1);
  });
});

describe('parseDeviceInfo — bits with no flag behind them', () => {
  const list = parseDeviceInfo(fixture('retired-bit'));

  /** The header declares five numbers and then uses none of them. */
  it('tells a retired bit from one above the last named', () => {
    expect(unnamedBits(list.entries[0]!)).toEqual([14]);
    expect(isUnusedBit(14)).toBe(true);

    expect(unnamedBits(list.entries[1]!)).toEqual([40]);
    expect(isUnusedBit(40)).toBe(false);
    expect(UNUSED_BITS).toEqual([14, 15, 16, 24, 27]);
  });

  /** A mask can carry both kinds beside a flag that does mean something. */
  it('keeps the named flags of a mask that also holds unnamed bits', () => {
    const both = list.entries[2]!;

    expect(flagsOf(both).map((flag) => flag.name)).toEqual(['NOLUN']);
    expect(unnamedBits(both)).toEqual([14, 40]);
    expect(summarize(list).unnamed).toHaveLength(3);
  });

  it('says nothing is unnamed where every bit has a flag', () => {
    expect(unnamedBits(list.entries[3]!)).toEqual([]);
  });
});

describe('parseDeviceInfo — a line that is not an entry', () => {
  const list = parseDeviceInfo(fixture('unread'));

  /** Kept rather than dropped: the file said it, whatever it is. */
  it('keeps what it could not read, and the entries around it', () => {
    expect(list.entries).toHaveLength(3);
    expect(list.unread).toEqual(['this line is not an entry']);
    expect(summarize(list).unread).toHaveLength(1);
  });

  it('reads an empty file as no entries rather than as an entry of nothing', () => {
    expect(parseDeviceInfo('')).toEqual({ entries: [], unread: [] });
    expect(parseDeviceInfo('\n\n')).toEqual({ entries: [], unread: [] });
  });
});

describe('the flag table', () => {
  /** Taken from include/scsi/scsi_devinfo.h, where the bit is the declaration. */
  it('names every bit the header declares, and nothing between them', () => {
    expect(FLAGS).toHaveLength(30);
    expect(FLAGS[0]).toMatchObject({ bit: 0, name: 'NOLUN' });
    expect(FLAGS[FLAGS.length - 1]).toMatchObject({ bit: 34, name: 'SKIP_IO_HINTS' });

    for (const bit of UNUSED_BITS) expect(flagAt(bit)).toBeNull();
  });

  it('keeps the bits in the order the header declares them', () => {
    const bits = FLAGS.map((flag) => flag.bit);
    expect([...bits].sort((a, b) => a - b)).toEqual(bits);
  });

  /** The mask is built with BigInt, since bit 34 is past what `1 << n` gives. */
  it('builds a mask that survives the top of the range', () => {
    expect(maskOf(0)).toBe(1n);
    expect(maskOf(34)).toBe(0x400000000n);
    expect(Number(maskOf(34))).toBe(2 ** 34);
  });

  it('lists the vendors in the order they first appear', () => {
    const list = parseDeviceInfo(fixture('quirks'));
    expect(vendorsOf(list).slice(0, 3)).toEqual(['', 'ADAPTEC', 'COMPAQ']);
  });
});
