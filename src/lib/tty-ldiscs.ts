/**
 * Parser for `/proc/tty/ldiscs`.
 *
 * One line per **registered** line discipline, two columns wide — the name and
 * the number, laid out by `tty_ldiscs_seq_show` in `drivers/tty/tty_io.c` as
 * `"%-10s %2d\n"`:
 *
 *   n_tty       0
 *   n_null     27
 *
 * A line discipline is the layer between a tty driver and whatever reads the
 * terminal: it is what turns bytes into lines, echoes them, and makes `^C` a
 * signal. Every tty starts on `n_tty`, and `ioctl(TIOCSETD)` is what swaps one
 * in — a Bluetooth UART becomes an HCI transport that way, and nothing about
 * the driver underneath changes.
 *
 * Two things about the file read wrong at first glance.
 *
 * **It lists what is registered, not what the kernel knows how to do.** A
 * discipline appears when its module registers and goes away when that module
 * unloads, so the file changes at runtime — an ordinary machine shows two of a
 * possible thirty-one.
 *
 * **The number is the `N_*` constant, not a position.** It is ABI: userspace
 * passes it to `TIOCSETD`, so a number means the same thing on every kernel and
 * is never reused. Gaps between the numbers are the normal case rather than
 * anything missing, and the numbers of disciplines Linux has since deleted stay
 * allocated for good.
 */

export interface LineDiscipline {
  /** Name as the kernel prints it, e.g. `n_tty`. */
  name: string;
  /** The `N_*` constant, which is what `TIOCSETD` takes. */
  number: number;
}

/** `n_null     27` */
const LINE = /^(\S+)\s+(\d+)\s*$/;

export function parseLdiscs(text: string): LineDiscipline[] {
  const disciplines: LineDiscipline[] = [];

  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match === null) continue;

    const [, name, number] = match;
    disciplines.push({ name: name!, number: Number(number) });
  }

  return disciplines;
}

interface KnownDiscipline {
  /** The constant as `include/uapi/linux/tty.h` spells it. */
  constant: string;
  description: string;
  /**
   * The release that deleted the driver, for the numbers Linux no longer has
   * one behind. The number stays allocated — it is ABI — so this says the
   * kernel the file was read from predates that release rather than that
   * anything is wrong.
   */
  removedIn?: string;
}

/**
 * The numbers, from `include/uapi/linux/tty.h`. Keyed by number rather than by
 * name because the number is the fixed part: a driver picks its own name, and
 * `TIOCSETD` only ever sees the number.
 *
 * `removedIn` is set only where the driver is definitely gone from mainline.
 * Several of the others have never had an in-tree driver at all, which the
 * description says rather than this field.
 */
const KNOWN: Record<number, KnownDiscipline> = {
  0: {
    constant: 'N_TTY',
    description:
      'the default every tty starts on: canonical mode, echo, line editing, and turning ^C into a signal',
  },
  1: { constant: 'N_SLIP', description: 'Serial Line IP, the first way a serial line carried IP' },
  2: { constant: 'N_MOUSE', description: 'a serial mouse' },
  3: { constant: 'N_PPP', description: 'Point-to-Point Protocol, what dial-up moved to after SLIP' },
  4: {
    constant: 'N_STRIP',
    description: 'Starmode Radio IP, for Metricom packet radios',
    removedIn: '2.6.28',
  },
  5: { constant: 'N_AX25', description: 'AX.25 packet radio' },
  6: { constant: 'N_X25', description: 'X.25 over an asynchronous line' },
  7: { constant: 'N_6PACK', description: '6PACK, another framing for packet-radio TNCs' },
  8: { constant: 'N_MASC', description: 'Mobitex module, which never had an in-tree driver' },
  9: {
    constant: 'N_R3964',
    description: "Siemens' R3964 industrial protocol",
    removedIn: '5.16',
  },
  10: {
    constant: 'N_PROFIBUS_FDL',
    description: 'Profibus fieldbus, which never had an in-tree driver',
  },
  11: {
    constant: 'N_IRDA',
    description: 'infrared, the IrDA stack',
    removedIn: '4.17',
  },
  12: {
    constant: 'N_SMSBLOCK',
    description: 'SMS block mode for GSM modems, which never had an in-tree driver',
  },
  13: { constant: 'N_HDLC', description: 'synchronous HDLC framing' },
  14: { constant: 'N_SYNC_PPP', description: 'PPP over a synchronous line' },
  15: {
    constant: 'N_HCI',
    description: 'Bluetooth HCI over a UART — what turns a serial port into a Bluetooth transport',
  },
  16: { constant: 'N_GIGASET_M101', description: "Siemens' Gigaset M101 DECT base station" },
  17: { constant: 'N_SLCAN', description: 'CAN bus carried over a serial line' },
  18: {
    constant: 'N_PPS',
    description: 'pulse-per-second timestamping, for disciplining a clock to a GPS receiver',
  },
  19: { constant: 'N_V253', description: 'V.253 voice modem control' },
  20: { constant: 'N_CAIF', description: "ST-Ericsson's CAIF modem protocol" },
  21: {
    constant: 'N_GSM0710',
    description: 'GSM 07.10 multiplexing — several channels down one modem line',
  },
  22: { constant: 'N_TI_WL', description: "TI's WiLink shared transport" },
  23: { constant: 'N_TRACESINK', description: 'MIPI debug trace sink', removedIn: '4.12' },
  24: { constant: 'N_TRACEROUTER', description: 'MIPI debug trace router', removedIn: '4.12' },
  25: { constant: 'N_NCI', description: 'NFC Controller Interface over a UART' },
  26: { constant: 'N_SPEAKUP', description: "the Speakup screen reader's serial synthesisers" },
  27: {
    constant: 'N_NULL',
    description: 'discards everything — a tty with no line processing at all',
  },
  28: { constant: 'N_MCTP', description: 'MCTP over serial, for platform management' },
  29: {
    constant: 'N_DEVELOPMENT',
    description: 'reserved for out-of-tree work, and claimed by nothing in mainline',
  },
  30: { constant: 'N_CAN327', description: 'ELM327-based CAN interfaces' },
};

/** The `N_*` constant for a number, or null for one this page does not know. */
export function constantFor(number: number): string | null {
  return KNOWN[number]?.constant ?? null;
}

/** What the discipline at this number does, or null for one not known here. */
export function describeLdisc(number: number): string | null {
  return KNOWN[number]?.description ?? null;
}

/**
 * A discipline registered under a number this page has no entry for: an
 * out-of-tree module, or one added to Linux after this table was written.
 */
export function isUnknown(discipline: LineDiscipline): boolean {
  return KNOWN[discipline.number] === undefined;
}

/** The default every tty starts on, which is the point of reading this file. */
export function isDefault(discipline: LineDiscipline): boolean {
  return discipline.number === 0;
}

/** The release that deleted this number's driver, for one Linux no longer has. */
export function removedIn(discipline: LineDiscipline): string | null {
  return KNOWN[discipline.number]?.removedIn ?? null;
}

/**
 * Disciplines registered here that current Linux has no driver for. Their
 * numbers stay allocated, so finding one registered says the kernel is old
 * rather than that anything is wrong.
 */
export function removed(disciplines: readonly LineDiscipline[]): LineDiscipline[] {
  return disciplines.filter((discipline) => removedIn(discipline) !== null);
}

/** How many numbers the ABI has, which is what the registered ones are out of. */
export const TOTAL = Object.keys(KNOWN).length;
