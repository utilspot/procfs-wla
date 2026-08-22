/**
 * Parser for `/proc/version`.
 *
 * One line, built by the kernel from a fixed template:
 *
 *   Linux version <release> (<user>@<host>) (<compiler>) <version>
 *
 * where `<version>` is the `#<n>` build counter, whatever build flags the
 * kernel was configured with, and a build date. In practice:
 *
 *   Linux version 6.8.0-45-generic (buildd@lcy02-amd64-098) (x86_64-linux-gnu-gcc-13
 *   (Ubuntu 13.2.0-23ubuntu4) 13.2.0, GNU ld (GNU Binutils for Ubuntu) 2.42)
 *   #45-Ubuntu SMP PREEMPT_DYNAMIC Fri Aug 30 12:02:04 UTC 2024
 *
 * The parenthesised groups nest — a compiler names its own distribution in
 * parentheses — so they are read by counting brackets rather than by a regular
 * expression, and only the groups that directly follow the release are taken.
 * Anything after the build counter is left alone, since a Debian kernel ends
 * its line with `Debian 6.1.76-1 (2024-02-01)` rather than a date.
 *
 * Which fields are present varies: old kernels name no builder, container and
 * vendor kernels use their own local version suffixes, and only some are built
 * with `SMP` or one of the `PREEMPT` flavours.
 */

export interface KernelVersion {
  /** OS the banner names — `Linux` on anything this app will meet. */
  os: string;
  /** Full kernel release, e.g. `6.8.0-45-generic`. */
  release: string;
  /** Numeric prefix of the release, e.g. `6.8.0`. */
  version: string;
  major: number;
  minor: number;
  patch: number | null;
  /** What the distribution appended to the release, e.g. `45-generic`. */
  localVersion: string | null;
  /** User the kernel was built by, from `<user>@<host>`. */
  buildUser: string | null;
  /** Machine it was built on. */
  buildHost: string | null;
  /** Toolchain that built it, one entry per compiler the banner lists. */
  toolchain: string[];
  /** The `#45` counter, which a distribution bumps on every build. */
  buildNumber: number | null;
  /** Distribution tag stuck to that counter, `Ubuntu` in `#45-Ubuntu`. */
  buildTag: string | null;
  /** Build flags, e.g. `SMP` and `PREEMPT_DYNAMIC`. */
  flags: string[];
  /** What trails the flags: a build date, or a distribution's own version. */
  built: string | null;
}

/** `Linux version 6.8.0-45-generic ` — everything before the first group. */
const BANNER = /^(\S+)\s+version\s+(\S+)\s*/;

/** The numeric part of a release: two to four dot-separated numbers. */
const RELEASE = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.\d+)*/;

/** `#45-Ubuntu` followed by the flags and the build date. */
const BUILD = /^#(\d+)(\S*)\s*(.*)$/;

/** A build flag is shouted: `SMP`, `PREEMPT_RT`, `PREEMPT_DYNAMIC`. */
const FLAG = /^[A-Z][A-Z0-9_]*$/;

/** `buildd@lcy02-amd64-098`, as opposed to a compiler's prose. */
const BUILDER = /^[^\s@]+@\S+$/;

/**
 * Reads the parenthesised groups at the start of `text`, counting brackets so a
 * compiler naming its own distribution — `(Ubuntu 13.2.0-23ubuntu4)` — stays
 * part of the group around it. Stops at the first thing that is not a group,
 * which is the build counter.
 */
function readGroups(text: string): { groups: string[]; rest: string } {
  const groups: string[] = [];
  let index = 0;

  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index]!)) index++;
    if (text[index] !== '(') break;

    let depth = 0;
    let end = -1;
    for (let i = index; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    // An unbalanced group is not a group; leave it in the remainder untouched.
    if (end === -1) break;

    groups.push(text.slice(index + 1, end).trim());
    index = end + 1;
  }

  return { groups, rest: text.slice(index).trim() };
}

/** Splits on the commas between compilers, ignoring those inside brackets. */
function splitToolchain(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of value) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** Splits the build counter, flags and date that follow the compiler groups. */
function parseBuild(rest: string): Pick<
  KernelVersion,
  'buildNumber' | 'buildTag' | 'flags' | 'built'
> {
  const match = BUILD.exec(rest);
  if (match === null) {
    return { buildNumber: null, buildTag: null, flags: [], built: rest === '' ? null : rest };
  }

  const [, number = '', tag = '', trailing = ''] = match;

  // The flags run until the first token that is not shouted, which starts the
  // build date — `SMP PREEMPT_DYNAMIC Fri Aug 30 …`.
  const tokens = trailing.split(/\s+/).filter((token) => token !== '');
  let end = 0;
  while (end < tokens.length && FLAG.test(tokens[end]!)) end++;

  const built = tokens.slice(end).join(' ');

  return {
    buildNumber: Number(number),
    buildTag: tag.replace(/^-/, '') || null,
    flags: tokens.slice(0, end),
    built: built === '' ? null : built,
  };
}

/** Parses the banner, or returns null for a file that is not one. */
export function parseVersion(text: string): KernelVersion | null {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '')?.trim();
  if (line === undefined) return null;

  const banner = BANNER.exec(line);
  if (banner === null) return null;

  const [matched, os = '', release = ''] = banner;
  const { groups, rest } = readGroups(line.slice(matched.length));

  // The builder is the one group that reads as an address rather than prose;
  // old kernels name no builder at all, and the group is simply absent.
  const builder = groups.find((group) => BUILDER.test(group));
  const [buildUser = null, buildHost = null] = builder?.split('@') ?? [];

  const numeric = RELEASE.exec(release);

  return {
    os,
    release,
    version: numeric?.[0] ?? release,
    major: Number(numeric?.[1] ?? 0),
    minor: Number(numeric?.[2] ?? 0),
    patch: numeric?.[3] === undefined ? null : Number(numeric[3]),
    localVersion: numeric === null ? null : release.slice(numeric[0].length).replace(/^[-+._]/, '') || null,
    buildUser,
    buildHost,
    toolchain: groups.filter((group) => group !== builder).flatMap(splitToolchain),
    ...parseBuild(rest),
  };
}

/** `6.8` — the series a release belongs to, which is how kernels are talked about. */
export function series(version: KernelVersion): string {
  return `${version.major}.${version.minor}`;
}

/**
 * The preemption model the kernel was built with, from its flags. A kernel
 * without any `PREEMPT` flag is a non-preemptible (server) build.
 */
export function preemption(version: KernelVersion): string {
  const flag = version.flags.find((candidate) => candidate.startsWith('PREEMPT'));
  if (flag === undefined) return 'none';

  return (
    { PREEMPT: 'voluntary', PREEMPT_RT: 'realtime', PREEMPT_DYNAMIC: 'dynamic' }[flag] ??
    flag.toLowerCase()
  );
}
