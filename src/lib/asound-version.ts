/**
 * Parser for `/proc/asound/version`.
 *
 * One line, and on any kernel since 3.7 it is this one:
 *
 *   Advanced Linux Sound Architecture Driver Version k6.8.0-45-generic.
 *
 * printed by the ALSA core from a fixed format string — `snd_info_version_read`
 * in `sound/core/info.c` writes
 * `"Advanced Linux Sound Architecture Driver Version k%s.\n"` over
 * `init_utsname()->release`. Three things follow from that one line of C, and
 * all three are why this file is read wrong:
 *
 * - **The `k` is a literal**, not part of any version. It marks what follows as
 *   a *kernel* release, and everything after it is `uname -r`.
 * - **So the file names no ALSA version at all.** Asked which ALSA they are
 *   running, people quote this file and give back their kernel release. The
 *   number userspace means by "ALSA version" is alsa-lib's, which `aplay
 *   --version` prints and which is nowhere near here.
 * - **The full stop is the kernel's**, printed after the release rather than
 *   part of it, so reading everything after `Version ` gives a string that will
 *   never compare equal to `uname -r`.
 *
 * Before 3.7 the same function printed `CONFIG_SND_VERSION CONFIG_SND_DATE`,
 * which was ALSA's own release — the number the alsa-driver package carried,
 * sitting in the tree at whatever the last sync from it brought in:
 *
 *   Advanced Linux Sound Architecture Driver Version 1.0.25.
 *
 * In the tree `CONFIG_SND_DATE` was the empty string. A build of the packaged
 * alsa-driver filled it with a date in parentheses, and added a second line
 * saying when it was compiled and which kernel it was compiled *for*:
 *
 *   Advanced Linux Sound Architecture Driver Version 1.0.23 (Wed Jun 09 12:04:19 2010 UTC).
 *   Compiled on Aug 11 2010 for kernel 2.6.32-24-generic (SMP).
 *
 * Which of the shapes a machine prints therefore dates it: a `k` says 3.7 or
 * newer, and a `1.0.x` says older than that — or a kernel whose sound stack
 * came from somewhere other than its own tree.
 *
 * The release is split the way `src/lib/version.ts` splits the one in
 * `/proc/version`, and for the same reason, but not by the same code: that
 * parser is handed a whole banner to take apart and this one a bare release,
 * so what the two share is one regular expression rather than a decision.
 */

/** What every version of this file starts its one line with. */
export const BANNER = 'Advanced Linux Sound Architecture Driver Version';

/** The release that stopped printing ALSA's own version and started printing the kernel's. */
export const KERNEL_VERSION_SINCE = '3.7';

/** The number `aplay --version` prints, which people mean by "ALSA version". */
export const USERSPACE_NOTE =
  'alsa-lib carries its own version, still numbered 1.2.x, and it is not in this file';

/** What the version field turned out to be. */
export type VersionForm =
  /** `k` and a kernel release: every kernel since 3.7. */
  | 'kernel'
  /** ALSA's own release, so a kernel older than that — or an out-of-tree build. */
  | 'alsa'
  /** Neither, which no kernel prints and a vendor might. */
  | 'unknown';

/** The second line, which only the packaged alsa-driver build printed. */
export interface CompiledLine {
  /** When the module was built, as the C preprocessor's `__DATE__` spelled it. */
  date: string;
  /** The kernel it was built *for*, which need not be the one running it. */
  release: string;
  /** Whether it was built for an SMP kernel. */
  smp: boolean;
  /** The line as read. */
  raw: string;
}

export interface AsoundVersion {
  /** The version field as printed, `k` and all — e.g. `k6.8.0-45-generic`. */
  printed: string;
  /** The kernel release it names, with the `k` taken off, or null. */
  release: string | null;
  /** ALSA's own release, for a file from before that stopped being printed. */
  alsaRelease: string | null;
  /** The date `CONFIG_SND_DATE` carried, from the parentheses after the number. */
  built: string | null;
  /** The compile line an out-of-tree build added under the banner. */
  compiled: CompiledLine | null;
  /** Whether the line ended in the full stop the kernel prints after it. */
  terminated: boolean;
  /** The first line as read, for showing what was parsed. */
  raw: string;
}

/** The banner, and everything the kernel put after it. */
const HEADING = new RegExp(`^${BANNER}\\s+(.*)$`);

/** `Compiled on Aug 11 2010 for kernel 2.6.32-24-generic (SMP).` */
const COMPILED = /^Compiled on\s+(.+?)\s+for kernel\s+(\S+?)(\s+\(SMP\))?\.?$/;

/** The date `CONFIG_SND_DATE` puts in parentheses on the end of the number. */
const DATED = /\s*\(([^()]*)\)$/;

/** A kernel release behind the `k`, which has to start with a number. */
const KERNEL = /^k(\d.*)$/;

/** The numeric part of a release: two to four dot-separated numbers. */
const RELEASE = /^(\d+)\.(\d+)(?:\.(\d+))?(?:\.\d+)*/;

/** Parses the file, or returns null for one that is not this file. */
export function parseAsoundVersion(text: string): AsoundVersion | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const first = lines[0];
  if (first === undefined) return null;

  const heading = HEADING.exec(first);
  if (heading === null) return null;

  // The full stop comes last of all, after any date, because the kernel prints
  // it as the end of a sentence rather than as part of anything in it.
  let field = heading[1]!.trim();
  const terminated = field.endsWith('.');
  if (terminated) field = field.slice(0, -1).trim();

  const dated = DATED.exec(field);
  const built = dated?.[1]?.trim() ?? null;
  const printed = (dated === null ? field : field.slice(0, dated.index)).trim();

  const kernel = KERNEL.exec(printed);

  return {
    printed,
    release: kernel?.[1] ?? null,
    // Only a number can be ALSA's own; a vendor's own string is neither shape.
    alsaRelease: kernel === null && RELEASE.test(printed) ? printed : null,
    built: built === '' ? null : built,
    compiled: parseCompiled(lines.slice(1)),
    terminated,
    raw: first,
  };
}

/** The compile line, from the lines under the banner, or null for none. */
function parseCompiled(lines: string[]): CompiledLine | null {
  for (const line of lines) {
    const match = COMPILED.exec(line);
    if (match === null) continue;

    return {
      date: match[1]!.trim(),
      release: match[2]!,
      smp: match[3] !== undefined,
      raw: line,
    };
  }

  return null;
}

/** What the version field turned out to be. */
export function formOf(version: AsoundVersion): VersionForm {
  if (version.release !== null) return 'kernel';
  return version.alsaRelease === null ? 'unknown' : 'alsa';
}

/** A kernel release, taken apart the way `/proc/version` takes its own. */
export interface ReleaseParts {
  /** The numeric prefix, e.g. `6.8.0`. */
  version: string;
  major: number;
  minor: number;
  patch: number | null;
  /** What the distribution appended to it, e.g. `45-generic` or `rpt-rpi-v8`. */
  localVersion: string | null;
}

/** Splits a release into its numbers and whatever was stuck to them. */
export function releaseParts(release: string): ReleaseParts | null {
  const numeric = RELEASE.exec(release);
  if (numeric === null) return null;

  return {
    version: numeric[0],
    major: Number(numeric[1]),
    minor: Number(numeric[2]),
    patch: numeric[3] === undefined ? null : Number(numeric[3]),
    // The separator belongs to neither side: `-45-generic` and `+rpt-rpi-v8`
    // are the same thing spelled two ways.
    localVersion: release.slice(numeric[0].length).replace(/^[-+._]/, '') || null,
  };
}

/** `6.8` — the series a release belongs to, which is how kernels are named. */
export function seriesOf(release: string): string | null {
  const parts = releaseParts(release);
  return parts === null ? null : `${parts.major}.${parts.minor}`;
}

/**
 * Whether the compile line names a kernel other than the one it says it was
 * built for — which for an out-of-tree module is the interesting case, since
 * the release there is fixed when the module is compiled and the machine
 * running it may have moved on. Both releases have to be known to compare.
 */
export function builtForAnotherKernel(version: AsoundVersion): boolean {
  return (
    version.compiled !== null &&
    version.release !== null &&
    version.compiled.release !== version.release
  );
}

export interface AsoundVersionSummary {
  form: VersionForm;
  /** The version field as printed, which is what the file actually says. */
  printed: string;
  release: string | null;
  series: string | null;
  localVersion: string | null;
  alsaRelease: string | null;
  built: string | null;
  compiled: CompiledLine | null;
  /** Whether a build outside the kernel tree left its compile line here. */
  outOfTree: boolean;
  /** Whether the line ended the way the kernel ends it. */
  terminated: boolean;
}

export function summarize(version: AsoundVersion): AsoundVersionSummary {
  const parts = version.release === null ? null : releaseParts(version.release);

  return {
    form: formOf(version),
    printed: version.printed,
    release: version.release,
    series: parts === null ? null : `${parts.major}.${parts.minor}`,
    localVersion: parts?.localVersion ?? null,
    alsaRelease: version.alsaRelease,
    built: version.built,
    compiled: version.compiled,
    outOfTree: version.compiled !== null,
    terminated: version.terminated,
  };
}

/** The parsed pieces, in the order they appear in the file. */
export interface VersionField {
  label: string;
  value: string;
  /** What this piece of the line is. */
  note: string;
}

export function fieldsOf(version: AsoundVersion): VersionField[] {
  const fields: VersionField[] = [
    {
      label: 'banner',
      value: BANNER,
      note: 'A fixed string in the ALSA core, printed whether or not the machine has a sound card',
    },
    {
      label: 'version field',
      value: version.printed,
      note: 'Everything the kernel put after the banner, without the full stop it ends the line with',
    },
  ];

  if (version.release !== null) {
    const parts = releaseParts(version.release);

    fields.push({
      label: 'k',
      value: 'k',
      note: 'A literal in the format string, marking what follows as a kernel release rather than an ALSA one',
    });

    fields.push({
      label: 'kernel release',
      value: version.release,
      note: 'init_utsname()->release — the running kernel, which is what uname -r prints',
    });

    if (parts !== null) {
      fields.push({
        label: 'series',
        value: `${parts.major}.${parts.minor}`,
        note: 'The series those numbers name, which is how a kernel is talked about',
      });
    }

    if (parts !== null && parts.localVersion !== null) {
      fields.push({
        label: 'local version',
        value: parts.localVersion,
        note: 'What the distribution appended to the release: its build number, its flavour, or both',
      });
    }
  }

  if (version.alsaRelease !== null) {
    fields.push({
      label: 'ALSA release',
      value: version.alsaRelease,
      note: `CONFIG_SND_VERSION — ALSA's own number, which the kernel stopped printing in ${KERNEL_VERSION_SINCE}`,
    });
  }

  if (version.built !== null) {
    fields.push({
      label: 'build date',
      value: version.built,
      note: 'CONFIG_SND_DATE, which is empty in the kernel tree and filled in by a build outside it',
    });
  }

  if (version.compiled !== null) {
    fields.push({
      label: 'compiled on',
      value: version.compiled.date,
      note: "The C preprocessor's __DATE__ at the moment the module was built",
    });

    fields.push({
      label: 'compiled for',
      value: version.compiled.release,
      note: 'The kernel the module was built against, which is fixed at build time rather than read now',
    });

    if (version.compiled.smp) {
      fields.push({
        label: 'SMP',
        value: 'yes',
        note: 'Built for a kernel with CONFIG_SMP, which was worth saying when it was not a given',
      });
    }
  }

  return fields;
}
