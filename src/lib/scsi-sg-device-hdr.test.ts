import { describe, expect, it } from 'vitest';
import { readSgDeviceHdrFixture as fixture } from '../test/fixtures';
import { COLUMNS } from './scsi-sg-devices';
import {
  COLUMN_FACTS,
  compareToExpected,
  factFor,
  HEADER_LINE,
  isStockHeader,
  parseDeviceHdr,
} from './scsi-sg-device-hdr';

describe('parseDeviceHdr — what every kernel prints', () => {
  const header = parseDeviceHdr(fixture('stock'))!;

  it('reads the nine names of the one line', () => {
    expect(header.names).toEqual([
      'host',
      'chan',
      'id',
      'lun',
      'type',
      'opens',
      'qdepth',
      'busy',
      'online',
    ]);
    expect(header.extra).toEqual([]);
  });

  /** The file is a string literal, so there is one right answer to compare to. */
  it('is the line the driver holds as a literal', () => {
    expect(isStockHeader(header)).toBe(true);
    expect(header.raw).toBe(HEADER_LINE);
  });

  /** Which is the order the app reads /proc/scsi/sg/devices in. */
  it('agrees with the columns the devices file is parsed by', () => {
    expect(compareToExpected(header)).toEqual({
      agrees: true,
      unknown: [],
      missing: [],
      reordered: false,
    });
    expect(header.names).toEqual([...COLUMNS]);
  });
});

describe('COLUMN_FACTS', () => {
  /** The names here are the columns there, or the page explains the wrong file. */
  it('covers exactly the columns, in the order they are printed', () => {
    expect(COLUMN_FACTS.map((column) => column.name)).toEqual([...COLUMNS]);
  });

  it('says what each name holds', () => {
    expect(factFor('qdepth')?.what).toContain('in flight');
    expect(factFor('host')?.what).toContain('controller port');
    expect(factFor('nothing')).toBeNull();
  });

  /** The three names that are read wrongly are the reason for the caveats. */
  it('carries a caveat for the names that mislead, and none for the rest', () => {
    expect(factFor('opens')?.what).toContain('literal 1');
    expect(factFor('opens')?.caveat).toContain('whether or not');
    expect(factFor('busy')?.caveat).toContain('two reads');
    expect(factFor('online')?.caveat).toContain('-1');
    expect(factFor('host')?.caveat).toBeNull();
    expect(factFor('lun')?.caveat).toBeNull();
  });
});

describe('compareToExpected — a header that has moved', () => {
  /** A tenth column would mean the devices page is reading one it cannot name. */
  it('finds a name the app does not parse by', () => {
    const header = parseDeviceHdr(fixture('unknown-column'))!;
    const comparison = compareToExpected(header);

    expect(comparison).toMatchObject({ agrees: false, unknown: ['blocked'], missing: [] });
    expect(isStockHeader(header)).toBe(false);
  });

  /** And a renamed one, which is the same disagreement from the other side. */
  it('finds a name the app expects and this header has not', () => {
    const comparison = compareToExpected(parseDeviceHdr(fixture('renamed'))!);

    expect(comparison).toMatchObject({
      agrees: false,
      unknown: ['channel'],
      missing: ['chan'],
    });
  });

  /** Same names, different order: the numbers would be read into the wrong ones. */
  it('finds the shared names out of order', () => {
    const header = parseDeviceHdr('host\tchan\tid\tlun\ttype\topens\tbusy\tqdepth\tonline\n')!;
    const comparison = compareToExpected(header);

    expect(comparison).toMatchObject({ agrees: false, unknown: [], missing: [], reordered: true });
  });
});

describe('parseDeviceHdr — files that are not the header', () => {
  /** A line of the wrong shape is still words, so it parses and then disagrees. */
  it('reads a line that is not the header as the names it is not', () => {
    const header = parseDeviceHdr(fixture('odd'))!;

    expect(header.names).toEqual(['sg', 'device', 'header', 'unavailable']);
    expect(isStockHeader(header)).toBe(false);
    expect(compareToExpected(header).missing).toEqual([...COLUMNS]);
  });

  it('reads an empty file as no header at all', () => {
    expect(parseDeviceHdr('')).toBeNull();
    expect(parseDeviceHdr('\n\n')).toBeNull();
  });

  /** Nothing follows the header in any kernel, so anything that does is kept. */
  it('keeps whatever was printed after the header', () => {
    const header = parseDeviceHdr(`${HEADER_LINE}\nand something else\n`)!;

    expect(header.extra).toEqual(['and something else']);
    expect(isStockHeader(header)).toBe(false);
    expect(compareToExpected(header).agrees).toBe(true);
  });
});
