import { describe, expect, it } from 'vitest';
import { readIomemFixture as fixture } from '../test/fixtures';
import {
  addressesHidden,
  formatAddress,
  formatBytes,
  parseIomem,
  sizeOf,
  summarize,
  systemRamBytes,
  topAddress,
  topLevel,
} from './iomem';

describe('parseIomem — a modern desktop', () => {
  const info = parseIomem(fixture('desktop-x86'));

  it('reads a range and its name', () => {
    expect(info.regions[0]).toEqual({ start: 0, end: 0xfff, name: 'Reserved', depth: 0 });
  });

  // Two spaces per level, and the nesting is what makes the map a tree.
  it('reads the indentation as nesting', () => {
    const kernel = info.regions.find((region) => region.name === 'Kernel code');

    expect(kernel).toMatchObject({ depth: 1, start: 0x01000000 });
    expect(info.regions.find((region) => region.name === 'i915')?.depth).toBe(2);
    expect(summarize(info).deepest).toBe(2);
  });

  it('reads an address above 4 GiB', () => {
    const high = info.regions.find((region) => region.start === 0x100000000);

    expect(high).toMatchObject({ name: 'System RAM', end: 0x41f7fffff });
    expect(formatAddress(high!.start)).toBe('100000000');
  });

  /**
   * Both bounds are inclusive, so the size is one byte more than the
   * difference — `00000000-00000fff` is a 4 KiB page, not 4095 bytes.
   */
  it('counts an inclusive range', () => {
    expect(sizeOf(info.regions[0]!)).toBe(4096);
    expect(formatBytes(sizeOf(info.regions[0]!))).toBe('4.0 KiB');
  });

  /**
   * The nested lines are pieces of the range above them, so only the top level
   * is added up; counting `Kernel code` as well would count it twice.
   */
  it('adds up the top-level System RAM only', () => {
    const summary = summarize(info);

    expect(summary.ram.map((region) => region.start)).toEqual([
      0x1000, 0x100000, 0x9b80000, 0x100000000,
    ]);
    expect(formatBytes(summary.ramBytes)).toBe('16 GiB');

    // The kernel image is inside System RAM, and is not counted again.
    const kernelBytes = info.regions
      .filter((region) => region.name.startsWith('Kernel '))
      .reduce((total, region) => total + sizeOf(region), 0);
    expect(kernelBytes).toBeGreaterThan(0);
    expect(summary.ramBytes).toBeLessThan(
      info.regions.reduce((total, region) => total + sizeOf(region), 0),
    );
  });

  it('reports the top of the map and how many ranges are at the top level', () => {
    const summary = summarize(info);

    expect(summary.regions).toBe(32);
    expect(summary.topLevel).toBe(topLevel(info).length);
    expect(summary.topLevel).toBe(19);
    expect(formatAddress(summary.topAddress!)).toBe('41f7fffff');
  });
});

describe('parseIomem — read without privilege', () => {
  const info = parseIomem(fixture('unprivileged'));

  /**
   * The kernel replaces every address with zero for a reader without
   * CAP_SYS_ADMIN rather than refusing the file, so the shape and the names
   * arrive and nothing else does.
   */
  it('reads the zeroed addresses as hidden rather than as a map of nothing', () => {
    expect(addressesHidden(info)).toBe(true);
    expect(info.regions).toHaveLength(20);
    expect(info.regions.map((region) => region.name)).toContain('Kernel code');
  });

  it('keeps the nesting, which the kernel does not hide', () => {
    expect(info.regions.find((region) => region.name === 'i915')?.depth).toBe(2);
    expect(summarize(info).deepest).toBe(2);
  });

  // A total worked out from zeroes would be a fiction, so none is offered.
  it('claims no memory total and no top address', () => {
    expect(systemRamBytes(info)).toBe(0);
    expect(summarize(info)).toMatchObject({ hidden: true, ramBytes: 0, topAddress: null });
  });
});

describe('parseIomem — an ARM64 board', () => {
  const info = parseIomem(fixture('arm-rpi4'));

  it('reads SoC blocks named after their device tree nodes', () => {
    const names = info.regions.map((region) => region.name);

    expect(names).toContain('serial@7e201000');
    expect(names).toContain('fe101000.cprman');
  });

  it('adds up RAM split into several ranges', () => {
    const summary = summarize(info);

    expect(summary.ram).toHaveLength(3);
    // Just under 4 GiB: the map has holes the firmware kept for itself.
    expect(formatBytes(summary.ramBytes)).toBe('3.9 GiB');
  });

  it('reads the deepest nesting in the map', () => {
    expect(summarize(info).deepest).toBe(3);
    expect(info.regions.find((region) => region.name === 'xhci-hcd')?.depth).toBe(3);
  });
});

describe('parseIomem — persistent memory', () => {
  const info = parseIomem(fixture('nvdimm-server'));

  /**
   * Persistent memory is address space like anything else here, and it is not
   * `System RAM`: the kernel does not hand it out as memory.
   */
  it('leaves persistent memory out of the RAM total', () => {
    const pmem = info.regions.find((region) => region.name === 'Persistent Memory');

    expect(sizeOf(pmem!)).toBe(0xc00000000);
    expect(summarize(info).ram.map((region) => region.name)).not.toContain('Persistent Memory');
    expect(summarize(info).ramBytes).toBe(
      info.regions
        .filter((region) => region.depth === 0 && region.name === 'System RAM')
        .reduce((total, region) => total + sizeOf(region), 0),
    );
  });

  it('reads the namespace nested inside it', () => {
    expect(info.regions.find((region) => region.name === 'namespace0.0')?.depth).toBe(1);
  });
});

describe('parseIomem — every fixture', () => {
  const names = ['desktop-x86', 'unprivileged', 'arm-rpi4', 'vm-virtio', 'nvdimm-server'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseIomem(fixture(name));
    const summary = summarize(info);

    expect(summary.regions).toBeGreaterThan(0);
    expect(info.regions[0]?.depth).toBe(0);

    for (const region of info.regions) {
      expect(region.name).not.toBe('');
      expect(Number.isSafeInteger(region.start)).toBe(true);
      expect(Number.isSafeInteger(region.end)).toBe(true);
      expect(region.end).toBeGreaterThanOrEqual(region.start);
      expect(region.depth).toBeGreaterThanOrEqual(0);
    }

    // Depth grows one level at a time: a child follows its parent.
    for (const [index, region] of info.regions.entries()) {
      if (index === 0) continue;
      expect(region.depth).toBeLessThanOrEqual((info.regions[index - 1]?.depth ?? 0) + 1);
    }

    // A nested range lies inside the last one shallower than it.
    for (const [index, region] of info.regions.entries()) {
      if (region.depth === 0) continue;
      const parent = info.regions
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.depth === region.depth - 1)!;
      expect(region.start).toBeGreaterThanOrEqual(parent.start);
      expect(region.end).toBeLessThanOrEqual(parent.end);
    }

    if (summary.hidden) {
      expect(summary.ramBytes).toBe(0);
      expect(summary.topAddress).toBeNull();
    } else {
      expect(summary.topAddress).toBe(topAddress(info));
      expect(summary.ramBytes).toBeGreaterThan(0);
    }
  });
});

describe('parseIomem — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseIomem('').regions).toEqual([]);
    expect(addressesHidden(parseIomem(''))).toBe(false);
    expect(topAddress(parseIomem(''))).toBeNull();
  });

  it('returns nothing for a file that is not /proc/iomem', () => {
    expect(parseIomem('processor\t: 0\n').regions).toEqual([]);
  });

  it('reads a name with spaces and punctuation in it', () => {
    expect(parseIomem('e0000000-efffffff : PCI MMCONFIG 0000 [bus 00-ff]\n').regions[0]).toEqual({
      start: 0xe0000000,
      end: 0xefffffff,
      name: 'PCI MMCONFIG 0000 [bus 00-ff]',
      depth: 0,
    });
  });

  it('reads a range of a single byte', () => {
    expect(sizeOf(parseIomem('00000010-00000010 : one\n').regions[0]!)).toBe(1);
  });

  it('skips a line with no name', () => {
    expect(parseIomem('00000000-00000fff :\n').regions).toEqual([]);
  });

  it('skips a line that is not a range at all', () => {
    expect(parseIomem('total : 4\n').regions).toEqual([]);
  });

  // Four spaces is two levels, as the kernel writes two per level.
  it('reads each two spaces as one level', () => {
    const info = parseIomem('0-f : a\n  0-7 : b\n    0-3 : c\n');

    expect(info.regions.map((region) => region.depth)).toEqual([0, 1, 2]);
  });

  it('pads a short address the way the kernel does', () => {
    expect(formatAddress(0)).toBe('00000000');
    expect(formatAddress(0xfed003ff)).toBe('fed003ff');
    // Beyond 32 bits it simply grows.
    expect(formatAddress(0x41f7fffff)).toBe('41f7fffff');
  });

  it('gives a size of nothing for a range that runs backwards', () => {
    expect(sizeOf({ start: 0x1000, end: 0, name: 'nonsense', depth: 0 })).toBe(0);
  });

  // One region at 0-0 is a range of one byte, not a hidden map.
  it('does not read a single zero range in a real map as hidden', () => {
    expect(addressesHidden(parseIomem('00000000-00000000 : a\n00001000-00001fff : b\n'))).toBe(
      false,
    );
  });

  it('formats sizes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(4096)).toBe('4.0 KiB');
    expect(formatBytes(0x100000000)).toBe('4.0 GiB');
  });
});
