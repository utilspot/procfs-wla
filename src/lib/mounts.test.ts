import { describe, expect, it } from 'vitest';
import { readMountsFixture as fixture } from '../test/fixtures';
import { isPseudo, parseMounts, summarize, unescapePath } from './mounts';

describe('parseMounts — a laptop', () => {
  const mounts = parseMounts(fixture('laptop-btrfs'));

  it('reads every line', () => {
    expect(mounts).toHaveLength(27);
  });

  it('splits the six fields', () => {
    expect(mounts[5]).toEqual({
      device: '/dev/nvme0n1p2',
      mountPoint: '/',
      type: 'btrfs',
      options: ['rw', 'relatime', 'ssd', 'space_cache=v2', 'subvolid=257', 'subvol=/@'],
      dump: 0,
      pass: 0,
      readOnly: false,
    });
  });

  it('flags read-only mounts', () => {
    const backup = mounts.find((mount) => mount.mountPoint === '/mnt/backup');
    expect(backup?.readOnly).toBe(true);
    expect(mounts.find((mount) => mount.mountPoint === '/')?.readOnly).toBe(false);
  });

  it('summarizes types, root and read-only count', () => {
    const summary = summarize(mounts);

    expect(summary.total).toBe(27);
    expect(summary.root?.device).toBe('/dev/nvme0n1p2');
    expect(summary.readOnly).toBe(2);
    expect(summary.types[0]).toEqual({ type: 'tmpfs', count: 4 });
  });

  it('knows which types are kernel pseudo-filesystems', () => {
    expect(isPseudo(mounts.find((mount) => mount.type === 'proc')!)).toBe(true);
    expect(isPseudo(mounts.find((mount) => mount.type === 'btrfs')!)).toBe(false);
  });
});

describe('parseMounts — a container', () => {
  const mounts = parseMounts(fixture('container-overlay'));

  it('keeps a long overlay option list intact', () => {
    const root = mounts[0]!;
    expect(root.type).toBe('overlay');
    expect(root.options).toContain('rw');
    expect(root.options.some((option) => option.startsWith('lowerdir='))).toBe(true);
  });

  it('counts the read-only mounts a container has', () => {
    expect(summarize(mounts).readOnly).toBe(8);
  });
});

describe('parseMounts — escaped paths', () => {
  const mounts = parseMounts(fixture('escaped-paths'));

  it('unescapes spaces in the device and the mount point', () => {
    const cifs = mounts.find((mount) => mount.type === 'cifs')!;
    expect(cifs.device).toBe('//nas.local/Shared Media');
    expect(cifs.mountPoint).toBe('/mnt/nas/Shared Media');
  });

  it('unescapes tabs and backslashes', () => {
    expect(mounts.map((mount) => mount.mountPoint)).toContain('/mnt/tab\tseparated');
    expect(mounts.map((mount) => mount.mountPoint)).toContain('/mnt/back\\slash');
  });

  it('still splits fields correctly around an escaped space', () => {
    const passport = mounts.find((mount) => mount.mountPoint === '/mnt/My Passport')!;
    expect(passport.device).toBe('/dev/sdb1');
    expect(passport.type).toBe('exfat');
  });
});

describe('parseMounts — a minimal system', () => {
  it('handles short option lists and a missing device path', () => {
    const mounts = parseMounts(fixture('minimal'));

    expect(mounts).toHaveLength(4);
    expect(mounts[0]).toMatchObject({ device: 'rootfs', mountPoint: '/', options: ['rw'] });
    expect(summarize(mounts).readOnly).toBe(0);
  });
});

describe('unescapePath', () => {
  it('translates the four escapes the kernel emits', () => {
    expect(unescapePath('a\\040b')).toBe('a b');
    expect(unescapePath('a\\011b')).toBe('a\tb');
    expect(unescapePath('a\\012b')).toBe('a\nb');
    expect(unescapePath('a\\134b')).toBe('a\\b');
  });

  it('leaves other backslash sequences alone', () => {
    expect(unescapePath('/mnt/c\\999d')).toBe('/mnt/c\\999d');
    expect(unescapePath('/plain/path')).toBe('/plain/path');
  });
});

describe('parseMounts — edge cases', () => {
  it('returns nothing for an empty file', () => {
    expect(parseMounts('')).toEqual([]);
    expect(parseMounts('\n\n')).toEqual([]);
  });

  it('skips lines too short to be a mount', () => {
    expect(parseMounts('/dev/sda1 /\nproc /proc proc rw 0 0\n')).toHaveLength(1);
  });

  it('tolerates a missing dump and pass', () => {
    const [mount] = parseMounts('proc /proc proc rw');
    expect(mount).toMatchObject({ dump: 0, pass: 0, options: ['rw'] });
  });

  it('handles CRLF line endings', () => {
    expect(parseMounts('proc /proc proc rw 0 0\r\n')[0]?.type).toBe('proc');
  });
});
