import { describe, expect, it } from 'vitest';
import { readIoportsFixture as fixture } from '../test/fixtures';
import {
  addressesHidden,
  claimedPorts,
  formatPort,
  freePorts,
  isLegacy,
  parseIoports,
  PORT_SPACE,
  sizeOf,
  summarize,
  topLevel,
} from './ioports';

describe('parseIoports — a modern x86 desktop', () => {
  const info = parseIoports(fixture('desktop-x86'));

  it('reads a range and what claimed it', () => {
    expect(info.ranges[0]).toEqual({ start: 0, end: 0xcf7, name: 'PCI Bus 0000:00', depth: 0 });
  });

  // Two spaces per level, and a nested range is carved out of the one above.
  it('reads the indentation as nesting', () => {
    expect(info.ranges.find((range) => range.name === 'keyboard')?.depth).toBe(1);
    expect(info.ranges.find((range) => range.name === 'e1000e')?.depth).toBe(3);
    expect(summarize(info).deepest).toBe(3);
  });

  /**
   * Both bounds are inclusive, so a range covering one port has the same start
   * and end rather than a difference of one.
   */
  it('counts an inclusive range', () => {
    const keyboard = info.ranges.find((range) => range.name === 'keyboard')!;
    const dma1 = info.ranges.find((range) => range.name === 'dma1')!;

    expect(sizeOf(keyboard)).toBe(1);
    expect(sizeOf(dma1)).toBe(32);
  });

  /**
   * The nested ranges are pieces of the range above them, so only the top
   * level is added up — the two PCI windows here cover the space between them.
   */
  it('counts the ports claimed from the top level only', () => {
    const summary = summarize(info);

    expect(topLevel(info)).toHaveLength(3);
    expect(summary.claimed).toBe(0xcf8 + 8 + (0x10000 - 0xd00));
    expect(summary.claimed).toBe(PORT_SPACE);
    expect(summary.free).toBe(0);
  });

  // The block the original PC laid out is still where those devices are.
  it('picks out the ranges below 0x400', () => {
    const summary = summarize(info);

    expect(summary.legacy.map((range) => range.name)).toContain('pic1');
    expect(summary.legacy.map((range) => range.name)).toContain('vesafb');
    expect(summary.legacy.map((range) => range.name)).not.toContain('i801_smbus');
  });

  it('does not call a range straddling 0x400 a legacy one', () => {
    expect(isLegacy({ start: 0x3f0, end: 0x40f, name: 'straddles', depth: 0 })).toBe(false);
    expect(isLegacy({ start: 0x3f8, end: 0x3ff, name: 'serial', depth: 0 })).toBe(true);
    expect(isLegacy({ start: 0x400, end: 0x41f, name: 'smbus', depth: 0 })).toBe(false);
  });
});

describe('parseIoports — a 1990s PC', () => {
  const info = parseIoports(fixture('legacy-isa'));

  // Nothing is nested here: every device claimed its ports directly.
  it('reads a map with no nesting at all', () => {
    expect(info.ranges.every((range) => range.depth === 0)).toBe(true);
    expect(summarize(info).deepest).toBe(0);
    expect(topLevel(info)).toHaveLength(info.ranges.length);
  });

  /**
   * The space is 65536 ports and no more, so a machine using a few hundred of
   * them has almost all of it left — which is the point of counting.
   */
  it('counts what is left of the space', () => {
    const summary = summarize(info);

    expect(summary.claimed).toBe(313);
    expect(summary.free).toBe(PORT_SPACE - 313);
    expect(summary.legacy).toHaveLength(info.ranges.length);
  });

  it('reads the classic devices', () => {
    const names = info.ranges.map((range) => range.name);

    expect(names).toContain('soundblaster');
    expect(names).toContain('parport1');
    expect(names).toContain('ide0');
  });
});

describe('parseIoports — a QEMU guest', () => {
  const info = parseIoports(fixture('vm-virtio'));

  it('reads the ACPI blocks nested under the PCI device that holds them', () => {
    const timer = info.ranges.find((range) => range.name === 'ACPI PM_TMR');

    expect(timer).toMatchObject({ start: 0x608, end: 0x60b, depth: 2 });
    expect(sizeOf(timer!)).toBe(4);
  });

  it('reads the virtio devices in the PCI window', () => {
    const virtio = info.ranges.filter((range) => range.name === 'virtio-pci-legacy');

    expect(virtio).toHaveLength(2);
    expect(virtio.every((range) => range.depth === 2)).toBe(true);
  });
});

describe('parseIoports — read without privilege', () => {
  const info = parseIoports(fixture('unprivileged'));

  /**
   * Zeroed addresses are the kernel hiding them from a reader without
   * CAP_SYS_ADMIN, not a machine that claimed port zero fourteen times.
   */
  it('reads the zeroed ports as hidden', () => {
    expect(addressesHidden(info)).toBe(true);
    expect(info.ranges).toHaveLength(14);
    expect(info.ranges.map((range) => range.name)).toContain('ata_piix');
  });

  it('keeps the nesting, which the kernel does not hide', () => {
    expect(summarize(info).deepest).toBe(2);
  });

  // A count taken from zeroes would be a fiction, so none is offered.
  it('counts no ports and claims nothing about the legacy block', () => {
    expect(claimedPorts(info)).toBeNull();
    expect(freePorts(info)).toBeNull();
    expect(summarize(info)).toMatchObject({ hidden: true, claimed: null, free: null });
    expect(summarize(info).legacy).toEqual([]);
  });
});

describe('parseIoports — a machine with no port space', () => {
  const info = parseIoports(fixture('arm-no-ports'));

  /**
   * I/O ports are an x86 arrangement; elsewhere the file is empty, and it is
   * not the file's place to say which of the two reasons applies.
   */
  it('reads an empty file as no ranges rather than as hidden', () => {
    expect(info.ranges).toEqual([]);
    expect(addressesHidden(info)).toBe(false);
    expect(summarize(info)).toMatchObject({ ranges: 0, claimed: 0, free: PORT_SPACE });
  });
});

describe('parseIoports — every fixture', () => {
  const names = ['desktop-x86', 'legacy-isa', 'vm-virtio', 'unprivileged', 'arm-no-ports'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseIoports(fixture(name));
    const summary = summarize(info);

    for (const range of info.ranges) {
      expect(range.name).not.toBe('');
      expect(range.end).toBeGreaterThanOrEqual(range.start);
      // The space is 16 bits wide, so nothing in it reaches beyond 0xffff.
      expect(range.end).toBeLessThan(PORT_SPACE);
      expect(range.depth).toBeGreaterThanOrEqual(0);
    }

    // A nested range lies inside the last one shallower than it.
    for (const [index, range] of info.ranges.entries()) {
      if (range.depth === 0) continue;
      const parent = info.ranges
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.depth === range.depth - 1)!;
      expect(parent).toBeDefined();
      expect(range.start).toBeGreaterThanOrEqual(parent.start);
      expect(range.end).toBeLessThanOrEqual(parent.end);
    }

    if (summary.hidden) {
      expect(summary.claimed).toBeNull();
      expect(summary.free).toBeNull();
    } else {
      // Claimed and free account for the whole space between them.
      expect(summary.claimed! + summary.free!).toBe(PORT_SPACE);
      expect(summary.claimed).toBe(
        topLevel(info).reduce((total, range) => total + sizeOf(range), 0),
      );
    }
  });
});

describe('parseIoports — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseIoports('').ranges).toEqual([]);
    expect(addressesHidden(parseIoports(''))).toBe(false);
  });

  it('returns nothing for a file that is not /proc/ioports', () => {
    expect(parseIoports('processor\t: 0\n').ranges).toEqual([]);
  });

  it('reads a name with spaces in it', () => {
    expect(parseIoports('0080-008f : dma page reg\n').ranges[0]).toEqual({
      start: 0x80,
      end: 0x8f,
      name: 'dma page reg',
      depth: 0,
    });
  });

  it('skips a line with no name', () => {
    expect(parseIoports('0060-0060 :\n').ranges).toEqual([]);
  });

  it('reads each two spaces as one level', () => {
    const info = parseIoports('0000-000f : a\n  0000-0007 : b\n    0000-0003 : c\n');

    expect(info.ranges.map((range) => range.depth)).toEqual([0, 1, 2]);
  });

  it('pads a port the way the kernel does', () => {
    expect(formatPort(0)).toBe('0000');
    expect(formatPort(0x60)).toBe('0060');
    expect(formatPort(0xffff)).toBe('ffff');
  });

  it('gives a count of nothing for a range that runs backwards', () => {
    expect(sizeOf({ start: 0x100, end: 0, name: 'nonsense', depth: 0 })).toBe(0);
  });

  // One range at 0000-0000 is a single port, not a hidden file.
  it('does not read a single zero range in a real map as hidden', () => {
    expect(addressesHidden(parseIoports('0000-0000 : a\n0060-0060 : b\n'))).toBe(false);
  });

  it('never reports more ports free than there are', () => {
    const info = parseIoports('0000-ffff : everything\n0000-ffff : again\n');

    expect(claimedPorts(info)).toBe(PORT_SPACE * 2);
    expect(freePorts(info)).toBe(0);
  });
});
