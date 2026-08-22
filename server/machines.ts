import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_ROOT } from '../src/api/paths.js';

/**
 * The machines this server can be. Each is a whole `/proc` captured off one
 * kind of computer, and the server is set to exactly **one of them at a time**.
 *
 * That is the whole model. There is no per-file choice: a page reading
 * `/proc/meminfo` and a page reading `/proc/cpuinfo` are looking at the same
 * machine, the way they would be on a real one. Switching is one decision, made
 * on the admin page or with `FIXTURE_MACHINE`, and every path follows it.
 *
 * A machine is a **directory tree**, not a table of files this server knows
 * about: `machines/<name>/proc/...` mirrors the host paths exactly. So what the
 * server can serve is whatever is in the tree, the listing endpoint is a
 * `readdir` of it, and adding a file to a machine needs no code change at all.
 */
const MACHINE_ROOT = resolve(fileURLToPath(new URL('./machines', import.meta.url)));

/**
 * Not a machine at all: the choice that reads the **real `/proc` on the machine
 * this server runs on**, so the pages show what it says right now rather than a
 * capture of somebody else's computer.
 *
 * It is offered beside the five and switched to the same way. It is never the
 * default — a server that came up reading the host on a computer without
 * `/proc` would 404 everywhere for no visible reason — but pinning it works:
 * `FIXTURE_MACHINE=host npm run dev`.
 */
export const HOST_MACHINE = 'host';

export const HOST_DESCRIPTION =
  'The real /proc on the computer this server runs on, read fresh on every request';

/** Environment variable that pins which machine is served. */
export const MACHINE_ENV = 'FIXTURE_MACHINE';

export interface Machine {
  /** Directory under `server/machines/`, and what the admin page switches on. */
  name: string;
  /** One line from the machine's `_description`, for the admin page. */
  description: string;
}

/** Reads a machine's `_description`, which is one line of prose. */
function describe(name: string): string {
  try {
    return readFileSync(join(MACHINE_ROOT, name, '_description'), 'utf8').trim();
  } catch {
    return '';
  }
}

/** The captured machines, in directory order, which is alphabetical. */
export function machines(): Machine[] {
  return readdirSync(MACHINE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, description: describe(entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether this machine has a `/proc` of its own to read under `host`. */
export function hostAvailable(): boolean {
  try {
    return statSync(HOST_ROOT).isDirectory();
  } catch {
    return false;
  }
}

/** Every choice the server offers: the captures, then the host if there is one. */
export function choices(): Machine[] {
  const captured = machines();
  return hostAvailable()
    ? [...captured, { name: HOST_MACHINE, description: HOST_DESCRIPTION }]
    : captured;
}

/** Whether this name is one of the choices, which is what may be switched to. */
export function isChoice(name: string): boolean {
  return choices().some((choice) => choice.name === name);
}

/**
 * The machine served at start-up.
 *
 * `FIXTURE_MACHINE` pins it — `host` included — and without it the first
 * capture in directory order is served. Not a random draw: with one choice for
 * the whole of `/proc` rather than one per file, a fixed default is what makes
 * two runs of the dev server show the same thing, and switching is one click
 * away on the admin page.
 */
function initialMachine(): string {
  const pinned = process.env[MACHINE_ENV];
  if (pinned !== undefined && pinned !== '' && isChoice(pinned)) return pinned;

  if (pinned !== undefined && pinned !== '') {
    console.log(`[machines] ${MACHINE_ENV}=${pinned} is not a machine — ignoring it`);
  }

  return machines()[0]?.name ?? HOST_MACHINE;
}

let current = initialMachine();

/** Which machine the server is set to right now. */
export function currentMachine(): string {
  return current;
}

/** Switches it, for the admin page. Throws for a name that is not a choice. */
export function setCurrentMachine(name: string): void {
  if (!isChoice(name)) {
    throw new Error(`unknown machine: ${name} (have ${choices().map((c) => c.name).join(', ')})`);
  }
  current = name;
}

/**
 * A path segment this server is willing to put in a filesystem path.
 *
 * The request decides which host path is read, so this is the check standing
 * between a URL and the disk: ordinary characters only, and never `.` or `..`.
 * The path is then joined onto the machine's root and checked to have stayed
 * inside it — {@link resolveHostPath} — so a segment that slipped through here
 * still could not walk out of the tree.
 */
const SEGMENT = /^[A-Za-z0-9_@%+=,:-]+$/;

/** Whether this is a host path the server will look up, in a tree or on disk. */
export function isServablePath(path: string): boolean {
  if (path !== HOST_ROOT && !path.startsWith(`${HOST_ROOT}/`)) return false;

  const segments = path.slice(1).split('/');
  return segments.every((segment) => SEGMENT.test(segment));
}

export interface Resolved {
  /** Absolute path on disk to read, whether a file or a directory. */
  file: string;
  /** True where that is this computer's own `/proc` rather than a capture. */
  host: boolean;
}

/**
 * Where a host path is read from right now: the same path inside the machine's
 * tree, or the path itself under `host`.
 *
 * Returns null for a path the server will not look up at all. Whether anything
 * is *there* is the caller's problem — a capture is missing only through a
 * mistake in this repo, while the computer's own file can be absent or
 * unreadable, and those want telling apart.
 */
export function resolveHostPath(path: string): Resolved | null {
  if (!isServablePath(path)) return null;

  if (current === HOST_MACHINE) return { file: path, host: true };

  const root = join(MACHINE_ROOT, current);
  const file = join(root, path);
  // Belt and braces over SEGMENT: whatever the request said, the answer has to
  // be inside the machine's own tree.
  return file === root || file.startsWith(`${root}/`) ? { file, host: false } : null;
}
