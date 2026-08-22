/**
 * Parser for `/proc/misc`.
 *
 * The devices registered with the misc character driver, written as `%3i %s`:
 *
 *     63 vhost-net
 *    229 fuse
 *
 * The number is a **minor only**. Every device here shares one major — 10 —
 * which is the whole point of the misc driver: a device too small to be worth
 * a major of its own gets a minor under the shared one instead. So `fuse` is
 * character device `10:229`, and this file never says the 10 (it is in
 * `/proc/devices`, against the name `misc`). See {@link MISC_MAJOR}.
 *
 * The minor also says where the number came from. The kernel keeps a pool of
 * {@link DYNAMIC_MINORS} for drivers that ask for `MISC_DYNAMIC_MINOR`, handed
 * out **downwards from 63**, so a minor in that range was assigned when the
 * driver registered and will differ between machines and between boots. A
 * minor above it was written into `include/linux/miscdevice.h` and is the same
 * everywhere. See {@link isDynamic}.
 *
 * The name is the misc device's own, which udev usually turns into
 * `/dev/<name>` — usually, not always: `device-mapper` appears as
 * `/dev/mapper/control`. Nothing here claims a path.
 *
 * The order is the kernel's list rather than anything sorted: a driver adds
 * itself at the head as it registers, so the file reads newest first.
 */

/** The major every device in this file sits under. */
export const MISC_MAJOR = 10;

/** Size of the pool of minors handed out to drivers that ask for any. */
export const DYNAMIC_MINORS = 64;

/** What the well-known devices are. Anything absent is still listed. */
export const DEVICES: Readonly<Record<string, string>> = {
  fuse: 'Filesystems implemented in userspace talk to the kernel through this',
  autofs: 'The automounter, which mounts a filesystem when something looks at its path',
  'device-mapper': 'The control device for LVM, dm-crypt and everything else built on dm',
  'loop-control': 'Adds and removes loop devices, rather than being one',
  'btrfs-control': 'Scans and registers btrfs devices before a filesystem is mounted',
  snapshot: 'The interface hibernation writes the memory image through',
  rfkill: 'Turns radios on and off, and reports which are blocked',
  tun: 'Creates the tun and tap interfaces a VPN or a hypervisor reads packets from',
  uinput: 'Lets a program create an input device and post events to it',
  kvm: 'The entry point for creating virtual machines',
  'vhost-net': 'Moves virtio network traffic in the kernel rather than through the hypervisor',
  'vhost-vsock': 'The host end of vsock, for talking to a guest without a network',
  vfio: 'Hands a device straight to a userspace driver or a guest, behind the IOMMU',
  hpet: 'The high precision event timer',
  hwrng: 'The hardware random number generator, when the machine has one',
  mcelog: 'Machine check exceptions — the CPU reporting its own faults',
  nvram: 'The handful of bytes of battery-backed CMOS memory',
  psaux: 'The PS/2 mouse port',
  rtc: 'The real time clock, on a kernel from before it had its own major',
  agpgart: 'The AGP graphics aperture, from when that was how a card saw memory',
  watchdog: 'The watchdog timer, which reboots the machine if nothing pets it',
  ecryptfs: 'The helper channel eCryptfs uses to ask userspace for keys',
  'cpu_dma_latency': 'A latency request: hold this open to keep the CPU out of deep idle states',
  'network_latency': 'The same, for how long the network stack may sleep',
  'network_throughput': 'The same, expressed as throughput rather than latency',
  vga_arbiter: 'Arbitrates between graphics cards that both want the legacy VGA resources',
  'memory_bandwidth': 'A bandwidth request, in the same family as the latency ones',
  userio: 'Feeds a serio device from userspace, for testing input drivers',
};

export interface MiscDevice {
  /** The minor under major 10. */
  minor: number;
  /** The name the driver registered, which is not always a path under /dev. */
  name: string;
}

export interface MiscInfo {
  devices: MiscDevice[];
}

/** ` 63 vhost-net` */
const LINE = /^\s*(\d+)\s+(\S.*?)\s*$/;

export function parseMisc(text: string): MiscInfo {
  const devices: MiscDevice[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = LINE.exec(line);
    if (match === null) continue;

    devices.push({ minor: Number(match[1]), name: match[2] ?? '' });
  }

  return { devices };
}

/** What the device is, or null for one this table has no note for. */
export function describeDevice(name: string): string | null {
  return DEVICES[name] ?? null;
}

/**
 * Whether the minor came out of the pool the kernel hands out at registration,
 * rather than being written into a header. Such a number is not stable across
 * machines or across boots.
 */
export function isDynamic(device: MiscDevice): boolean {
  return device.minor < DYNAMIC_MINORS;
}

/** The character device this is, major and minor together. */
export function deviceNumber(device: MiscDevice): string {
  return `${MISC_MAJOR}:${device.minor}`;
}

/** The devices with a minor fixed in the kernel's headers, lowest first. */
export function staticDevices(info: MiscInfo): MiscDevice[] {
  return info.devices.filter((device) => !isDynamic(device)).sort((a, b) => a.minor - b.minor);
}

/** The devices given a minor when they registered, highest first — the order they were handed out in reverse. */
export function dynamicDevices(info: MiscInfo): MiscDevice[] {
  return info.devices.filter((device) => isDynamic(device)).sort((a, b) => b.minor - a.minor);
}

export interface MiscSummary {
  total: number;
  dynamic: MiscDevice[];
  static: MiscDevice[];
  /** Minors left in the pool, if every dynamic one here came out of it. */
  poolFree: number;
  /** Devices this page has nothing to say about. */
  unknown: MiscDevice[];
}

export function summarize(info: MiscInfo): MiscSummary {
  const dynamic = dynamicDevices(info);

  return {
    total: info.devices.length,
    dynamic,
    static: staticDevices(info),
    poolFree: Math.max(0, DYNAMIC_MINORS - dynamic.length),
    unknown: info.devices.filter((device) => describeDevice(device.name) === null),
  };
}
