/**
 * Parser for `/proc/tty/drivers`.
 *
 * One line per registered tty driver, five columns wide:
 *
 *   /dev/tty             /dev/tty        5       0 system:/dev/tty
 *   serial               /dev/ttyS       4   64-95 serial
 *   pty_slave            /dev/pts      136 0-1048575 pty:slave
 *   unknown              /dev/tty        4    1-63 console
 *
 * The driver's name, the device node prefix it registers under, its major, the
 * minors it claims, and its type.
 *
 * **The first four lines are not drivers.** `show_tty_driver` in
 * `drivers/tty/tty_io.c` prints `/dev/tty`, `/dev/console`, `/dev/ptmx` and
 * `/dev/vc/0` ahead of the list, hard-coded, because each is a node that
 * redirects to whichever terminal is current rather than a driver of its own.
 * They are told apart by the one thing no real driver name can be: a name
 * starting with `/dev/`. Counting the lines counts four devices as drivers.
 *
 * The minor column is a **range when the driver claims more than one**, printed
 * as `first-last`, and a single number when it claims exactly one — which is
 * `num` in the driver, so a range's width is what the driver reserved rather
 * than what exists. `/dev/pts` reserving 1048576 minors does not mean a million
 * pseudo-terminals are open.
 *
 * A driver registered without a `driver_name` prints as `unknown`. That is the
 * kernel's own placeholder, not a parse failure, and it is common: the virtual
 * terminal driver is one on most machines.
 */

export interface TtyDriver {
  /** Driver name, or `unknown` where the driver registered without one. */
  name: string;
  /** Device node prefix, as printed — `/dev/ttyS`. */
  device: string;
  major: number;
  /** Minors claimed, inclusive. A driver claiming one has both the same. */
  minors: { first: number; last: number };
  /** The type field verbatim, e.g. `pty:slave` or `type:4.0`. */
  type: string;
  /**
   * One of the four nodes the kernel prints ahead of the drivers, which are
   * devices rather than drivers. See the note above.
   */
  pseudo: boolean;
}

/** `serial   /dev/ttyS   4 64-95 serial` */
const LINE = /^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)(?:-(\d+))?\s+(\S+)\s*$/;

export function parseTtyDrivers(text: string): TtyDriver[] {
  const drivers: TtyDriver[] = [];

  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match === null) continue;

    const [, name, device, major, first, last, type] = match;

    drivers.push({
      name: name!,
      device: device!,
      major: Number(major),
      // A driver claiming one minor prints it alone, so the range is that one.
      minors: { first: Number(first), last: Number(last ?? first) },
      type: type!,
      // The four hard-coded lines are named for the node they are; a driver's
      // own name is a driver name and never a path.
      pseudo: name!.startsWith('/dev/'),
    });
  }

  return drivers;
}

/**
 * What the type field means, keyed on the whole field rather than on the part
 * before the colon: `system` alone is `/dev/ptmx`, and `system:console` is a
 * different device entirely.
 */
const TYPES: Record<string, string> = {
  'system:/dev/tty': "the process's own controlling terminal, whichever that is",
  'system:console': 'the console the kernel prints to, /dev/console',
  'system:vtmaster': 'the virtual console in the foreground, /dev/vc/0',
  system: 'the kernel itself rather than hardware — /dev/ptmx hands out a pty pair per open',
  console: 'a virtual console on this machine',
  serial: 'a serial line',
  'serial:callout': 'the callout half of a serial line, which Linux dropped in 2.6',
  'pty:master': 'the master half of a pseudo-terminal pair',
  'pty:slave': 'the slave half of a pseudo-terminal pair — what a terminal emulator gives a shell',
  pty: 'a pseudo-terminal, with no half named',
};

export function describeType(type: string): string {
  const known = TYPES[type];
  if (known !== undefined) return known;

  // `type:%d.%d` is what the kernel falls back to for a type it has no name
  // for, so the numbers are all there is to go on.
  return type.startsWith('type:')
    ? 'a driver type this kernel prints no name for, only its numbers'
    : 'an unknown driver type';
}

/** The part before the colon — `serial` for both `serial` and `serial:callout`. */
export function kindOf(driver: TtyDriver): string {
  return driver.type.split(':', 1)[0]!;
}

/** How many device numbers the driver reserved, which is its `num`. */
export function minorCount(driver: TtyDriver): number {
  return driver.minors.last - driver.minors.first + 1;
}

/** The minors as the kernel prints them: one number, or `first-last`. */
export function minorRange(driver: TtyDriver): string {
  return minorCount(driver) === 1
    ? String(driver.minors.first)
    : `${driver.minors.first}-${driver.minors.last}`;
}

/** Registered without a `driver_name`, so the kernel printed its placeholder. */
export function isUnnamed(driver: TtyDriver): boolean {
  return driver.name === 'unknown';
}

/**
 * Callout devices — `/dev/cua*`, the second node an old kernel gave a serial
 * line for dialling out on. Removed in 2.6, so a driver still registering one
 * says the kernel is far older than anything this page normally sees.
 */
export function callouts(drivers: readonly TtyDriver[]): TtyDriver[] {
  return drivers.filter((driver) => driver.type === 'serial:callout');
}

export interface TtyDriversSummary {
  /** Every line, the four pseudo-devices included. */
  total: number;
  /** Real drivers, which is what the file is a list of. */
  drivers: TtyDriver[];
  /** The nodes printed ahead of them, which are not drivers. */
  pseudo: TtyDriver[];
  /** Device numbers reserved across every line. */
  minors: number;
  /** Distinct majors in use. */
  majors: number[];
  /** Drivers that registered without a name. */
  unnamed: TtyDriver[];
  callouts: TtyDriver[];
  /** Real drivers per kind — `serial`, `pty`, `console` — largest first. */
  kinds: { kind: string; count: number }[];
}

export function summarize(drivers: readonly TtyDriver[]): TtyDriversSummary {
  const real = drivers.filter((driver) => !driver.pseudo);
  const counts = new Map<string, number>();
  for (const driver of real) {
    counts.set(kindOf(driver), (counts.get(kindOf(driver)) ?? 0) + 1);
  }

  return {
    total: drivers.length,
    drivers: real,
    pseudo: drivers.filter((driver) => driver.pseudo),
    minors: drivers.reduce((sum, driver) => sum + minorCount(driver), 0),
    majors: [...new Set(drivers.map((driver) => driver.major))].sort((a, b) => a - b),
    unnamed: real.filter(isUnnamed),
    callouts: callouts(drivers),
    kinds: [...counts]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
  };
}
