/**
 * Parser for `/proc/mounts`.
 *
 * Each line is six space-separated fields:
 *
 *   <device> <mount point> <type> <options> <dump> <pass>
 *
 * The kernel escapes space, tab, newline and backslash in the device and mount
 * point as octal (`\040`, `\011`, `\012`, `\134`), so those two fields are
 * unescaped here — `/mnt/My\040Passport` is really `/mnt/My Passport`.
 */

export interface Mount {
  device: string;
  mountPoint: string;
  type: string;
  options: string[];
  dump: number;
  pass: number;
  /** True when the mount is read-only, i.e. its options start with `ro`. */
  readOnly: boolean;
}

const ESCAPES: Record<string, string> = {
  '040': ' ',
  '011': '\t',
  '012': '\n',
  '134': '\\',
};

/** Turns the kernel's octal escapes back into the characters they stand for. */
export function unescapePath(value: string): string {
  return value.replace(/\\(\d{3})/g, (match, octal: string) => ESCAPES[octal] ?? match);
}

export function parseMounts(text: string): Mount[] {
  const mounts: Mount[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const [device, mountPoint, type, options, dump, pass] = trimmed.split(/\s+/);
    // A mount needs at least a device, a place to be, and a type.
    if (device === undefined || mountPoint === undefined || type === undefined) continue;

    const optionList = (options ?? '').split(',').filter((option) => option !== '');

    mounts.push({
      device: unescapePath(device),
      mountPoint: unescapePath(mountPoint),
      type,
      options: optionList,
      dump: Number(dump ?? 0) || 0,
      pass: Number(pass ?? 0) || 0,
      readOnly: optionList.includes('ro'),
    });
  }

  return mounts;
}

export interface MountsSummary {
  total: number;
  readOnly: number;
  /** Filesystem types with how many mounts use each, most used first. */
  types: { type: string; count: number }[];
  /** The device mounted at `/`, when there is one. */
  root: Mount | undefined;
}

export function summarize(mounts: readonly Mount[]): MountsSummary {
  const counts = new Map<string, number>();
  for (const mount of mounts) {
    counts.set(mount.type, (counts.get(mount.type) ?? 0) + 1);
  }

  return {
    total: mounts.length,
    readOnly: mounts.filter((mount) => mount.readOnly).length,
    types: [...counts]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    root: mounts.find((mount) => mount.mountPoint === '/'),
  };
}

/**
 * Pseudo-filesystems the kernel provides rather than something you mounted.
 * Used only to de-emphasise them in the list.
 */
const PSEUDO_TYPES = new Set([
  'autofs',
  'binfmt_misc',
  'bpf',
  'cgroup',
  'cgroup2',
  'configfs',
  'debugfs',
  'devpts',
  'devtmpfs',
  'efivarfs',
  'fusectl',
  'hugetlbfs',
  'mqueue',
  'proc',
  'pstore',
  'ramfs',
  'rootfs',
  'securityfs',
  'sysfs',
  'tmpfs',
  'tracefs',
]);

export function isPseudo(mount: Mount): boolean {
  return PSEUDO_TYPES.has(mount.type);
}
