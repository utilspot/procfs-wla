/**
 * Parser for `/proc/filesystems`.
 *
 * The filesystems the kernel can mount at the moment, one per line, written as
 * `%s\t%s` where the first field is `nodev` or nothing at all:
 *
 *    nodev	proc
 *    	ext4
 *
 * This is what is **registered** — built into the kernel, or brought in by a
 * module — not what is mounted, and not what the kernel could load a module
 * for on demand. A type missing here can still be mounted if its module is
 * autoloaded by the mount itself.
 *
 * `nodev` means only that the filesystem **needs no block device**, which
 * covers two quite different things: the virtual filesystems the kernel makes
 * up as it goes (`proc`, `sysfs`, `tmpfs`) and the network ones that get their
 * data from a server (`nfs`, `cifs`, `ceph`). The file does not distinguish
 * them, so {@link NETWORK_FILESYSTEMS} is a known list rather than anything
 * read out of the file — see {@link kindOf}.
 *
 * The order is registration order, not alphabetical: the entries built into
 * the kernel come first, roughly as it initialised them, and anything from a
 * module loaded later sits at the end. It is also the order `mount(8)` works
 * through when it is not given a `-t`, skipping the `nodev` entries because a
 * block device cannot be one of them.
 */

/** What the kernel prints for a filesystem that needs no block device. */
export const NODEV = 'nodev';

/**
 * Filesystems whose data comes from a server rather than from local storage.
 * They are `nodev` like the virtual ones, and the file gives nothing to tell
 * the two apart, so this is a known list: a name that is not on it and needs
 * no device is read as virtual.
 */
export const NETWORK_FILESYSTEMS: ReadonlySet<string> = new Set([
  '9p',
  'afs',
  'ceph',
  'cifs',
  'coda',
  'lustre',
  'ncpfs',
  'nfs',
  'nfs4',
  'orangefs',
  'smb3',
  'smbfs',
]);

/**
 * Filesystems the kernel registers for its own use and mounts internally. They
 * are listed like any other, but a `mount` of one from userspace fails — again
 * a known handful, since the file does not say so.
 */
export const INTERNAL_FILESYSTEMS: ReadonlySet<string> = new Set([
  'anon_inodefs',
  'bdev',
  'dax',
  'mtd_inodefs',
  'nsfs',
  'pipefs',
  'rootfs',
  'sockfs',
]);

export interface Filesystem {
  name: string;
  /** True when the line had no `nodev`, so a mount of it needs a device. */
  requiresDevice: boolean;
}

export interface FilesystemsInfo {
  filesystems: Filesystem[];
}

export function parseFilesystems(text: string): FilesystemsInfo {
  const filesystems: Filesystem[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    // Either `nodev\t<name>` or `\t<name>`; splitting on whitespace loses
    // which it was, so the first field is read before the name.
    const fields = line.trim().split(/\s+/);
    const nodev = fields[0] === NODEV;
    const name = nodev ? fields[1] : fields[0];

    if (name === undefined || name === '') continue;
    // A line with a first field that is neither `nodev` nor the name itself is
    // not this file's shape.
    if (!nodev && fields.length > 1) continue;

    filesystems.push({ name, requiresDevice: !nodev });
  }

  return { filesystems };
}

export type FilesystemKind = 'device' | 'network' | 'virtual';

/** Whether the data comes from a block device, a server, or the kernel. */
export function kindOf(filesystem: Filesystem): FilesystemKind {
  if (filesystem.requiresDevice) return 'device';
  return NETWORK_FILESYSTEMS.has(filesystem.name) ? 'network' : 'virtual';
}

/** Registered for the kernel's own use; a mount from userspace fails. */
export function isInternal(filesystem: Filesystem): boolean {
  return INTERNAL_FILESYSTEMS.has(filesystem.name);
}

/**
 * The filesystems `mount(8)` tries, in the order it tries them, when it is
 * given no `-t`: the ones needing a block device, since that is what it is
 * mounting.
 */
export function mountOrder(info: FilesystemsInfo): Filesystem[] {
  return info.filesystems.filter((filesystem) => filesystem.requiresDevice);
}

export interface FilesystemsSummary {
  total: number;
  device: Filesystem[];
  network: Filesystem[];
  virtual: Filesystem[];
  internal: Filesystem[];
}

export function summarize(info: FilesystemsInfo): FilesystemsSummary {
  const of = (kind: FilesystemKind) =>
    info.filesystems.filter((filesystem) => kindOf(filesystem) === kind);

  return {
    total: info.filesystems.length,
    device: of('device'),
    network: of('network'),
    virtual: of('virtual'),
    internal: info.filesystems.filter((filesystem) => isInternal(filesystem)),
  };
}
