import { describe, expect, it } from 'vitest';
import { readMeminfoFixture as fixture } from '../test/fixtures';
import {
  bytesOf,
  countOf,
  describeField,
  fieldOf,
  formatBytes,
  hugePages,
  isCount,
  parseMeminfo,
  shareOf,
  summarize,
  totals,
} from './meminfo';

describe('parseMeminfo — an ordinary desktop', () => {
  const info = parseMeminfo(fixture('desktop-16g'));

  it('reads a field, its value and its unit', () => {
    expect(info.fields[0]).toEqual({ name: 'MemTotal', value: 16316776, unit: 'kB' });
    expect(fieldOf(info, 'Shmem')).toEqual({ name: 'Shmem', value: 391424, unit: 'kB' });
    expect(fieldOf(info, 'NotAField')).toBeNull();
  });

  /**
   * The kernel writes kB and means KiB, so a size is 1024 times the number
   * printed rather than 1000.
   */
  it('reads kB as KiB', () => {
    expect(bytesOf(info, 'MemTotal')).toBe(16316776 * 1024);
    expect(formatBytes(bytesOf(info, 'MemTotal')!)).toBe('16 GiB');
  });

  /**
   * The HugePages_* fields carry no unit: they are counts of pages, and
   * reading one as kB would be wrong by whatever a huge page happens to be.
   */
  it('keeps a count a count', () => {
    const field = fieldOf(info, 'HugePages_Total')!;

    expect(field).toEqual({ name: 'HugePages_Total', value: 0, unit: null });
    expect(isCount(field)).toBe(true);
    expect(bytesOf(info, 'HugePages_Total')).toBeNull();
    expect(countOf(info, 'HugePages_Total')).toBe(0);
    // The size beside it is a size, and does convert.
    expect(bytesOf(info, 'Hugepagesize')).toBe(2048 * 1024);
    expect(countOf(info, 'Hugepagesize')).toBeNull();
  });

  // What free(1) calls used: everything that is neither free nor cache.
  it('works out what is used the way free does', () => {
    const memory = totals(info);

    expect(memory.buffersAndCache).toBe((519612 + 8862452 + 508220) * 1024);
    expect(memory.used).toBe(
      (16316776 - 298036 - (519612 + 8862452 + 508220)) * 1024,
    );
    expect(memory.free).toBe(298036 * 1024);
  });

  /**
   * MemAvailable is the kernel's own estimate, not a sum of the other fields —
   * so it is read rather than derived.
   */
  it('takes MemAvailable as the kernel gives it', () => {
    const memory = totals(info);

    expect(memory.available).toBe(9587380 * 1024);
    // Free plus cache would come out higher, which is the point of the field.
    expect(memory.available).toBeLessThan(memory.free! + memory.buffersAndCache!);
  });

  it('reads the swap in use', () => {
    const memory = totals(info);

    expect(memory.swapTotal).toBe(2097148 * 1024);
    expect(memory.swapUsed).toBe((2097148 - 1908472) * 1024);
    expect(summarize(info).swapShare).toBeCloseTo(188676 / 2097148);
  });

  it('reserves no huge pages', () => {
    expect(hugePages(info)).toBeNull();
    expect(summarize(info).hugePages).toBeNull();
  });
});

describe('parseMeminfo — a server with huge pages', () => {
  const info = parseMeminfo(fixture('server-256g'));

  /**
   * The count and the size are separate fields, and only multiplied together
   * do they mean an amount of memory.
   */
  it('multiplies the count by the page size', () => {
    const huge = hugePages(info)!;

    expect(huge.total).toBe(32768);
    expect(huge.free).toBe(4096);
    expect(huge.pageBytes).toBe(2048 * 1024);
    expect(huge.poolBytes).toBe(32768 * 2048 * 1024);
    expect(formatBytes(huge.poolBytes!)).toBe('64 GiB');
  });

  it('reads a machine with no swap configured', () => {
    const memory = totals(info);

    expect(memory.swapTotal).toBe(0);
    expect(memory.swapUsed).toBe(0);
    // A share of nothing is nothing to report, not zero percent.
    expect(summarize(info).swapShare).toBeNull();
  });

  // Committed_AS above CommitLimit is ordinary without strict overcommit.
  it('reads a commitment beyond the limit without complaint', () => {
    expect(bytesOf(info, 'Committed_AS')!).toBeGreaterThan(bytesOf(info, 'CommitLimit')!);
  });
});

describe('parseMeminfo — a VM under pressure', () => {
  const info = parseMeminfo(fixture('vm-swapping'));

  it('shows most of the swap in use', () => {
    expect(summarize(info).swapShare).toBeGreaterThan(0.7);
  });

  it('shows little memory available against the total', () => {
    const summary = summarize(info);

    expect(summary.availableShare).toBeLessThan(0.25);
    expect(summary.usedShare).toBeGreaterThan(0.5);
  });
});

describe('parseMeminfo — swap turned off', () => {
  const info = parseMeminfo(fixture('no-swap'));

  it('reads both swap figures as zero', () => {
    expect(totals(info)).toMatchObject({ swapTotal: 0, swapFree: 0, swapUsed: 0 });
    expect(summarize(info).swapShare).toBeNull();
  });
});

describe('parseMeminfo — a kernel from before MemAvailable', () => {
  const info = parseMeminfo(fixture('legacy-2.6'));

  /**
   * MemAvailable arrived in 3.14. Without it there is no estimate to show, and
   * inventing one from free plus cache would overstate it.
   */
  it('claims no available memory when the kernel gives none', () => {
    expect(fieldOf(info, 'MemAvailable')).toBeNull();
    expect(totals(info).available).toBeNull();
    expect(summarize(info).availableShare).toBeNull();
  });

  it('still works out what is used from what it does have', () => {
    const memory = totals(info);

    expect(memory.total).toBe(1034872 * 1024);
    // No SReclaimable on this kernel either, so cache is buffers plus cached.
    expect(memory.buffersAndCache).toBe((104880 + 420448) * 1024);
    expect(memory.used).toBeGreaterThan(0);
  });

  it('reads the high and low memory split a 32-bit kernel prints', () => {
    expect(bytesOf(info, 'HighTotal')).toBe(131008 * 1024);
    expect(describeField('LowTotal')).toMatch(/map directly/);
  });
});

describe('parseMeminfo — every fixture', () => {
  const names = ['desktop-16g', 'server-256g', 'vm-swapping', 'no-swap', 'legacy-2.6'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseMeminfo(fixture(name));
    const summary = summarize(info);
    const memory = summary.totals;

    expect(summary.fields).toBeGreaterThan(0);

    for (const field of info.fields) {
      expect(field.name).not.toBe('');
      expect(Number.isInteger(field.value)).toBe(true);
      expect(field.value).toBeGreaterThanOrEqual(0);
      // Every unit in this file is kB; anything else is a count.
      if (field.unit !== null) expect(field.unit).toBe('kB');
      // Only the huge page counts go without one.
      if (field.unit === null) expect(field.name).toMatch(/^HugePages_/);
    }

    // A field appears once.
    expect(new Set(info.fields.map((field) => field.name)).size).toBe(summary.fields);

    // Free, used and cache account for the whole of memory.
    expect(memory.used! + memory.free! + memory.buffersAndCache!).toBe(memory.total);
    expect(memory.swapFree).toBeLessThanOrEqual(memory.swapTotal!);
    if (memory.available !== null) {
      expect(memory.available).toBeLessThanOrEqual(memory.total!);
    }
  });
});

describe('parseMeminfo — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseMeminfo('').fields).toEqual([]);
    expect(totals(parseMeminfo(''))).toMatchObject({ total: null, used: null });
  });

  it('returns nothing for a file that is not /proc/meminfo', () => {
    expect(parseMeminfo('0.52 0.44 0.39 2/1234 5678\n').fields).toEqual([]);
  });

  it('reads a field name with parentheses in it', () => {
    const info = parseMeminfo('Active(anon):    4102244 kB\n');

    expect(info.fields[0]?.name).toBe('Active(anon)');
    expect(bytesOf(info, 'Active(anon)')).toBe(4102244 * 1024);
  });

  it('reads a field this page has no note for', () => {
    const info = parseMeminfo('SomethingNew:       1024 kB\n');

    expect(info.fields[0]?.value).toBe(1024);
    expect(describeField('SomethingNew')).toBeNull();
    // Unknown or not, it is still a size and still converts.
    expect(bytesOf(info, 'SomethingNew')).toBe(1024 * 1024);
  });

  it('skips a line with no value', () => {
    expect(parseMeminfo('MemTotal:\n').fields).toEqual([]);
  });

  it('claims nothing when the fields it needs are missing', () => {
    const info = parseMeminfo('MemFree:          298036 kB\n');

    expect(totals(info).used).toBeNull();
    expect(summarize(info).usedShare).toBeNull();
  });

  // Nothing can be a share of a total of nothing.
  it('claims no share against a zero total', () => {
    expect(shareOf(0, 0)).toBeNull();
    expect(shareOf(null, 100)).toBeNull();
    expect(shareOf(50, 100)).toBe(0.5);
  });

  it('never reports negative use', () => {
    // Cache larger than the total is nonsense, but it is not negative use.
    const info = parseMeminfo(
      'MemTotal:           1024 kB\nMemFree:             512 kB\nCached:             4096 kB\n',
    );

    expect(totals(info).used).toBe(0);
  });

  it('reserves no huge pages when the count is zero', () => {
    const info = parseMeminfo('HugePages_Total:       0\nHugepagesize:       2048 kB\n');

    expect(hugePages(info)).toBeNull();
  });

  it('formats sizes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(16316776 * 1024)).toBe('16 GiB');
    expect(formatBytes(263905436 * 1024)).toBe('252 GiB');
  });
});
