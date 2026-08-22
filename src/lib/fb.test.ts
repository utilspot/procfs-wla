import { describe, expect, it } from 'vitest';
import { readFbFixture as fixture } from '../test/fixtures';
import {
  deviceOf,
  firmwareDriver,
  isDrmFbdev,
  kindOf,
  parseFb,
  summarize,
} from './fb';

describe('parseFb — an ordinary laptop', () => {
  const info = parseFb(fixture('intel-laptop'));

  it('reads the single framebuffer', () => {
    expect(info.framebuffers).toEqual([{ node: 0, name: 'inteldrmfb' }]);
    expect(deviceOf(info.framebuffers[0]!)).toBe('/dev/fb0');
  });

  // `drm_fb_helper` appends `drmfb` to the driver name, which is the only
  // thing in the file that separates emulation from a native fbdev driver.
  it('reads the drmfb suffix as DRM fbdev emulation', () => {
    expect(isDrmFbdev(info.framebuffers[0]!)).toBe(true);
    expect(kindOf(info.framebuffers[0]!)).toBe('drm');
    expect(summarize(info)).toMatchObject({ total: 1, firmwareOnly: false });
    expect(summarize(info).drm).toHaveLength(1);
  });
});

describe('parseFb — a firmware framebuffer', () => {
  const info = parseFb(fixture('efi-firmware'));

  /**
   * `EFI VGA` is efifb writing into the buffer the firmware left running, so
   * nothing is driving the hardware yet.
   */
  it('names the driver behind a generic firmware framebuffer', () => {
    expect(info.framebuffers[0]).toEqual({ node: 0, name: 'EFI VGA' });
    expect(firmwareDriver(info.framebuffers[0]!)).toBe('efifb');
    expect(kindOf(info.framebuffers[0]!)).toBe('firmware');
  });

  it('reports that nothing has taken over', () => {
    expect(summarize(info)).toMatchObject({ total: 1, firmwareOnly: true });
    expect(summarize(info).firmware).toHaveLength(1);
  });
});

describe('parseFb — two GPUs', () => {
  const info = parseFb(fixture('dual-gpu'));

  it('reads a framebuffer per GPU, each with its own node', () => {
    expect(info.framebuffers).toEqual([
      { node: 0, name: 'inteldrmfb' },
      { node: 1, name: 'nouveaufb' },
    ]);
    expect(info.framebuffers.map((entry) => deviceOf(entry))).toEqual(['/dev/fb0', '/dev/fb1']);
  });

  // nouveau sets `fix.id` itself, so it is DRM without carrying the suffix.
  it('knows a DRM driver that does not carry the drmfb suffix', () => {
    expect(isDrmFbdev(info.framebuffers[1]!)).toBe(true);
    expect(summarize(info).drm).toHaveLength(2);
    expect(summarize(info).firmwareOnly).toBe(false);
  });
});

describe('parseFb — a headless server', () => {
  const info = parseFb(fixture('headless-server'));

  /**
   * Nothing registered a framebuffer, which is the normal state of a server
   * rather than a file that failed to say anything.
   */
  it('reads an empty file as no framebuffers', () => {
    expect(info.framebuffers).toEqual([]);
    expect(summarize(info)).toMatchObject({ total: 0, firmwareOnly: false });
  });
});

describe('parseFb — a native fbdev driver', () => {
  const info = parseFb(fixture('legacy-matrox'));

  it('reads a name with spaces in it', () => {
    expect(info.framebuffers[0]).toEqual({ node: 0, name: 'MATROX MGA-G400' });
  });

  // Neither DRM emulation nor a firmware handover: a driver of its own.
  it('reads it as neither DRM nor firmware', () => {
    expect(isDrmFbdev(info.framebuffers[0]!)).toBe(false);
    expect(firmwareDriver(info.framebuffers[0]!)).toBeNull();
    expect(kindOf(info.framebuffers[0]!)).toBe('fbdev');
    expect(summarize(info).fbdev).toHaveLength(1);
  });
});

describe('parseFb — every fixture', () => {
  const names = [
    'intel-laptop',
    'efi-firmware',
    'dual-gpu',
    'headless-server',
    'legacy-matrox',
  ];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseFb(fixture(name));
    const summary = summarize(info);

    for (const entry of info.framebuffers) {
      expect(entry.name).not.toBe('');
      // `fix.id` is a 16-byte field, so a name never exceeds 15 characters.
      expect(entry.name.length).toBeLessThanOrEqual(15);
      expect(Number.isInteger(entry.node)).toBe(true);
      expect(entry.node).toBeGreaterThanOrEqual(0);
      expect(deviceOf(entry)).toBe(`/dev/fb${entry.node}`);
    }

    // A node is never listed twice.
    expect(new Set(info.framebuffers.map((entry) => entry.node)).size).toBe(summary.total);

    // Every framebuffer falls into exactly one of the three kinds.
    expect(summary.drm.length + summary.firmware.length + summary.fbdev.length).toBe(summary.total);
  });
});

describe('parseFb — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseFb('').framebuffers).toEqual([]);
  });

  it('returns nothing for a file that is not /proc/fb', () => {
    expect(parseFb('processor\t: 0\n').framebuffers).toEqual([]);
  });

  /**
   * The number is the node, not the line's position: a gap means a
   * framebuffer was unregistered, which is what happens when a real driver
   * displaces the firmware one.
   */
  it('keeps the node the file gives, gaps and all', () => {
    const info = parseFb('1 radeondrmfb\n');

    expect(info.framebuffers[0]).toEqual({ node: 1, name: 'radeondrmfb' });
    expect(deviceOf(info.framebuffers[0]!)).toBe('/dev/fb1');
  });

  it('reads a two-digit node', () => {
    expect(parseFb('31 simple\n').framebuffers[0]?.node).toBe(31);
  });

  it('skips a line with a node and no name', () => {
    expect(parseFb('0\n').framebuffers).toEqual([]);
    expect(parseFb('0   \n').framebuffers).toEqual([]);
  });

  it('accepts however the line is spaced', () => {
    expect(parseFb('  0   inteldrmfb  \n').framebuffers).toEqual([
      { node: 0, name: 'inteldrmfb' },
    ]);
  });

  // The list is a known handful; a name that is not on it is not guessed at.
  it('claims a firmware driver only for the names it knows', () => {
    expect(firmwareDriver({ node: 0, name: 'VESA VGA' })).toBe('vesafb');
    expect(firmwareDriver({ node: 0, name: 'simple' })).toBe('simplefb');
    expect(firmwareDriver({ node: 0, name: 'astdrmfb' })).toBeNull();
  });

  /**
   * simpledrm is a DRM driver, so its name carries the suffix — but it is
   * still painting into the firmware's buffer, which is the more useful fact.
   */
  it('calls a firmware framebuffer firmware even when it is DRM', () => {
    const entry = { node: 0, name: 'simpledrmdrmfb' };

    expect(isDrmFbdev(entry)).toBe(true);
    expect(kindOf(entry)).toBe('firmware');
    expect(summarize({ framebuffers: [entry] }).firmwareOnly).toBe(true);
  });

  it('is not firmware-only once a real driver is registered too', () => {
    const info = parseFb('0 EFI VGA\n1 inteldrmfb\n');

    expect(summarize(info).firmware).toHaveLength(1);
    expect(summarize(info).firmwareOnly).toBe(false);
  });
});
