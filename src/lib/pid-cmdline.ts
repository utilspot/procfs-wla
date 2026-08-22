/**
 * Parser for `/proc/<pid>/cmdline` — the process's own argument vector, not to
 * be confused with `/proc/cmdline`, which is the kernel's boot line and has its
 * own page.
 *
 * The file is `argv` as `execve` left it: the arguments one after another with
 * a **NUL between them** and, normally, one after the last. Nothing else. That
 * one detail is behind most of the confusion around it — `cat` prints the NULs
 * as nothing at all, so
 *
 *   $ cat /proc/self/cmdline
 *   cat/proc/self/cmdline
 *
 * is not a mangled answer, it is the exact bytes with the separators invisible.
 * `tr '\0' ' '` is the usual repair, and this page does the same job by showing
 * the arguments apart.
 *
 * Four more things read wrong at first glance:
 *
 * - **An empty file is not an error.** A kernel thread has no argument vector,
 *   and neither has a zombie, whose memory is already gone. Which of the two
 *   this is cannot be told from here — `/proc/<pid>/stat` says. See
 *   {@link isEmpty}.
 * - **`argv[0]` is not the program.** It is whatever the caller passed, and a
 *   login shell is handed `-bash` precisely so it can tell. Read
 *   `/proc/<pid>/exe` for what is actually running. See {@link isLoginShell}.
 * - **A process can overwrite all of this.** Postgres and nginx write a status
 *   line over their own argv — `postgres: 16/main: checkpointer` — so the file
 *   holds a *title* rather than a vector, sometimes with no NUL in it at all.
 *   See {@link isTitle}.
 * - **Trailing NULs are ambiguous.** Past the one that terminates the last
 *   argument, a run of them is the space a rewritten argv no longer uses — and
 *   is byte-for-byte identical to that many empty arguments at the end. This
 *   parser reads them as padding and reports how many. See {@link padding}.
 *
 * And the reason the file is worth a second look: **it is world-readable**,
 * mode 0444, where `/proc/<pid>/environ` is 0400. Every user on the machine can
 * read every process's arguments, which is why a password passed as one is
 * already disclosed. See {@link secretsIn}.
 */

/** How the arguments are separated, and what makes `cat` look broken. */
export const SEPARATOR = '\0';

/**
 * The longest a single argument may be: 32 pages, checked by `execve`. It is
 * the `E2BIG` behind "Argument list too long", along with the ceiling on the
 * whole vector, which is a quarter of `RLIMIT_STACK`.
 */
export const MAX_ARG_STRLEN = 32 * 4096;

export interface ProcessCommand {
  /** The arguments in order, with any trailing padding removed. */
  args: string[];
  /** Bytes the file held, separators and padding included. */
  bytes: number;
  /** Whether it ended with the NUL the kernel writes after the last argument. */
  terminated: boolean;
  /** Whether the file held any NUL at all. */
  separated: boolean;
  /**
   * NULs past the terminator: the space a process that rewrote its own argv no
   * longer uses. Indistinguishable from that many empty arguments at the end,
   * and read here as padding — see the note at the top of this file.
   */
  padding: number;
}

export function parsePidCmdline(text: string): ProcessCommand {
  // A byte count, not a count of JavaScript's UTF-16 units, since a path can
  // hold anything the filesystem allowed.
  const bytes = new TextEncoder().encode(text).length;

  if (text === '') {
    return { args: [], bytes: 0, terminated: false, separated: false, padding: 0 };
  }

  const parts = text.split(SEPARATOR);
  const separated = parts.length > 1;

  // Every NUL leaves an empty string behind it at the end of the split: one for
  // the terminator, and one more for each byte of padding after it.
  let trailing = 0;
  while (parts.length > 0 && parts.at(-1) === '') {
    parts.pop();
    trailing += 1;
  }

  return {
    args: parts,
    bytes,
    terminated: trailing > 0,
    separated,
    padding: Math.max(0, trailing - 1),
  };
}

/**
 * No argument vector at all. A kernel thread never had one and a zombie no
 * longer has the memory it was in; this file cannot tell you which.
 */
export function isEmpty(command: ProcessCommand): boolean {
  return command.bytes === 0;
}

/**
 * Whether what is here is a status line a process wrote over its own argv
 * rather than the vector it was started with: one argument holding whitespace,
 * with either no separator in the file at all or unused space behind it.
 */
export function isTitle(command: ProcessCommand): boolean {
  if (command.args.length !== 1) return false;
  if (!/\s/.test(command.args[0]!)) return false;
  return !command.separated || command.padding > 0;
}

/**
 * Whether `argv[0]` carries the leading dash a login shell is started with. It
 * is a marker rather than part of the name — `-bash` is `bash`.
 */
export function isLoginShell(command: ProcessCommand): boolean {
  const first = command.args[0];
  return first !== undefined && first.startsWith('-') && first.length > 1;
}

/**
 * What `argv[0]` says is running, without its path or a login shell's dash.
 * Never to be trusted over `/proc/<pid>/exe`, since the caller chose it.
 *
 * Null where there is nothing to say: an empty vector, or a status line a
 * process wrote over its own argv, which holds no program name to take —
 * `postgres: 16/main: checkpointer` has a slash in it and no path anywhere.
 */
export function program(command: ProcessCommand): string | null {
  const first = command.args[0];
  if (first === undefined || first === '' || isTitle(command)) return null;

  const named = isLoginShell(command) ? first.slice(1) : first;
  return named.slice(named.lastIndexOf('/') + 1);
}

/** Characters a shell would leave alone, so an argument needs no quoting. */
const BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * One argument as it would have to be written to survive a shell. The file
 * holds no quoting of its own — the NULs did that job — so this is added by
 * this page and is the one part of the joined form that was never in the file.
 */
export function quoteArgument(argument: string): string {
  if (argument === '') return "''";
  if (BARE.test(argument)) return argument;
  return `'${argument.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command line as a shell would take it. Reconstructed: the spaces between
 * these are this page's, where the file had NULs.
 */
export function formatCommand(command: ProcessCommand): string {
  return command.args.map(quoteArgument).join(' ');
}

/** An option name that carries a secret rather than a setting. */
/**
 * A name that says its value is a credential — the `password` of
 * `--password=…`, and the `TOKEN` of `GITHUB_TOKEN`.
 *
 * Exported because `/proc/<pid>/environ` asks the same question of its variable
 * names, and what counts as a secret-looking name is one fact rather than two
 * that have to agree. See `src/lib/pid-environ.ts`.
 */
export const SECRET_NAME =
  /(?:^|[-_])(?:passwd|password|pwd|secret|token|api[-_]?key|access[-_]?key|credential|credentials)$/i;

/** Credentials written into a URL: the `user:password@` before the host. */
export const URL_CREDENTIALS = /:\/\/[^/\s:@]+:[^/\s@]+@/;

export interface Secret {
  /** Which argument holds it. */
  index: number;
  /** What gave it away, for the page to repeat. */
  reason: string;
}

/**
 * Arguments that look like they carry a credential.
 *
 * Worth pointing at because this file is world-readable: anything here has
 * already been shown to every user on the machine, and to anything that reads
 * `ps`. The two shapes that can be recognised without guessing are an option
 * named for a secret — `--password=…`, or the argument after `--token` — and a
 * URL with credentials in it. A short glued flag like `mysql -phunter2` is not
 * matched: `-p` means something different in half the tools that take it, and
 * a false accusation on this page is worse than a miss.
 */
export function secretsIn(args: readonly string[]): Secret[] {
  const secrets: Secret[] = [];

  args.forEach((argument, index) => {
    if (URL_CREDENTIALS.test(argument)) {
      secrets.push({ index, reason: 'a URL with a password in it' });
      return;
    }

    const equals = argument.indexOf('=');
    const name = (equals === -1 ? argument : argument.slice(0, equals)).replace(/^-+/, '');
    if (!argument.startsWith('-') || !SECRET_NAME.test(name)) return;

    if (equals !== -1) {
      // `--password=` with nothing after it discloses nothing.
      if (equals < argument.length - 1) {
        secrets.push({ index, reason: `the value of ${argument.slice(0, equals)}` });
      }
      return;
    }

    // `--password hunter2`: the flag names it, the argument after holds it.
    const value = args[index + 1];
    if (value !== undefined && value !== '' && !value.startsWith('-')) {
      secrets.push({ index: index + 1, reason: `the value of ${argument}` });
    }
  });

  return secrets;
}

export interface CommandSummary {
  /** How many arguments, `argv[0]` included. */
  count: number;
  bytes: number;
  /** What `argv[0]` says is running, as far as it can be trusted. */
  program: string | null;
  empty: boolean;
  title: boolean;
  loginShell: boolean;
  padding: number;
  /** Whether the kernel's closing NUL is there. */
  terminated: boolean;
  /** Arguments holding whitespace, which is what the joined form has to quote. */
  quoted: number[];
  /** Empty arguments, which are real and easy to lose. */
  blanks: number[];
  secrets: Secret[];
  /** Bytes in the longest argument. */
  longest: number;
}

export function summarize(command: ProcessCommand): CommandSummary {
  return {
    count: command.args.length,
    bytes: command.bytes,
    program: program(command),
    empty: isEmpty(command),
    title: isTitle(command),
    loginShell: isLoginShell(command),
    padding: command.padding,
    terminated: command.terminated,
    quoted: command.args.flatMap((argument, index) => (/\s/.test(argument) ? [index] : [])),
    blanks: command.args.flatMap((argument, index) => (argument === '' ? [index] : [])),
    secrets: secretsIn(command.args),
    longest: command.args.reduce((longest, argument) => Math.max(longest, argument.length), 0),
  };
}

/** `447 bytes`, and the singular where it is one. */
export function formatBytes(value: number): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? 'byte' : 'bytes'}`;
}
