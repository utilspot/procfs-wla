/**
 * Parser for `/proc/<pid>/net/dev` — every network interface in this process's
 * network namespace, and what has gone through it since it came up.
 *
 * Two header lines, then one line per interface, sixteen counters wide:
 *
 *   Inter-|   Receive                                                |  Transmit
 *    face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
 *       lo: 43472605   23758    0    0    0     0          0         0 43472605   23758    0    0    0     0       0          0
 *   enp0s3: 151908077  432575    0    0    0     0          0       383 634525451  683148    0    0    0     0       0          0
 *
 * `dev_seq_printf_stats` in `net/core/net-procfs.c` prints the name with
 * `"%6s: "`, so **a name of six characters or more leaves no space in front of
 * the colon**, and nothing truncates it — `br-1a2b3c4d5e6f:` runs the whole way
 * over the column and pushes the rest of its line right. That is not an exotic
 * case: `enp0s3` is exactly six and `docker0` is seven, so the columns stop
 * lining up on an ordinary machine.
 *
 * What that costs is alignment, not data. The format puts a literal space after
 * the colon and between every counter, so the sixteen numbers stay separated
 * however long the name or the numbers get — a whitespace split keeps all
 * sixteen, with the colon stuck to the name. What it breaks is reading the file
 * by **fixed columns**, and any pattern expecting whitespace in front of the
 * colon. This takes the name as everything before the first colon and splits
 * the rest on whitespace, which holds either way. See {@link parseNetDev}.
 *
 * Three things in it read wrong:
 *
 * - **Two of the sixteen are not errors.** `multicast` counts multicast packets
 *   *received* — an ordinary number on any machine that hears mDNS or IPv6
 *   router advertisements — and `compressed` counts frames a header-compressing
 *   link handled, which on anything that is not PPP or SLIP stays zero forever.
 *   Both sit inside the error columns and read as faults.
 * - **Four of them are several kernel counters added together.** `frame` is
 *   `rx_length_errors + rx_over_errors + rx_crc_errors + rx_frame_errors`, so a
 *   number there could be a bad cable, a duplex mismatch, or a runt frame, and
 *   this file cannot say which; `drop` on the receive side folds in
 *   `rx_missed_errors`, and `carrier` on the transmit side is four more.
 *   {@link BUCKETS} says which, and `ip -s link` — or the driver's own
 *   `ethtool -S` — is where they come apart again.
 * - **Every registered interface is listed, up or down.** A line here says the
 *   kernel has the device, not that it is carrying anything, and an interface
 *   that has never been up reads as a row of zeroes rather than as absent.
 *
 * The file belongs to a **network namespace** rather than to the process:
 * `/proc/net` is a link to `self/net`, so naming a pid reads the table of the
 * namespace that process is in. A container's pid shows its `lo` and one end of
 * a veth pair, and nothing of the host's.
 *
 * The counters are 64-bit — `rtnl_link_stats64` — so the wrapping that made
 * this file useless on a busy 32-bit machine is history, though a driver
 * keeping its own 32-bit counters can still hand up a number that has.
 */

export interface Receive {
  bytes: number;
  packets: number;
  errs: number;
  /** `rx_dropped + rx_missed_errors`. */
  drop: number;
  fifo: number;
  /** Four counters in a trench coat — see {@link BUCKETS}. */
  frame: number;
  /** Frames a header-compressing link handled. Not an error. */
  compressed: number;
  /** Multicast packets received. Not an error. */
  multicast: number;
}

export interface Transmit {
  bytes: number;
  packets: number;
  errs: number;
  drop: number;
  fifo: number;
  /** Collisions, which a full-duplex link cannot have. */
  colls: number;
  /** `tx_carrier_errors` plus three more — see {@link BUCKETS}. */
  carrier: number;
  compressed: number;
}

export interface Interface {
  name: string;
  rx: Receive;
  tx: Transmit;
}

/** How many counters a line holds, which is what makes it a line. */
const COUNTERS = 16;

/**
 * The interfaces in the file.
 *
 * A line is split on its **first colon**: the name is printed `%6s:`, so on
 * most lines of a real file there is no space in front of it to split on
 * instead. Both header lines are skipped by holding no colon with sixteen
 * numbers after it, so nothing here has to recognise them.
 */
export function parseNetDev(text: string): Interface[] {
  const interfaces: Interface[] = [];

  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const name = line.slice(0, colon).trim();
    if (name === '') continue;

    const numbers = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .map(Number);

    // Sixteen counters, all of them numbers, or it is not one of these lines.
    if (numbers.length !== COUNTERS || numbers.some((value) => !Number.isFinite(value))) continue;

    const [
      rxBytes,
      rxPackets,
      rxErrs,
      rxDrop,
      rxFifo,
      rxFrame,
      rxCompressed,
      multicast,
      txBytes,
      txPackets,
      txErrs,
      txDrop,
      txFifo,
      colls,
      carrier,
      txCompressed,
    ] = numbers as number[];

    interfaces.push({
      name,
      rx: {
        bytes: rxBytes!,
        packets: rxPackets!,
        errs: rxErrs!,
        drop: rxDrop!,
        fifo: rxFifo!,
        frame: rxFrame!,
        compressed: rxCompressed!,
        multicast: multicast!,
      },
      tx: {
        bytes: txBytes!,
        packets: txPackets!,
        errs: txErrs!,
        drop: txDrop!,
        fifo: txFifo!,
        colls: colls!,
        carrier: carrier!,
        compressed: txCompressed!,
      },
    });
  }

  return interfaces;
}

/**
 * The columns that are a sum of several kernel counters, and what goes into
 * each. A number in one of these is a bucket rather than a diagnosis.
 */
export const BUCKETS: Record<string, string[]> = {
  'rx drop': ['rx_dropped', 'rx_missed_errors'],
  'rx frame': ['rx_length_errors', 'rx_over_errors', 'rx_crc_errors', 'rx_frame_errors'],
  'tx carrier': [
    'tx_carrier_errors',
    'tx_aborted_errors',
    'tx_window_errors',
    'tx_heartbeat_errors',
  ],
};

/** Whether this is the loopback interface, whose two sides are one traffic. */
export function isLoopback(iface: Interface): boolean {
  return iface.name === 'lo';
}

/** Whether nothing has ever gone either way through it. */
export function isIdle(iface: Interface): boolean {
  return iface.rx.packets === 0 && iface.tx.packets === 0;
}

/** Everything the file counts as an error, on both sides. */
export function errorsOf(iface: Interface): number {
  return (
    iface.rx.errs +
    iface.rx.drop +
    iface.rx.fifo +
    iface.rx.frame +
    iface.tx.errs +
    iface.tx.drop +
    iface.tx.fifo +
    iface.tx.colls +
    iface.tx.carrier
  );
}

export function hasErrors(iface: Interface): boolean {
  return errorsOf(iface) > 0;
}

/**
 * Bad frames as a share of what arrived, which is the number worth looking at
 * rather than the count: a thousand bad frames in a billion is a link doing its
 * job, and a thousand in ten thousand is a cable to go and look at.
 */
export function errorRate(iface: Interface): number {
  const total = iface.rx.packets + iface.rx.errs + iface.rx.frame;
  return total === 0 ? 0 : (iface.rx.errs + iface.rx.frame) / total;
}

/**
 * The width the name is padded to, `%6s`. Six is low enough that ordinary names
 * reach it — `enp0s3` fills it exactly and `docker0` overruns it — which is why
 * the colon has no space in front of it on most lines of a real file.
 */
export const NAME_WIDTH = 6;

export function isNameGlued(iface: Interface): boolean {
  return iface.name.length >= NAME_WIDTH;
}

/**
 * Collisions, which only a half-duplex link can have. Every switched link since
 * about 2000 is full duplex, so a number here is either a hub, a duplex
 * mismatch, or a driver counting something else in the field.
 */
export function hasCollisions(iface: Interface): boolean {
  return iface.tx.colls > 0;
}

/** Whether a header-compressing link — PPP, SLIP — has been at work. */
export function isCompressing(iface: Interface): boolean {
  return iface.rx.compressed > 0 || iface.tx.compressed > 0;
}

export interface NetDevSummary {
  total: number;
  /** Bytes received across every interface, loopback included. */
  rxBytes: number;
  txBytes: number;
  /** The busiest interface by bytes either way, loopback aside. */
  busiest: Interface | undefined;
  /** Interfaces nothing has gone through. */
  idle: Interface[];
  /** Interfaces with anything in an error column. */
  faulty: Interface[];
  /** Interfaces whose name filled or overran the column, so the colon is glued. */
  glued: Interface[];
  /** The longest of those, which is the one worth naming. */
  widest: Interface | undefined;
  /** The loopback interface, where the namespace has one. */
  loopback: Interface | undefined;
}

export function summarize(interfaces: readonly Interface[]): NetDevSummary {
  const real = interfaces.filter((iface) => !isLoopback(iface));
  const glued = interfaces.filter(isNameGlued);

  return {
    total: interfaces.length,
    rxBytes: interfaces.reduce((sum, iface) => sum + iface.rx.bytes, 0),
    txBytes: interfaces.reduce((sum, iface) => sum + iface.tx.bytes, 0),
    busiest: real.reduce<Interface | undefined>(
      (most, iface) =>
        most === undefined || iface.rx.bytes + iface.tx.bytes > most.rx.bytes + most.tx.bytes
          ? iface
          : most,
      undefined,
    ),
    idle: interfaces.filter(isIdle),
    faulty: interfaces.filter(hasErrors),
    glued,
    widest: glued.reduce<Interface | undefined>(
      (longest, iface) =>
        longest === undefined || iface.name.length > longest.name.length ? iface : longest,
      undefined,
    ),
    loopback: interfaces.find(isLoopback),
  };
}

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];

/** Human-readable byte count, e.g. `634.5 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }

  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}
