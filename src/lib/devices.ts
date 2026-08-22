/**
 * Parser for `/proc/devices`.
 *
 * Two sections, each a header line and then `<major> <name>` lines:
 *
 *   Character devices:
 *     1 mem
 *     4 /dev/vc/0
 *     4 tty
 *     4 ttyS
 *   ...
 *
 *   Block devices:
 *     8 sd
 *   259 blkext
 *
 * The mapping is many-to-many in both directions, which is the thing to
 * understand when reading it: one major can be shared by several drivers
 * (`4` is `/dev/vc/0`, `tty` and `ttyS`), and one driver can hold several
 * majors (`sd` holds 8 and 65–71 to get past 256 minors). Character and block
 * majors are separate number spaces, so char 8 and block 8 are unrelated.
 *
 * The file lists only the *names* registered against each major; it says
 * nothing about which devices actually exist.
 */

export type DeviceKind = 'character' | 'block';

export interface Device {
  major: number;
  name: string;
  kind: DeviceKind;
}

export interface Devices {
  character: Device[];
  block: Device[];
}

/** `Character devices:` / `Block devices:`, however the kernel cases them. */
const HEADERS: { pattern: RegExp; kind: DeviceKind }[] = [
  { pattern: /^character\s+devices:/i, kind: 'character' },
  { pattern: /^block\s+devices:/i, kind: 'block' },
];

/** `  4 ttyS` — a major and the name registered against it. */
const ENTRY = /^\s*(\d+)\s+(\S+)\s*$/;

export function parseDevices(text: string): Devices {
  const devices: Devices = { character: [], block: [] };
  let kind: DeviceKind | null = null;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const header = HEADERS.find(({ pattern }) => pattern.test(line.trim()));
    if (header !== undefined) {
      kind = header.kind;
      continue;
    }

    // Entries before any header belong to no section, and a line that is
    // neither a header nor an entry is left alone.
    const match = ENTRY.exec(line);
    if (match === null || kind === null) continue;

    devices[kind].push({ major: Number(match[1]), name: match[2]!, kind });
  }

  return devices;
}

/** One major, with every driver name registered against it. */
export interface MajorGroup {
  major: number;
  names: string[];
}

/**
 * Groups a section by major, in numeric order. Several drivers sharing a major
 * is normal — major 4 carries the virtual consoles and the serial lines — and
 * reads far better grouped than as one row each.
 */
export function byMajor(devices: readonly Device[]): MajorGroup[] {
  const groups = new Map<number, string[]>();

  for (const device of devices) {
    const names = groups.get(device.major);
    if (names === undefined) groups.set(device.major, [device.name]);
    else if (!names.includes(device.name)) names.push(device.name);
  }

  return [...groups]
    .map(([major, names]) => ({ major, names }))
    .sort((a, b) => a.major - b.major);
}

/**
 * Ranges the kernel sets aside for local and experimental use, from
 * `Documentation/admin-guide/devices.txt`. A driver here has not been assigned
 * a number centrally, which is worth pointing out but is not a problem.
 */
const LOCAL_RANGES = [
  [60, 63],
  [120, 127],
  [240, 254],
] as const;

export function isLocal(major: number): boolean {
  return LOCAL_RANGES.some(([low, high]) => major >= low && major <= high);
}

export interface DevicesSummary {
  /** Registered names, i.e. lines in the file. */
  total: number;
  characterMajors: number;
  blockMajors: number;
  /** Majors carrying more than one driver name. */
  shared: MajorGroup[];
  /**
   * Names registered against more than one major, per section — `sd` holds
   * eight of them. Keyed by name, most majors first.
   */
  spread: { name: string; kind: DeviceKind; majors: number[] }[];
  /** Names sitting in the local/experimental ranges. */
  local: Device[];
}

export function summarize(devices: Devices): DevicesSummary {
  const all = [...devices.character, ...devices.block];

  const spread = new Map<string, { name: string; kind: DeviceKind; majors: number[] }>();
  for (const device of all) {
    const key = `${device.kind}:${device.name}`;
    const entry = spread.get(key);
    if (entry === undefined) {
      spread.set(key, { name: device.name, kind: device.kind, majors: [device.major] });
    } else if (!entry.majors.includes(device.major)) {
      entry.majors.push(device.major);
    }
  }

  return {
    total: all.length,
    characterMajors: byMajor(devices.character).length,
    blockMajors: byMajor(devices.block).length,
    shared: [...byMajor(devices.character), ...byMajor(devices.block)].filter(
      (group) => group.names.length > 1,
    ),
    spread: [...spread.values()]
      .filter((entry) => entry.majors.length > 1)
      .sort((a, b) => b.majors.length - a.majors.length || a.name.localeCompare(b.name)),
    local: all.filter((device) => isLocal(device.major)),
  };
}
