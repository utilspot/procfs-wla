/**
 * Parser for `/proc/consoles`.
 *
 * One line per registered console:
 *
 *   tty0                 -WU (EC p  )    4:1
 *   ttyS0                -W- (E  p  )    4:64
 *   netcon0              -W- (E     )
 *
 * Four parts: the device name, a three-character **operations** triple, a
 * parenthesised **flags** field, and — only when the console has one — the
 * device's major:minor.
 *
 * The operations triple is `R`, `W`, `U` for read, write and unblank, with `-`
 * where the driver does not implement one.
 *
 * The flags field is the part to be careful with. The kernel writes it as a
 * **fixed six characters, one per flag, with a space where the flag is unset**
 * — `EC p  ` is enabled, preferred, print-buffer, and nothing else. Trimming it
 * before reading loses which position a letter was in; the letters happen to be
 * distinct so position is not strictly needed, but a space is meaningful and
 * must not be read as an unknown flag.
 *
 * The flag worth surfacing is `C` (`CON_CONSDEV`): that console is the one
 * `/dev/console` refers to, i.e. where the kernel's own output goes. `B`
 * (`CON_BOOT`) marks an early boot console, which is normally handed over to a
 * real driver and unregistered — one still listed after boot is worth noticing.
 */

export interface Console {
  /** Device name including its index, e.g. `ttyS0`. */
  name: string;
  /** The driver implements read. */
  read: boolean;
  /** The driver implements write. */
  write: boolean;
  /** The driver implements unblank. */
  unblank: boolean;
  /** Flag letters present, in the kernel's order. */
  flags: string[];
  /** Device number, absent for a console with no device (netconsole). */
  device: { major: number; minor: number } | null;
}

/**
 * The flags the kernel prints, in the order it prints them. Taken from
 * `fs/proc/consoles.c`, which writes one character per flag and a space where
 * the flag is not set.
 */
const FLAGS: { letter: string; name: string; description: string }[] = [
  { letter: 'E', name: 'enabled', description: 'the console is enabled' },
  {
    letter: 'C',
    name: 'preferred',
    description: 'this is the console /dev/console refers to',
  },
  { letter: 'B', name: 'boot', description: 'an early boot console, normally handed over' },
  {
    letter: 'p',
    name: 'print-buffer',
    description: 'printed the existing log buffer when it registered',
  },
  { letter: 'b', name: 'braille', description: 'a braille device' },
  {
    letter: 'a',
    name: 'any-context',
    description: 'safe to call from any context, including interrupt',
  },
];

export function describeFlag(letter: string): string {
  return FLAGS.find((flag) => flag.letter === letter)?.description ?? 'unknown flag';
}

export function nameFlag(letter: string): string {
  return FLAGS.find((flag) => flag.letter === letter)?.name ?? letter;
}

/** `tty0   -WU (EC p  )    4:1` */
const LINE = /^(\S+)\s+([R-])([W-])([U-])\s+\(([^)]*)\)(?:\s+(\d+):(\d+))?\s*$/;

export function parseConsoles(text: string): Console[] {
  const consoles: Console[] = [];

  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match === null) continue;

    const [, name, read, write, unblank, flags, major, minor] = match;

    consoles.push({
      name: name!,
      read: read === 'R',
      write: write === 'W',
      unblank: unblank === 'U',
      // Spaces mark unset flags rather than being flags of their own.
      flags: [...(flags ?? '')].filter((letter) => letter !== ' '),
      device:
        major === undefined || minor === undefined
          ? null
          : { major: Number(major), minor: Number(minor) },
    });
  }

  return consoles;
}

export function hasFlag(console: Console, letter: string): boolean {
  return console.flags.includes(letter);
}

/** Enabled, i.e. actually receiving kernel output. */
export function isEnabled(console: Console): boolean {
  return hasFlag(console, 'E');
}

/** The console `/dev/console` refers to, if any is marked preferred. */
export function preferred(consoles: readonly Console[]): Console | undefined {
  return consoles.find((console) => hasFlag(console, 'C'));
}

/** Early boot consoles, which are normally handed over and unregistered. */
export function bootConsoles(consoles: readonly Console[]): Console[] {
  return consoles.filter((console) => hasFlag(console, 'B'));
}

export interface ConsolesSummary {
  total: number;
  enabled: number;
  /** Registered but not enabled — they exist and receive nothing. */
  disabled: Console[];
  preferred: Console | undefined;
  boot: Console[];
  /** Consoles with no device number, e.g. netconsole. */
  withoutDevice: Console[];
}

export function summarize(consoles: readonly Console[]): ConsolesSummary {
  return {
    total: consoles.length,
    enabled: consoles.filter(isEnabled).length,
    disabled: consoles.filter((console) => !isEnabled(console)),
    preferred: preferred(consoles),
    boot: bootConsoles(consoles),
    withoutDevice: consoles.filter((console) => console.device === null),
  };
}

/** `RWU` — the operations a console supports, as the kernel spells them. */
export function operations(console: Console): string {
  return `${console.read ? 'R' : '-'}${console.write ? 'W' : '-'}${console.unblank ? 'U' : '-'}`;
}
