import { describe, expect, it } from 'vitest';
import { readPidIoFixture as fixture } from '../test/fixtures';
import {
  averageRead,
  averageWrite,
  blockTotal,
  cancelledShare,
  charTotal,
  FIELDS,
  formatBytes,
  formatCount,
  formatShare,
  hasCancelled,
  inLayer,
  isEmpty,
  isIdle,
  isUnaligned,
  overCancelled,
  overRead,
  PAGE_SIZE,
  parsePidIo,
  reallyWritten,
  SECTOR_SIZE,
  summarize,
  withoutDisk,
} from './pid-io';

describe('parsePidIo — a quarter of a gigabyte read with no disk in it', () => {
  const io = parsePidIo(fixture('cache-warm'));

  it('reads the seven counters in the order the kernel prints them', () => {
    expect(io.counters.map((counter) => counter.name)).toEqual([
      'rchar',
      'wchar',
      'syscr',
      'syscw',
      'read_bytes',
      'write_bytes',
      'cancelled_write_bytes',
    ]);
    expect(io.ordered).toBe(true);
    expect(io.missing).toEqual([]);
    expect(io.unknown).toEqual([]);
    expect(io.malformed).toEqual([]);
  });

  /** The whole of reading this file: the two pairs are two measurements. */
  it('keeps what the program asked for apart from what a disk was asked for', () => {
    expect(io.counts.rchar).toBe(271534592);
    expect(io.counts.read_bytes).toBe(0);
    expect(charTotal(io)).toBe(271534592 + 48211);
    expect(blockTotal(io)).toBe(0);
  });

  it('reads a quarter of a gigabyte served without a disk', () => {
    expect(withoutDisk(io)).toBe(271534592);
    expect(overRead(io)).toBe(false);
    expect(isIdle(io)).toBe(false);
  });

  /** Everything it wrote went down a pipe, which the block layer never sees. */
  it('has bytes through write() with nothing promised to storage', () => {
    expect(io.counts.wchar).toBe(48211);
    expect(io.counts.write_bytes).toBe(0);
    expect(reallyWritten(io)).toBe(0);
    expect(cancelledShare(io)).toBeNull();
  });

  it('works out the average size of a call', () => {
    expect(Math.round(averageRead(io)!)).toBe(32648);
    expect(Math.round(averageWrite(io)!)).toBe(66);
  });
});

describe('parsePidIo — a database writer', () => {
  const io = parsePidIo(fixture('write-heavy'));

  it('reads 8 KiB a call, every page of it promised to storage', () => {
    expect(averageWrite(io)).toBe(8192);
    expect(io.counts.write_bytes).toBe(io.counts.wchar);
    expect(hasCancelled(io)).toBe(false);
    expect(reallyWritten(io)).toBe(3221225472);
  });

  it('has some reads served by the cache and some fetched', () => {
    expect(withoutDisk(io)).toBe(4194304);
    expect(io.counts.read_bytes).toBeGreaterThan(0);
    expect(overRead(io)).toBe(false);
  });
});

/**
 * `write_bytes` is charged when a page is dirtied, not when it is written — so
 * a promise can be withdrawn, and the file leaves the subtraction to you.
 */
describe('parsePidIo — a build working through scratch files', () => {
  const io = parsePidIo(fixture('scratch-files'));

  it('reads the promised writes and the withdrawn ones apart', () => {
    expect(io.counts.write_bytes).toBe(1073741824);
    expect(io.counts.cancelled_write_bytes).toBe(838860800);
    expect(hasCancelled(io)).toBe(true);
    expect(overCancelled(io)).toBe(false);
  });

  it('does the subtraction the file does not', () => {
    expect(reallyWritten(io)).toBe(1073741824 - 838860800);
    expect(formatBytes(reallyWritten(io))).toBe('224 MiB');
    expect(formatShare(cancelledShare(io)!)).toBe('78%');
  });
});

/** Readahead fetches what the program never asked for, which inverts the pair. */
describe('parsePidIo — a little of a lot of files', () => {
  const io = parsePidIo(fixture('readahead', '4242'));

  it('reads more fetched than asked for as a state rather than an error', () => {
    expect(overRead(io)).toBe(true);
    expect(io.counts.read_bytes).toBeGreaterThan(io.counts.rchar);
  });

  /** The one case where this figure is honestly negative. */
  it('gives a negative figure for what was read without a disk', () => {
    expect(withoutDisk(io)).toBe(4194304 - 134217728);
    expect(formatBytes(withoutDisk(io))).toBe('-124 MiB');
  });

  it('has no writes at all, so the write average is nothing rather than zero', () => {
    expect(averageWrite(io)).toBeNull();
    expect(averageRead(io)).toBe(4096);
  });
});

/** Seven zeroes is an answer: a process that has made no read() and no write(). */
describe('parsePidIo — a process that has done nothing', () => {
  const io = parsePidIo(fixture('idle'));

  it('reads all zeroes as idle rather than as an empty file', () => {
    expect(isIdle(io)).toBe(true);
    expect(isEmpty(io)).toBe(false);
    expect(io.counters).toHaveLength(7);
    expect(summarize(io)).toMatchObject({ asked: 0, storage: 0, written: 0, calls: 0 });
  });

  it('has no average to give for a call never made', () => {
    expect(averageRead(io)).toBeNull();
    expect(averageWrite(io)).toBeNull();
  });
});

describe('FIELDS', () => {
  it('is the seven the kernel prints, grouped by the layer that measures them', () => {
    expect(FIELDS).toHaveLength(7);
    expect(FIELDS.filter((field) => field.layer === 'syscall').map((field) => field.name)).toEqual([
      'rchar',
      'wchar',
      'syscr',
      'syscw',
    ]);
    expect(FIELDS.filter((field) => field.layer === 'block').map((field) => field.name)).toEqual([
      'read_bytes',
      'write_bytes',
      'cancelled_write_bytes',
    ]);
  });

  /** The two that are not sizes, which is what makes them easy to misread. */
  it('marks the two counters that are calls rather than bytes', () => {
    expect(FIELDS.filter((field) => field.calls === true).map((field) => field.name)).toEqual([
      'syscr',
      'syscw',
    ]);
  });

  it('splits a parsed file into the two measurements', () => {
    const io = parsePidIo(fixture('write-heavy'));

    expect(inLayer(io, 'syscall')).toHaveLength(4);
    expect(inLayer(io, 'block')).toHaveLength(3);
  });
});

describe('parsePidIo — what is not this file', () => {
  it('reads an empty file as empty rather than as seven zeroes', () => {
    const io = parsePidIo('');

    expect(isEmpty(io)).toBe(true);
    expect(isIdle(io)).toBe(true);
    expect(io.missing).toHaveLength(7);
    expect(io.bytes).toBe(0);
  });

  it('keeps a line that is not name and number aside', () => {
    const io = parsePidIo('rchar: 100\nthis is not a counter\n');

    expect(io.malformed).toEqual(['this is not a counter']);
    expect(io.counts.rchar).toBe(100);
  });

  /** A newer kernel may add to `task_io_accounting`; nothing here should break. */
  it('names a counter it does not know rather than dropping it', () => {
    const io = parsePidIo('rchar: 100\nsome_new_counter: 7\n');

    expect(io.unknown).toEqual(['some_new_counter']);
    expect(io.counters).toHaveLength(2);
    expect(io.counters[1]!.field).toBeNull();
  });

  it('names the counters a file did not carry, and counts them as zero', () => {
    const io = parsePidIo('rchar: 100\nwchar: 200\n');

    expect(io.missing).toEqual(['syscr', 'syscw', 'read_bytes', 'write_bytes', 'cancelled_write_bytes']);
    expect(io.counts.read_bytes).toBe(0);
  });

  /** The kernel writes one seq_printf after another, so the order is fixed. */
  it('notices counters that are not in the kernel’s order', () => {
    expect(parsePidIo('wchar: 200\nrchar: 100\n').ordered).toBe(false);
    expect(parsePidIo('rchar: 100\nwchar: 200\n').ordered).toBe(true);
  });

  it('notices a block counter that is not the round number its layer makes it', () => {
    expect(isUnaligned(parsePidIo(fixture('write-heavy')))).toBe(false);
    // A bio comes in whole sectors and a dirtied page in whole pages.
    expect(isUnaligned(parsePidIo(`read_bytes: ${SECTOR_SIZE + 1}\n`))).toBe(true);
    expect(isUnaligned(parsePidIo(`write_bytes: ${PAGE_SIZE + 512}\n`))).toBe(true);
  });

  it('reads more withdrawn than promised as something a kernel would not say', () => {
    expect(overCancelled(parsePidIo('write_bytes: 4096\ncancelled_write_bytes: 8192\n'))).toBe(true);
    // And never lets the real figure go below nothing.
    expect(reallyWritten(parsePidIo('write_bytes: 4096\ncancelled_write_bytes: 8192\n'))).toBe(0);
  });
});

describe('formatBytes', () => {
  it('shows a counter in binary units, negatives included', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(4096)).toBe('4.0 KiB');
    expect(formatBytes(3221225472)).toBe('3.0 GiB');
    expect(formatBytes(-134217728)).toBe('-128 MiB');
  });

  it('counts calls and shares in the units those are in', () => {
    expect(formatCount(632687)).toBe('632,687');
    expect(formatShare(0.781)).toBe('78%');
  });
});
