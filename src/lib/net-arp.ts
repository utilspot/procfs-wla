/**
 * Parser for `/proc/<pid>/net/arp` — the IPv4 neighbour table of the network
 * namespace this process is in.
 *
 * A header line, then one line per neighbour, six columns wide:
 *
 *   IP address       HW type     Flags       HW address            Mask     Device
 *   192.168.1.1      0x1         0x2         3c:22:fb:1a:2b:3c     *        wlan0
 *   192.168.1.44     0x1         0x0         00:00:00:00:00:00     *        wlan0
 *
 * The address, the hardware type of the interface it was learnt on, the flags,
 * the hardware address it resolved to, a mask, and the interface.
 *
 * **The file belongs to a network namespace, not to a process.** `/proc/net` is
 * a symbolic link to `self/net`, so `/proc/net/arp` is this file read for
 * whoever is asking; reading one *process's* copy is how you see the table of
 * the namespace that process is in. Two processes sharing a namespace give
 * byte-identical answers, and a container's pid gives a table with the host's
 * neighbours nowhere in it. That is the whole reason this page reads a pid.
 *
 * Three things in it read wrong at first glance:
 *
 * - **The flags are a lossy summary of the neighbour state.**
 *   `arp_state_to_flags` in `net/ipv4/arp.c` prints {@link ATF_PERM} |
 *   {@link ATF_COM} for a permanent entry, {@link ATF_COM} for any valid one,
 *   and nothing at all otherwise. So `REACHABLE`, `STALE`, `DELAY` and `PROBE`
 *   all print `0x2`, while `INCOMPLETE` and `FAILED` both print `0x0` — this
 *   file cannot tell an address that is answering from one that answered four
 *   minutes ago, and `ip neigh` is where those states survive.
 * - **The `Mask` column is vestigial.** It is printed as a literal `*` for every
 *   entry; the netmask it once held belonged to proxy entries and went with
 *   {@link ATF_NETMASK}. Anything else here is a kernel old enough that the
 *   column still meant something.
 * - **Entries on `NOARP` devices are missing on purpose.** `arp_seq_start`
 *   passes `NEIGH_SEQ_SKIP_NOARP` — its comment is "Don't want to confuse
 *   `arp -a` w/ magic entries" — so loopback and most tunnels never appear
 *   however much traffic goes over them.
 *
 * It is IPv4 only, and there is no `net/arp` for IPv6: the neighbours found by
 * NDP live in the same kernel table but are reachable only through netlink,
 * which is what `ip -6 neigh` reads. A page's worth of a machine's neighbours
 * can be missing from here for that reason alone.
 *
 * Proxy entries come from a different table and are printed by the same loop:
 * {@link ATF_PUBL} | {@link ATF_PERM}, an all-zero hardware address, and `*`
 * for the device when the entry is not bound to one.
 */

/** ARP flag values, `ATF_*` in `include/uapi/linux/if_arp.h`. */
export const ATF_COM = 0x02;
export const ATF_PERM = 0x04;
export const ATF_PUBL = 0x08;
export const ATF_USETRAILERS = 0x10;
export const ATF_NETMASK = 0x20;
export const ATF_DONTPUB = 0x40;

/** The `Mask` column as every kernel in service prints it. */
export const NO_MASK = '*';

/** What an unresolved entry holds where its hardware address would go. */
export const UNSPECIFIED_HW = '00:00:00:00:00:00';

export interface ArpEntry {
  /** The neighbour's IPv4 address, as printed. */
  ip: string;
  /** `ARPHRD_*` of the interface — 1 for Ethernet, which is nearly always it. */
  hwType: number;
  /** The `ATF_*` bits, which are {@link ATF_COM} and friends. */
  flags: number;
  /** The hardware address it resolved to, or all zeroes where it did not. */
  hwAddress: string;
  /** The `Mask` column verbatim, which is {@link NO_MASK} on any live kernel. */
  mask: string;
  /** Interface the neighbour is on, or `*` for a proxy entry bound to none. */
  device: string;
}

/** `192.168.1.1 0x1 0x2 3c:22:fb:1a:2b:3c * wlan0` */
const LINE = /^(\d+\.\d+\.\d+\.\d+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/i;

/**
 * The neighbours in the file.
 *
 * The header is skipped by not matching: a line has to start with a dotted
 * quad to be an entry, which is the one thing the header line cannot do.
 */
export function parseNetArp(text: string): ArpEntry[] {
  const entries: ArpEntry[] = [];

  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match === null) continue;

    const [, ip, hwType, flags, hwAddress, mask, device] = match;

    entries.push({
      ip: ip!,
      hwType: Number.parseInt(hwType!, 16),
      flags: Number.parseInt(flags!, 16),
      hwAddress: hwAddress!.toLowerCase(),
      mask: mask!,
      device: device!,
    });
  }

  return entries;
}

/** Whether the kernel resolved this address, i.e. the hardware address is real. */
export function isComplete(entry: ArpEntry): boolean {
  return (entry.flags & ATF_COM) !== 0;
}

/**
 * Whether nothing answered. The kernel prints `0x0` both for an entry it is
 * still asking about and for one it gave up on, so this is as far as the file
 * goes: `ip neigh` is where `INCOMPLETE` and `FAILED` are told apart.
 */
export function isIncomplete(entry: ArpEntry): boolean {
  return !isComplete(entry) && !isProxy(entry);
}

/** A static entry — `arp -s`, or `ip neigh add ... nud permanent`. */
export function isPermanent(entry: ArpEntry): boolean {
  return (entry.flags & ATF_PERM) !== 0;
}

/**
 * A **proxy** entry: this machine answers ARP for an address that is not its
 * own, so packets for it come here to be forwarded. Printed from the `pneigh`
 * table rather than the neighbour table, which is why it carries no hardware
 * address of its own.
 */
export function isProxy(entry: ArpEntry): boolean {
  return (entry.flags & ATF_PUBL) !== 0;
}

/** Whether the hardware address column holds nothing but zeroes. */
export function isUnresolved(entry: ArpEntry): boolean {
  return entry.hwAddress === UNSPECIFIED_HW;
}

/**
 * Whether the address was made up rather than assigned: the second bit of the
 * first octet is the locally-administered bit, which is set on a randomised
 * wifi address and on virtual interfaces the machine invents — `veth`, `virbr`,
 * a container's end of a pair.
 */
export function isLocallyAdministered(entry: ArpEntry): boolean {
  const first = Number.parseInt(entry.hwAddress.slice(0, 2), 16);
  return !Number.isNaN(first) && !isUnresolved(entry) && (first & 0x02) !== 0;
}

/**
 * Whether the hardware address is a multicast one, which a neighbour's address
 * cannot legitimately be: the low bit of the first octet is the group bit, and
 * an entry with it set is answering for a group rather than for a machine.
 */
export function isMulticastHw(entry: ArpEntry): boolean {
  const first = Number.parseInt(entry.hwAddress.slice(0, 2), 16);
  return !Number.isNaN(first) && !isUnresolved(entry) && (first & 0x01) !== 0;
}

/** Whether the `Mask` column holds anything but the `*` a live kernel prints. */
export function hasMask(entry: ArpEntry): boolean {
  return entry.mask !== NO_MASK;
}

/** The `ATF_*` bits this kernel prints, by name, lowest bit first. */
const FLAGS: { bit: number; name: string; what: string }[] = [
  {
    bit: ATF_COM,
    name: 'ATF_COM',
    what: 'complete — a hardware address was learnt, so the entry can be used',
  },
  {
    bit: ATF_PERM,
    name: 'ATF_PERM',
    what: 'permanent — set by hand and never aged out by the kernel',
  },
  {
    bit: ATF_PUBL,
    name: 'ATF_PUBL',
    what: 'published — this machine answers ARP for the address on somebody else’s behalf',
  },
  {
    bit: ATF_USETRAILERS,
    name: 'ATF_USETRAILERS',
    what: 'trailers requested — a 4.3BSD encapsulation Linux has not spoken for decades',
  },
  {
    bit: ATF_NETMASK,
    name: 'ATF_NETMASK',
    what: 'the Mask column is a netmask — proxy entries only, and long since removed',
  },
  {
    bit: ATF_DONTPUB,
    name: 'ATF_DONTPUB',
    what: 'do not answer for this address, which is a proxy entry saying no',
  },
];

/** The names of the bits set in a flags field. */
export function flagNames(flags: number): string[] {
  return FLAGS.filter((flag) => (flags & flag.bit) !== 0).map((flag) => flag.name);
}

/** What one named flag means, for the reader who has not got `if_arp.h` open. */
export function describeFlag(name: string): string {
  return FLAGS.find((flag) => flag.name === name)?.what ?? 'a flag this page has no name for';
}

/** The flags a kernel never sets here, which are the ones worth pointing at. */
export function unexpectedFlags(entry: ArpEntry): string[] {
  return flagNames(entry.flags & (ATF_USETRAILERS | ATF_NETMASK | ATF_DONTPUB));
}

/**
 * The `ARPHRD_*` types that can turn up in an IPv4 neighbour table. Ethernet is
 * nearly all of it — wifi and the virtual interfaces both present as Ethernet
 * to the neighbour layer, so the column says less than its width suggests.
 */
const HW_TYPES: Record<number, string> = {
  0: 'NETROM',
  1: 'Ethernet',
  3: 'AX.25',
  6: 'IEEE 802',
  7: 'ARCnet',
  15: 'Frame Relay DLCI',
  19: 'ATM',
  23: 'Metricom',
  24: 'IEEE 1394 (FireWire)',
  27: 'EUI-64',
  32: 'InfiniBand',
  256: 'SLIP',
  512: 'PPP',
  768: 'IPIP tunnel',
  769: 'IP6IP6 tunnel',
  772: 'Loopback',
  774: 'FDDI',
  776: 'SIT tunnel',
  778: 'GRE tunnel',
  780: 'HIPPI',
  801: 'IEEE 802.11',
  804: 'IEEE 802.15.4',
  823: 'IP6GRE tunnel',
  825: '6LoWPAN',
  65534: 'none',
};

/** What the hardware type is, or null for one this page has no name for. */
export function hwTypeName(type: number): string | null {
  return HW_TYPES[type] ?? null;
}

/** The type as the file prints it: `0x1`, which is how it is written down. */
export function hwTypeHex(type: number): string {
  return `0x${type.toString(16)}`;
}

/** One interface's share of the table. */
export interface DeviceCount {
  device: string;
  /** Entries on it, proxy entries included. */
  count: number;
  /** Of those, how many nothing answered for. */
  incomplete: number;
}

/**
 * One hardware address that several addresses resolve to.
 *
 * Ordinary on a router — one gateway answering for a subnet it forwards for —
 * and ordinary on a host with several addresses on one interface. Worth
 * showing rather than warning about: it is the shape of proxy ARP, and it is
 * also the shape of two machines fighting over an address.
 */
export interface SharedHardware {
  hwAddress: string;
  ips: string[];
  devices: string[];
}

export interface ArpSummary {
  /** Every line, proxy entries included. */
  total: number;
  /** Entries a hardware address was learnt for. */
  complete: number;
  /** Entries nothing answered for. */
  incomplete: number;
  permanent: number;
  proxy: number;
  /** Interfaces the entries are spread over, busiest first. */
  devices: DeviceCount[];
  /** Hardware types in use, most used first — nearly always Ethernet alone. */
  hwTypes: { type: number; count: number }[];
  /** Addresses several neighbours share. See {@link SharedHardware}. */
  shared: SharedHardware[];
  /** Entries whose `Mask` column is not the `*` a live kernel prints. */
  masked: ArpEntry[];
}

export function summarize(entries: readonly ArpEntry[]): ArpSummary {
  const devices = new Map<string, DeviceCount>();
  const types = new Map<number, number>();
  const byHardware = new Map<string, ArpEntry[]>();

  for (const entry of entries) {
    const device = devices.get(entry.device) ?? { device: entry.device, count: 0, incomplete: 0 };
    device.count += 1;
    if (isIncomplete(entry)) device.incomplete += 1;
    devices.set(entry.device, device);

    types.set(entry.hwType, (types.get(entry.hwType) ?? 0) + 1);

    // An unresolved entry has the same all-zero address as every other one, so
    // grouping on it would say a dozen neighbours share a machine.
    if (!isUnresolved(entry)) {
      byHardware.set(entry.hwAddress, [...(byHardware.get(entry.hwAddress) ?? []), entry]);
    }
  }

  const shared = [...byHardware]
    .filter(([, group]) => new Set(group.map((entry) => entry.ip)).size > 1)
    .map(([hwAddress, group]) => ({
      hwAddress,
      ips: [...new Set(group.map((entry) => entry.ip))],
      devices: [...new Set(group.map((entry) => entry.device))],
    }))
    .sort((a, b) => b.ips.length - a.ips.length || a.hwAddress.localeCompare(b.hwAddress));

  return {
    total: entries.length,
    complete: entries.filter(isComplete).length,
    incomplete: entries.filter(isIncomplete).length,
    permanent: entries.filter(isPermanent).length,
    proxy: entries.filter(isProxy).length,
    devices: [...devices.values()].sort(
      (a, b) => b.count - a.count || a.device.localeCompare(b.device),
    ),
    hwTypes: [...types]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type - b.type),
    shared,
    masked: entries.filter(hasMask),
  };
}

/**
 * How full the table is against `gc_thresh3`, the hard cap on entries in
 * `/proc/sys/net/ipv4/neigh/default/gc_thresh3`. Past it the kernel refuses to
 * add neighbours and logs "neighbour table overflow", which on a machine
 * talking to a large flat network is a real failure and not a tuning nicety.
 */
export const GC_THRESH3 = 1024;

/** Whether the table is close enough to the default cap to be worth saying so. */
export function isCrowded(entries: readonly ArpEntry[]): boolean {
  return entries.length >= GC_THRESH3 * 0.75;
}
