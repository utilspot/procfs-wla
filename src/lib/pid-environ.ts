/**
 * Parser for `/proc/<pid>/environ` — the environment a process was started
 * with, beside `/proc/<pid>/cmdline`'s arguments and written the same way.
 *
 * `NAME=value` one after another with a **NUL between them**, and normally one
 * after the last, which is why `cat` runs the whole environment into a single
 * unreadable line — the separators print as nothing. See {@link SEPARATOR}.
 *
 * Four things it is read wrong for:
 *
 *  - **It is the environment `execve` was handed, not the one the process has
 *    now.** The kernel prints the bytes between `mm->env_start` and
 *    `mm->env_end`, which is the block the loader wrote at exec. `setenv()`
 *    allocates its new strings elsewhere on the heap, so a variable changed
 *    after exec normally still reads here as whatever it was — and one added
 *    after exec is not here at all. A process *can* rewrite that block in
 *    place, which is why the file is not simply a snapshot of the past either.
 *  - **It is not world-readable.** Mode 0400 and a ptrace check on top, where
 *    `/proc/<pid>/cmdline` is 0444 for everyone: a credential in an *argument*
 *    is already disclosed to every user on the machine, and one in a *variable*
 *    is not. Reading another user's is `EACCES`, which the page reports as the
 *    403 the backend gives it rather than as a fault. See {@link secretsIn} for
 *    what that protects, and why it still matters what is in here.
 *  - **A value may hold `=`.** `LS_COLORS=rs=0:di=01;34:…` is one variable, so
 *    an entry splits at its **first** `=` and everything after it is the value.
 *  - **A name may appear twice.** The block is what the loader wrote, and
 *    nothing deduplicates it; `getenv` walks from the start and returns the
 *    first, which is not what a reader scanning to the bottom would pick. See
 *    {@link duplicates}.
 *
 * An empty file is not an error: a kernel thread has no `mm` and neither has a
 * zombie, so there is no block to print. Which of the two it is cannot be told
 * from here — `/proc/<pid>/stat` says. See {@link isEmpty}.
 */
import { SECRET_NAME, URL_CREDENTIALS } from './pid-cmdline';

/** How the entries are separated, and what makes `cat` look broken. */
export const SEPARATOR = '\0';

/** One `NAME=value` of the block, in the order the loader wrote it. */
export interface EnvVariable {
  name: string;
  value: string;
  /** Where it sits in the block, which is what `getenv` walks. */
  index: number;
}

/**
 * An entry with no `=` in it at all.
 *
 * `execve` takes an array of strings and does not require any of them to be an
 * assignment, so this is a legal thing for a program to be started with and an
 * unusable one for it to read: `getenv` will never return it. Kept apart from
 * the variables rather than read as a name with an empty value, which is what
 * `NAME=` is and this is not.
 */
export interface EnvStray {
  index: number;
  text: string;
}

export interface Environment {
  variables: EnvVariable[];
  strays: EnvStray[];
  /** Bytes the file held, separators and padding included. */
  bytes: number;
  /** Whether it ended with the NUL the kernel writes after the last entry. */
  terminated: boolean;
  /** NULs past that one, which is space the block no longer uses. */
  padding: number;
}

export function parsePidEnviron(text: string): Environment {
  // A byte count rather than a count of JavaScript's UTF-16 units, since a
  // value can hold whatever the caller passed.
  const bytes = new TextEncoder().encode(text).length;

  if (text === '') {
    return { variables: [], strays: [], bytes: 0, terminated: false, padding: 0 };
  }

  const parts = text.split(SEPARATOR);
  const terminated = parts[parts.length - 1] === '';

  // Everything past the terminating NUL is padding rather than that many empty
  // entries — the same reading `/proc/<pid>/cmdline` gets, for the same reason.
  let end = parts.length;
  while (end > 0 && parts[end - 1] === '') end -= 1;
  const padding = parts.length - end - (terminated ? 1 : 0);

  const variables: EnvVariable[] = [];
  const strays: EnvStray[] = [];

  parts.slice(0, end).forEach((entry, index) => {
    const equals = entry.indexOf('=');

    // The **first** `=`: everything after it is the value, `LS_COLORS` and all.
    if (equals === -1) strays.push({ index, text: entry });
    else variables.push({ name: entry.slice(0, equals), value: entry.slice(equals + 1), index });
  });

  return { variables, strays, bytes, terminated, padding };
}

/** Whether the file held nothing: a kernel thread, or a process already gone. */
export function isEmpty(environment: Environment): boolean {
  return environment.bytes === 0;
}

/** Entries the file held, assignments and strays together. */
export function entryCount(environment: Environment): number {
  return environment.variables.length + environment.strays.length;
}

/**
 * The value `getenv` would return for a name: the **first** one written, since
 * that is where it stops looking.
 */
export function lookup(environment: Environment, name: string): string | null {
  return environment.variables.find((variable) => variable.name === name)?.value ?? null;
}

/**
 * Names written more than once, in the order they first appear.
 *
 * Nothing removes a repeat — the block is what the loader wrote — and the one
 * that counts is the first, which is the opposite of what a reader scanning to
 * the bottom of a list would take.
 */
export function duplicates(environment: Environment): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();

  for (const { name } of environment.variables) {
    if (seen.has(name)) twice.add(name);
    seen.add(name);
  }

  return [...twice];
}

/** Whether this variable is one of the repeats rather than the one `getenv` takes. */
export function isShadowed(environment: Environment, variable: EnvVariable): boolean {
  return environment.variables.some(
    (other) => other.name === variable.name && other.index < variable.index,
  );
}

/**
 * Names the shared matcher would flag that are not secrets **in an
 * environment**: `PWD` is the working directory here, where `--pwd` on a
 * command line is usually a password. The same spelling means different things
 * in the two files, so this is where the difference is written down rather than
 * in the matcher both use.
 */
const NOT_SECRET = new Set(['PWD', 'OLDPWD']);

export interface Secret {
  /** Where the variable sits in the block. */
  index: number;
  name: string;
  /** What gave it away, for the page to repeat. */
  reason: string;
}

/**
 * Variables that look like they carry a credential.
 *
 * Two shapes can be recognised without guessing: a **name** that says what its
 * value is — `GITHUB_TOKEN`, `DB_PASSWORD`, `AWS_SECRET_ACCESS_KEY` — and a
 * **value** with credentials written into a URL, which is how a `DATABASE_URL`
 * usually carries one. The name matcher is `/proc/<pid>/cmdline`'s, since what
 * a secret-looking name is does not change between the two files, and it is
 * deliberately conservative: a bare `KEY` or `SSH_AUTH_SOCK` is not matched,
 * because a false accusation here is worse than a miss.
 *
 * Worth pointing at even though this file is 0400. The value is in the process
 * for as long as it lives, it is inherited by everything it starts, and it is
 * on this page now — which is a screenshot away from being somewhere else.
 */
export function secretsIn(variables: readonly EnvVariable[]): Secret[] {
  const secrets: Secret[] = [];

  for (const { name, value, index } of variables) {
    // An empty value discloses nothing, whatever it is called.
    if (value === '') continue;

    if (SECRET_NAME.test(name) && !NOT_SECRET.has(name.toUpperCase())) {
      secrets.push({ index, name, reason: `the value of ${name}` });
    } else if (URL_CREDENTIALS.test(value)) {
      secrets.push({ index, name, reason: `a URL with a password in it` });
    }
  }

  return secrets;
}

/** Whether this variable is one of them, for the row to say so. */
export function isSecret(secrets: readonly Secret[], variable: EnvVariable): boolean {
  return secrets.some((secret) => secret.index === variable.index);
}

/** A value written across more than one line, which a table has to allow for. */
export function isMultiline(variable: EnvVariable): boolean {
  return variable.value.includes('\n');
}

export interface EnvironmentSummary {
  variables: number;
  /** Entries with no `=` in them, which `getenv` can never return. */
  strays: number;
  bytes: number;
  /** Names written more than once. */
  duplicates: string[];
  secrets: Secret[];
  /** The longest value, which is usually `LS_COLORS` and worth knowing about. */
  longest: EnvVariable | null;
}

export function summarize(environment: Environment): EnvironmentSummary {
  const longest = [...environment.variables].sort(
    (a, b) => b.value.length - a.value.length || a.index - b.index,
  )[0];

  return {
    variables: environment.variables.length,
    strays: environment.strays.length,
    bytes: environment.bytes,
    duplicates: duplicates(environment),
    secrets: secretsIn(environment.variables),
    longest: longest ?? null,
  };
}

const UNITS = ['B', 'KiB', 'MiB'];

/** `3.4 KiB` — an environment runs from a few hundred bytes to a few thousand. */
export function formatBytes(value: number): string {
  if (value === 0) return '0 B';

  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}
