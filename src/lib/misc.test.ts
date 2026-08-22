import { describe, expect, it } from 'vitest';
import { readMiscFixture as fixture } from '../test/fixtures';
import {
  describeDevice,
  deviceNumber,
  DYNAMIC_MINORS,
  dynamicDevices,
  isDynamic,
  MISC_MAJOR,
  parseMisc,
  staticDevices,
  summarize,
} from './misc';

describe('parseMisc — an ordinary desktop', () => {
  const info = parseMisc(fixture('desktop'));

  it('reads a minor and the name beside it', () => {
    expect(info.devices[0]).toEqual({ minor: 63, name: 'vboxnetctl' });
    expect(info.devices.find((device) => device.name === 'fuse')).toEqual({
      minor: 229,
      name: 'fuse',
    });
  });

  /**
   * The number is a minor only: everything here shares major 10, which is what
   * the misc driver exists to do.
   */
  it('names the device as the pair it actually is', () => {
    const fuse = info.devices.find((device) => device.name === 'fuse')!;

    expect(deviceNumber(fuse)).toBe('10:229');
    expect(MISC_MAJOR).toBe(10);
  });

  /**
   * Below 64 the minor came out of the pool at registration; at 64 and above
   * it was written into the kernel's headers.
   */
  it('tells a minor from the pool from one out of a header', () => {
    expect(isDynamic({ minor: 63, name: 'x' })).toBe(true);
    expect(isDynamic({ minor: 0, name: 'x' })).toBe(true);
    expect(isDynamic({ minor: 64, name: 'x' })).toBe(false);
    expect(isDynamic({ minor: 229, name: 'x' })).toBe(false);
  });

  it('sorts the pooled ones by the order they were handed out', () => {
    // Handed out downwards from 63, so the newest registration is first.
    expect(dynamicDevices(info).map((device) => device.minor)).toEqual([
      63, 62, 61, 60, 59, 58, 57, 56,
    ]);
    expect(staticDevices(info)[0]?.minor).toBe(183);
  });

  it('counts the two kinds apart and what is left of the pool', () => {
    const summary = summarize(info);

    expect(summary).toMatchObject({ total: 20, poolFree: DYNAMIC_MINORS - 8 });
    expect(summary.dynamic).toHaveLength(8);
    expect(summary.static).toHaveLength(12);
  });

  it('describes the devices it knows', () => {
    expect(describeDevice('fuse')).toMatch(/userspace/);
    expect(describeDevice('loop-control')).toMatch(/Adds and removes/);
    expect(describeDevice('vboxdrv')).toBeNull();
    expect(summarize(info).unknown.map((device) => device.name)).toEqual([
      'vboxnetctl',
      'vboxdrvu',
      'vboxdrv',
    ]);
  });

  // The file is the kernel's list, newest first, rather than sorted by minor.
  it('keeps the file’s own order', () => {
    expect(info.devices.map((device) => device.minor).slice(0, 3)).toEqual([63, 62, 61]);
    expect(info.devices.at(-1)?.minor).toBe(200);
  });
});

describe('parseMisc — a virtualisation host', () => {
  const info = parseMisc(fixture('server-kvm'));

  /**
   * kvm has a minor of its own in the headers, while the vhost devices take
   * whatever the pool gives them — which is worth telling apart.
   */
  it('reads kvm on its fixed minor and vhost on pooled ones', () => {
    const kvm = info.devices.find((device) => device.name === 'kvm')!;

    expect(kvm.minor).toBe(232);
    expect(isDynamic(kvm)).toBe(false);
    expect(dynamicDevices(info).map((device) => device.name)).toEqual([
      'vhost-vsock',
      'vhost-net',
      'vfio',
      'cpu_dma_latency',
      'vga_arbiter',
    ]);
  });

  it('describes what the virtualisation devices are for', () => {
    expect(describeDevice('kvm')).toMatch(/virtual machines/);
    expect(describeDevice('vfio')).toMatch(/IOMMU/);
    expect(describeDevice('vhost-net')).toMatch(/virtio network/);
  });
});

describe('parseMisc — a container', () => {
  const info = parseMisc(fixture('container'));

  it('reads the short list a container sees', () => {
    expect(summarize(info)).toMatchObject({ total: 5 });
    expect(summarize(info).unknown).toEqual([]);
  });
});

describe('parseMisc — an embedded board', () => {
  const info = parseMisc(fixture('embedded'));

  it('reads a watchdog on the minor the headers give it', () => {
    const watchdog = info.devices.find((device) => device.name === 'watchdog')!;

    expect(watchdog.minor).toBe(130);
    expect(isDynamic(watchdog)).toBe(false);
    expect(describeDevice('watchdog')).toMatch(/reboots the machine/);
  });

  it('leaves nearly the whole pool unused', () => {
    expect(summarize(info).poolFree).toBe(DYNAMIC_MINORS - 1);
  });
});

describe('parseMisc — an older kernel', () => {
  const info = parseMisc(fixture('legacy-2.6'));

  it('reads the devices of the day, and a minor of 1', () => {
    const psaux = info.devices.find((device) => device.name === 'psaux')!;

    expect(psaux.minor).toBe(1);
    // 1 is in the pool's range, though this one was assigned in a header.
    expect(deviceNumber(psaux)).toBe('10:1');
    expect(describeDevice('psaux')).toMatch(/PS\/2/);
    expect(describeDevice('agpgart')).toMatch(/AGP/);
  });
});

describe('parseMisc — every fixture', () => {
  const names = ['desktop', 'server-kvm', 'container', 'embedded', 'legacy-2.6'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseMisc(fixture(name));
    const summary = summarize(info);

    expect(summary.total).toBeGreaterThan(0);

    for (const device of info.devices) {
      expect(device.name).not.toBe('');
      expect(Number.isInteger(device.minor)).toBe(true);
      // A minor is one byte, whichever side of the pool it came from.
      expect(device.minor).toBeGreaterThanOrEqual(0);
      expect(device.minor).toBeLessThanOrEqual(255);
      expect(deviceNumber(device)).toBe(`${MISC_MAJOR}:${device.minor}`);
    }

    // A minor identifies one device.
    expect(new Set(info.devices.map((device) => device.minor)).size).toBe(summary.total);
    // The two kinds account for every device.
    expect(summary.dynamic.length + summary.static.length).toBe(summary.total);
    expect(summary.dynamic.every((device) => device.minor < DYNAMIC_MINORS)).toBe(true);
    expect(summary.static.every((device) => device.minor >= DYNAMIC_MINORS)).toBe(true);
  });
});

describe('parseMisc — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseMisc('').devices).toEqual([]);
    expect(summarize(parseMisc(''))).toMatchObject({ total: 0, poolFree: DYNAMIC_MINORS });
  });

  it('returns nothing for a file that is not /proc/misc', () => {
    expect(parseMisc('MemTotal:  1024 kB\n').devices).toEqual([]);
  });

  it('reads a minor of zero, which the pool can hand out', () => {
    const info = parseMisc('  0 something\n');

    expect(info.devices[0]).toEqual({ minor: 0, name: 'something' });
    expect(isDynamic(info.devices[0]!)).toBe(true);
  });

  it('reads a name with a dash or an underscore in it', () => {
    expect(parseMisc(' 60 cpu_dma_latency\n236 device-mapper\n').devices).toEqual([
      { minor: 60, name: 'cpu_dma_latency' },
      { minor: 236, name: 'device-mapper' },
    ]);
  });

  it('skips a line with no name', () => {
    expect(parseMisc(' 63 \n').devices).toEqual([]);
    expect(parseMisc('63\n').devices).toEqual([]);
  });

  it('keeps a device it has no note for', () => {
    const info = parseMisc(' 63 something_new\n');

    expect(info.devices).toHaveLength(1);
    expect(describeDevice('something_new')).toBeNull();
    expect(summarize(info).unknown).toHaveLength(1);
  });

  // The pool is 64 wide, so it cannot have less than nothing left.
  it('never reports a negative number of minors left', () => {
    const many = Array.from({ length: 70 }, (_, index) => `${index} device${index}`).join('\n');

    expect(summarize(parseMisc(many)).poolFree).toBe(0);
  });
});
