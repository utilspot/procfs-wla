import { describe, expect, it } from 'vitest';
import { readSwapsFixture as fixture } from '../test/fixtures';
import {
  describeArea,
  formatKib,
  formatShare,
  freeKib,
  HEADER_PAGE_KIB,
  isAutoPriority,
  isZram,
  parseSwaps,
  priorityGroups,
  summarize,
  unescapePath,
  usedShare,
} from './swaps';

describe('parseSwaps — one swap partition', () => {
  const swaps = parseSwaps(fixture('desktop'));

  it('reads the five fields of an area', () => {
    expect(swaps.header).toBe(true);
    expect(swaps.areas).toEqual([
      {
        filename: '/dev/nvme0n1p3',
        type: 'partition',
        sizeKib: 8388604,
        usedKib: 1743872,
        priority: -2,
      },
    ]);
  });

  /**
   * The file prints no unit, and these are KiB — Size being a page short of
   * the partition itself, since the first page holds the swap header.
   */
  it('reads the sizes as the KiB they are', () => {
    const summary = summarize(swaps);

    expect(summary.totalKib).toBe(8388604);
    expect(formatKib(summary.totalKib)).toBe('8.0 GiB');
    // 8 GiB exactly, less the header page.
    expect(summary.totalKib + HEADER_PAGE_KIB).toBe(8 * 1024 * 1024);
  });

  it('works out what is left and how much is spoken for', () => {
    const summary = summarize(swaps);

    expect(summary.usedKib).toBe(1743872);
    expect(summary.freeKib).toBe(6644732);
    expect(summary.usedShare).toBeCloseTo(0.208, 3);
    expect(summary.nearlyFull).toBe(false);
  });

  /** A negative priority is the kernel's own, not one anybody asked for. */
  it('tells the kernel’s own priority from one that was asked for', () => {
    expect(isAutoPriority(swaps.areas[0]!)).toBe(true);
    expect(isAutoPriority({ ...swaps.areas[0]!, priority: 10 })).toBe(false);
  });
});

describe('parseSwaps — swap grown by adding files', () => {
  const swaps = parseSwaps(fixture('swapfiles'));

  /** The kernel escapes a space in the path exactly as `/proc/mounts` does. */
  it('unescapes a path with a space in it', () => {
    expect(swaps.areas[1]?.filename).toBe('/mnt/data/swap file');
    expect(unescapePath('/a\\040b\\011c\\134d')).toBe('/a b\tc\\d');
  });

  /** Past 40 characters the kernel gives up padding and prints one space. */
  it('reads a path too long for the column it is printed in', () => {
    expect(swaps.areas[2]?.filename).toBe('/var/lib/machines/container-01/swapfile.img');
    expect(swaps.areas[2]?.sizeKib).toBe(1048572);
  });

  it('reads a swap file as a file rather than a partition', () => {
    expect(swaps.areas.map((area) => area.type)).toEqual(['file', 'file', 'file']);
    expect(describeArea(swaps.areas[0]!)).toMatch(/file on a mounted filesystem/);
  });

  /**
   * Each area got the next number down as it was swapped on, so the negatives
   * are the order they were added rather than a ranking anyone chose.
   */
  it('reads the fill order off the priorities', () => {
    const groups = priorityGroups(swaps.areas);

    expect(groups.map((group) => group.priority)).toEqual([-2, -3, -4]);
    expect(groups.every((group) => group.striped)).toBe(false);
    expect(groups[0]?.areas[0]?.filename).toBe('/swapfile');
  });

  it('adds the areas up across the machine', () => {
    const summary = summarize(swaps);

    expect(summary.areas).toBe(3);
    expect(summary.totalKib).toBe(7340020);
    expect(summary.usedKib).toBe(2105600);
    expect(summary.striped).toEqual([]);
  });

  it('reads an area nothing has been written to', () => {
    const untouched = swaps.areas[2]!;

    expect(usedShare(untouched)).toBe(0);
    expect(freeKib(untouched)).toBe(untouched.sizeKib);
  });
});

describe('parseSwaps — two areas at one priority', () => {
  const swaps = parseSwaps(fixture('striped-pair'));

  /**
   * Equal priorities are the only way to stripe swap: the kernel alternates
   * between the areas rather than filling one and moving on.
   */
  it('groups the areas the kernel uses round-robin', () => {
    const summary = summarize(swaps);

    expect(summary.groups).toHaveLength(1);
    expect(summary.striped).toHaveLength(1);
    expect(summary.striped[0]?.priority).toBe(10);
    expect(summary.striped[0]?.areas.map((area) => area.filename)).toEqual([
      '/dev/nvme0n1p2',
      '/dev/nvme1n1p2',
    ]);
  });

  /** Round-robin allocation is what makes the two Used figures line up. */
  it('leaves the two of them used almost exactly alike', () => {
    const [first, second] = swaps.areas;

    expect(Math.abs(usedShare(first!) - usedShare(second!))).toBeLessThan(0.001);
  });

  /** Over ten million KiB the kernel drops a tab, so the columns shift. */
  it('reads a row whose figures are too wide for the extra tab', () => {
    expect(swaps.areas[0]).toMatchObject({ sizeKib: 16777212, usedKib: 4302848, priority: 10 });
  });
});

describe('parseSwaps — zram in front of a disk', () => {
  const swaps = parseSwaps(fixture('zram-first'));

  /** A zram area is a partition to the kernel and compressed RAM in fact. */
  it('knows a zram device is not a disk', () => {
    expect(isZram(swaps.areas[0]!)).toBe(true);
    expect(isZram(swaps.areas[1]!)).toBe(false);
    expect(describeArea(swaps.areas[0]!)).toMatch(/Compressed memory/);
  });

  it('puts the higher priority first in the fill order', () => {
    const summary = summarize(swaps);

    expect(summary.groups.map((group) => group.priority)).toEqual([100, -2]);
    expect(summary.groups[0]?.areas[0]?.filename).toBe('/dev/zram0');
  });

  /** Which is why the disk behind it has never been written to. */
  it('shows the area behind it untouched', () => {
    expect(usedShare(swaps.areas[0]!)).toBeCloseTo(0.81, 2);
    expect(swaps.areas[1]?.usedKib).toBe(0);
  });
});

describe('parseSwaps — a machine with no swap', () => {
  const swaps = parseSwaps(fixture('no-swap'));

  /**
   * The header with nothing under it is a machine with no swap, which is
   * ordinary; a file without even the header is not this file at all.
   */
  it('keeps no swap apart from no file', () => {
    expect(swaps).toEqual({ header: true, areas: [] });
    expect(parseSwaps('nonsense\n')).toEqual({ header: false, areas: [] });
  });

  it('summarizes nothing without dividing by it', () => {
    const summary = summarize(swaps);

    expect(summary).toMatchObject({ areas: 0, totalKib: 0, usedKib: 0, freeKib: 0 });
    expect(summary.usedShare).toBe(0);
    expect(summary.nearlyFull).toBe(false);
  });
});

describe('parseSwaps — the awkward files', () => {
  const header = 'Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n';

  it('reads an empty file as neither swap nor a header', () => {
    expect(parseSwaps('')).toEqual({ header: false, areas: [] });
  });

  it('ignores a line that is missing its figures', () => {
    const swaps = parseSwaps(`${header}/swapfile                               file\n`);

    expect(swaps.areas).toEqual([]);
  });

  it('reads CRLF line endings', () => {
    const swaps = parseSwaps(`${header.trimEnd()}\r\n/dev/sda2 partition 1048572 0 -2\r\n`);

    expect(swaps.areas[0]).toMatchObject({ filename: '/dev/sda2', sizeKib: 1048572 });
  });

  /** A file with a `\040` in it splits on whitespace safely because of it. */
  it('splits on whitespace, which the escaping is what makes safe', () => {
    const swaps = parseSwaps(`${header}/mnt/a\\040b/c\\040d.img file 1048572 4096 -3\n`);

    expect(swaps.areas[0]?.filename).toBe('/mnt/a b/c d.img');
    expect(swaps.areas[0]?.usedKib).toBe(4096);
  });

  it('does not invent a deliberate zero for a missing priority', () => {
    const swaps = parseSwaps(`${header}/dev/sda2 partition 1048572 0\n`);

    expect(swaps.areas[0]?.priority).toBe(0);
    expect(isAutoPriority(swaps.areas[0]!)).toBe(false);
  });

  it('reads a used figure larger than the area without going negative', () => {
    expect(freeKib({ filename: '/x', type: 'file', sizeKib: 100, usedKib: 200, priority: -2 })).toBe(
      0,
    );
  });

  it('flags swap that has almost nothing left', () => {
    const swaps = parseSwaps(`${header}/dev/sda2 partition 1000000 950000 -2\n`);

    expect(summarize(swaps).nearlyFull).toBe(true);
  });
});

describe('formatting', () => {
  it('reads a KiB figure in the binary units it is counted in', () => {
    expect(formatKib(0)).toBe('0');
    expect(formatKib(512)).toBe('512 KiB');
    expect(formatKib(2097148)).toBe('2.0 GiB');
    expect(formatKib(16777212)).toBe('16 GiB');
  });

  it('keeps an area that is barely touched apart from one that is not', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.0001)).toBe('<1%');
    expect(formatShare(0.208)).toBe('21%');
    expect(formatShare(1)).toBe('100%');
  });
});
