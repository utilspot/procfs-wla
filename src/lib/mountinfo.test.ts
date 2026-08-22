import { describe, expect, it } from 'vitest';
import { readMountinfoFixture as mountinfo } from '../test/fixtures';
import {
  byId,
  depthOf,
  hasDevice,
  parseMountinfo,
  peerGroup,
  propagationOf,
  summarize,
  type Mountinfo,
} from './mountinfo';

const desktop = parseMountinfo(mountinfo('desktop'));
const container = parseMountinfo(mountinfo('container', '1'));
const binds = parseMountinfo(mountinfo('bind-mounts'));

const at = (mounts: readonly Mountinfo[], mountPoint: string): Mountinfo => {
  const mount = mounts.find((candidate) => candidate.mountPoint === mountPoint);
  if (mount === undefined) throw new Error(`no mount at ${mountPoint}`);
  return mount;
};

describe('parseMountinfo', () => {
  it('reads every field of a line', () => {
    expect(at(desktop, '/')).toMatchObject({
      id: 31,
      parent: 2,
      major: 8,
      minor: 2,
      root: '/',
      mountPoint: '/',
      options: ['rw', 'relatime'],
      type: 'ext4',
      source: '/dev/sda2',
      superOptions: ['rw'],
      readOnly: false,
      superReadOnly: false,
      bind: false,
      line: 6,
    });
  });

  /**
   * The optional fields are the only variable-length part of the line, which is
   * why the `-` is there at all: the fields after it are counted from the
   * separator rather than from the left.
   */
  it('finds the fields after the separator however many tags there are', () => {
    // None: this one carries no optional tag at all.
    const efi = at(desktop, '/boot/efi');
    expect(efi.optional).toEqual([]);
    expect(efi.type).toBe('vfat');
    expect(efi.source).toBe('/dev/sda1');

    // One.
    const sys = at(desktop, '/sys');
    expect(sys.optional).toEqual([{ tag: 'shared', value: 7 }]);
    expect(sys.type).toBe('sysfs');

    // Two, which is what a slave of one group shared with another looks like.
    const journal = at(binds, '/var/log/journal');
    expect(journal.optional).toEqual([
      { tag: 'shared', value: 48 },
      { tag: 'propagate_from', value: 1 },
    ]);
    expect(journal.type).toBe('ext4');
  });

  /** A tag with no value is kept as one rather than dropped. */
  it('reads a tag that carries no number', () => {
    expect(at(binds, '/build/cache').optional).toEqual([{ tag: 'unbindable', value: null }]);
  });

  /** Field 4 is the one place a bind mount says what it is a bind of. */
  it('tells a bind of a subtree from a whole filesystem', () => {
    const www = at(binds, '/var/www');
    expect(www).toMatchObject({ root: '/srv/www', bind: true, source: '/dev/sdb' });

    expect(at(binds, '/srv')).toMatchObject({ root: '/', bind: false });
  });

  /**
   * `ro` in the per-mount options and `ro` in the per-superblock options are
   * different statements: this mount, against the filesystem under every mount
   * of it. A read-only bind of a writable filesystem is the first alone.
   */
  it('keeps the two kinds of read-only apart', () => {
    expect(at(binds, '/var/www')).toMatchObject({ readOnly: true, superReadOnly: false });
    // A snap is both: mounted read-only, off a filesystem that is read-only.
    expect(at(desktop, '/snap/bare/5')).toMatchObject({ readOnly: true, superReadOnly: true });
    expect(at(desktop, '/')).toMatchObject({ readOnly: false, superReadOnly: false });
  });

  /** The same octal escapes `/proc/mounts` uses, in the same three fields. */
  it('unescapes a path with a space in it', () => {
    expect(desktop.some((mount) => mount.mountPoint === '/media/develop/My Passport')).toBe(true);
  });

  it('reads the device number, which is 0 for a filesystem with no device', () => {
    expect(at(desktop, '/')).toMatchObject({ major: 8, minor: 2 });
    expect(at(desktop, '/run')).toMatchObject({ major: 0, minor: 26 });
    expect(hasDevice(at(desktop, '/'))).toBe(true);
    expect(hasDevice(at(desktop, '/run'))).toBe(false);
  });

  it('reads a line whose source is a namespace rather than a device', () => {
    const ns = at(desktop, '/run/snapd/ns/cups.mnt');
    expect(ns).toMatchObject({ type: 'nsfs', source: 'nsfs', root: 'mnt:[4026532369]', bind: true });
  });

  it('skips a line with no separator, and blank lines', () => {
    expect(parseMountinfo('')).toEqual([]);
    expect(parseMountinfo('\n\n')).toEqual([]);
    expect(parseMountinfo('31 2 8:2 / / rw ext4 /dev/sda2 rw\n')).toEqual([]);
  });

  it('skips a line with too few fields on either side of it', () => {
    expect(parseMountinfo('31 2 8:2 / / - ext4 /dev/sda2 rw\n')).toEqual([]);
    expect(parseMountinfo('31 2 8:2 / / rw - ext4\n')).toEqual([]);
  });

  it('reads a line with no per-superblock options', () => {
    const [mount] = parseMountinfo('31 2 8:2 / / rw - ext4 /dev/sda2\n');
    expect(mount).toMatchObject({ superOptions: [], superReadOnly: false });
  });
});

describe('propagationOf', () => {
  it('names each of the four kinds', () => {
    expect(propagationOf(at(desktop, '/'))).toBe('shared');
    expect(propagationOf(at(desktop, '/boot/efi'))).toBe('private');
    expect(propagationOf(at(binds, '/etc/credentials'))).toBe('slave');
    expect(propagationOf(at(binds, '/build/cache'))).toBe('unbindable');
  });

  /** A mount can be both, which is how an event is forwarded on. */
  it('names a mount that both receives and shares', () => {
    const both = parseMountinfo('31 2 8:2 / / rw shared:2 master:1 - ext4 /dev/sda2 rw\n')[0]!;
    expect(propagationOf(both)).toBe('shared and slave');
  });

  it('gives back the peer group a tag names', () => {
    expect(peerGroup(at(desktop, '/'), 'shared')).toBe(1);
    expect(peerGroup(at(binds, '/etc/credentials'), 'master')).toBe(5);
    expect(peerGroup(at(desktop, '/'), 'master')).toBeNull();
  });
});

/**
 * The tree is what this file has and `/proc/mounts` does not: a mount point's
 * text cannot say what it is mounted on, and the parent id can.
 */
describe('depthOf', () => {
  const depth = (mounts: readonly Mountinfo[], mountPoint: string): number =>
    depthOf(at(mounts, mountPoint), byId(mounts));

  it('counts the mounts above one', () => {
    // `/` names its own parent, which is not in the file: nothing above it.
    expect(depth(desktop, '/')).toBe(0);
    expect(depth(desktop, '/dev')).toBe(1);
    expect(depth(desktop, '/dev/pts')).toBe(2);
    expect(depth(desktop, '/run/user/1000/doc')).toBe(3);
  });

  /**
   * And it is the ids that say so, not the path: `/var/www/uploads` is under
   * `/srv`, two mounts up, however its mount point reads.
   */
  it('follows the ids rather than the path', () => {
    expect(depth(binds, '/var/www')).toBe(2);
    expect(depth(binds, '/var/www/uploads')).toBe(3);
    expect(depth(binds, '/mnt/pgdata')).toBe(1);
  });

  /** A parent outside this namespace has nothing above it here either. */
  it('stops where the chain leaves the file', () => {
    expect(depth(container, '/')).toBe(0);
    expect(depth(container, '/proc/kcore')).toBe(2);
  });

  it('does not loop on a file that names a cycle', () => {
    const cycle = parseMountinfo(
      '1 2 8:2 / /a rw - ext4 /dev/sda2 rw\n2 1 8:2 / /b rw - ext4 /dev/sda2 rw\n',
    );
    expect(depthOf(cycle[0]!, byId(cycle))).toBeLessThanOrEqual(cycle.length);
  });
});

describe('summarize', () => {
  it('counts what is in the file', () => {
    const summary = summarize(binds);

    expect(summary.total).toBe(binds.length);
    expect(summary.binds).toBe(6);
    expect(summary.readOnly).toBe(2);
    expect(summary.root?.type).toBe('ext4');
  });

  it('counts the filesystem types, most used first', () => {
    const [first] = summarize(desktop).types;

    expect(first?.type).toBe('tmpfs');
    expect(summarize(desktop).types.map((entry) => entry.type)).toContain('squashfs');
  });

  it('counts the propagation kinds', () => {
    const kinds = new Map(summarize(binds).propagation.map((entry) => [entry.kind, entry.count]));

    expect(kinds.get('unbindable')).toBe(1);
    expect(kinds.get('slave')).toBe(1);
    expect(kinds.get('shared')).toBe(9);
  });

  /** A container's mounts are private and rootless of the host's tree. */
  it('reads a container as private throughout', () => {
    const summary = summarize(container);

    expect(summary.propagation).toEqual([
      { kind: 'private', count: container.length - 1 },
      { kind: 'slave', count: 1 },
    ]);
    expect(summary.root?.type).toBe('overlay');
  });

  it('has nothing to say about an empty file', () => {
    expect(summarize([])).toMatchObject({ total: 0, binds: 0, readOnly: 0, root: undefined });
  });
});
