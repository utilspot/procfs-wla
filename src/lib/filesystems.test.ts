import { describe, expect, it } from 'vitest';
import { readFilesystemsFixture as fixture } from '../test/fixtures';
import {
  isInternal,
  kindOf,
  mountOrder,
  parseFilesystems,
  summarize,
} from './filesystems';

describe('parseFilesystems — a modern desktop', () => {
  const info = parseFilesystems(fixture('desktop-ubuntu'));

  it('reads the first field as whether a block device is needed', () => {
    expect(info.filesystems[0]).toEqual({ name: 'sysfs', requiresDevice: false });
    expect(info.filesystems.find((entry) => entry.name === 'ext4')).toEqual({
      name: 'ext4',
      requiresDevice: true,
    });
  });

  it('keeps the file in registration order rather than sorting it', () => {
    expect(info.filesystems.slice(0, 4).map((entry) => entry.name)).toEqual([
      'sysfs',
      'tmpfs',
      'bdev',
      'proc',
    ]);
    expect(info.filesystems.at(-1)?.name).toBe('overlay');
  });

  /**
   * `mount` with no `-t` works through the entries needing a device, in this
   * order — the `nodev` ones cannot be what a block device holds.
   */
  it('gives the order mount tries, without the nodev entries', () => {
    expect(mountOrder(info).map((entry) => entry.name)).toEqual([
      'ext3',
      'ext2',
      'ext4',
      'squashfs',
      'vfat',
      'fuseblk',
      'btrfs',
      'iso9660',
    ]);
  });

  it('counts the kinds apart', () => {
    const summary = summarize(info);

    expect(summary.total).toBe(35);
    expect(summary.device).toHaveLength(8);
    expect(summary.network).toHaveLength(0);
    expect(summary.virtual).toHaveLength(27);
  });

  // Registered like any other, but a mount from userspace fails.
  it('knows the ones the kernel keeps for itself', () => {
    expect(summarize(info).internal.map((entry) => entry.name)).toEqual([
      'bdev',
      'sockfs',
      'pipefs',
    ]);
    expect(isInternal({ name: 'proc', requiresDevice: false })).toBe(false);
  });
});

describe('parseFilesystems — an NFS and SMB client', () => {
  const info = parseFilesystems(fixture('nfs-client'));

  /**
   * A network filesystem is `nodev` like a virtual one — its data comes from a
   * server rather than from nowhere, and the file does not say which is which.
   */
  it('separates the network filesystems from the virtual ones', () => {
    const summary = summarize(info);

    expect(summary.network.map((entry) => entry.name)).toEqual([
      'nfs',
      'nfs4',
      'cifs',
      'smb3',
      'ceph',
      '9p',
    ]);
    expect(summary.network.every((entry) => entry.requiresDevice)).toBe(false);
    expect(summary.virtual.map((entry) => entry.name)).toContain('rpc_pipefs');
  });

  it('leaves the block-backed ones as the only ones mount would try', () => {
    expect(mountOrder(info).map((entry) => entry.name)).toEqual(['ext4', 'xfs']);
    expect(kindOf({ name: 'xfs', requiresDevice: true })).toBe('device');
  });
});

describe('parseFilesystems — an embedded board', () => {
  const info = parseFilesystems(fixture('embedded-squashfs'));

  it('reads the small list such a kernel registers', () => {
    expect(summarize(info).total).toBe(14);
    expect(mountOrder(info).map((entry) => entry.name)).toEqual(['squashfs', 'jffs2', 'vfat']);
  });

  // ubifs sits on MTD rather than on a block device, so it is nodev.
  it('reads a flash filesystem as needing no block device', () => {
    const ubifs = info.filesystems.find((entry) => entry.name === 'ubifs');

    expect(ubifs?.requiresDevice).toBe(false);
    expect(kindOf(ubifs!)).toBe('virtual');
  });
});

describe('parseFilesystems — a module loaded after boot', () => {
  const info = parseFilesystems(fixture('zfs-module'));

  /**
   * Registration order is the point: an out-of-tree filesystem registers when
   * its module loads, so it lands at the end rather than among the built-ins.
   */
  it('leaves the late registration at the end of the list', () => {
    expect(info.filesystems.at(-1)).toEqual({ name: 'zfs', requiresDevice: false });
  });
});

describe('parseFilesystems — an old kernel', () => {
  const info = parseFilesystems(fixture('legacy-2.6'));

  it('reads the filesystems of the day', () => {
    const names = info.filesystems.map((entry) => entry.name);

    expect(names).toContain('reiserfs');
    expect(names).toContain('usbfs');
    expect(names).not.toContain('overlay');
  });

  it('knows anon_inodefs is one the kernel keeps for itself', () => {
    expect(summarize(info).internal.map((entry) => entry.name)).toContain('anon_inodefs');
  });
});

describe('parseFilesystems — every fixture', () => {
  const names = [
    'desktop-ubuntu',
    'embedded-squashfs',
    'nfs-client',
    'zfs-module',
    'legacy-2.6',
  ];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseFilesystems(fixture(name));
    const summary = summarize(info);

    expect(summary.total).toBeGreaterThan(0);

    for (const entry of info.filesystems) {
      expect(entry.name).not.toBe('');
      expect(entry.name).not.toContain('nodev');
    }

    // A filesystem is never registered twice.
    expect(new Set(info.filesystems.map((entry) => entry.name)).size).toBe(summary.total);

    // Every entry falls into exactly one kind, and only a device-backed one is
    // something mount would try.
    expect(summary.device.length + summary.network.length + summary.virtual.length).toBe(
      summary.total,
    );
    expect(mountOrder(info)).toEqual(summary.device);

    // Nothing the kernel keeps for itself needs a block device.
    expect(summary.internal.every((entry) => !entry.requiresDevice)).toBe(true);
  });
});

describe('parseFilesystems — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseFilesystems('').filesystems).toEqual([]);
    expect(summarize(parseFilesystems(''))).toMatchObject({ total: 0 });
  });

  it('returns nothing for a file that is not /proc/filesystems', () => {
    expect(parseFilesystems('processor\t: 0\n').filesystems).toEqual([]);
  });

  // The device-backed lines begin with the tab that follows an empty field.
  it('reads a line whose first field is empty', () => {
    expect(parseFilesystems('\text4\n').filesystems).toEqual([
      { name: 'ext4', requiresDevice: true },
    ]);
  });

  it('reads a line spaced with something other than a tab', () => {
    expect(parseFilesystems('nodev   proc\n  ext4\n').filesystems).toEqual([
      { name: 'proc', requiresDevice: false },
      { name: 'ext4', requiresDevice: true },
    ]);
  });

  it('does not take nodev itself for a filesystem name', () => {
    expect(parseFilesystems('nodev\n').filesystems).toEqual([]);
  });

  it('reads a name that merely starts with nodev', () => {
    expect(parseFilesystems('nodev\tnodevfs\n').filesystems).toEqual([
      { name: 'nodevfs', requiresDevice: false },
    ]);
  });

  // Only a filesystem name that stands alone belongs to a device-backed line.
  it('skips a line with more fields than the format has', () => {
    expect(parseFilesystems('ext4 something else\n').filesystems).toEqual([]);
  });

  it('claims a filesystem is network only when the name says so', () => {
    expect(kindOf({ name: 'nfs', requiresDevice: false })).toBe('network');
    expect(kindOf({ name: 'tmpfs', requiresDevice: false })).toBe('virtual');
    // The kind follows the field first: a name on the list that somehow needs
    // a device is device-backed.
    expect(kindOf({ name: 'nfs', requiresDevice: true })).toBe('device');
  });
});
