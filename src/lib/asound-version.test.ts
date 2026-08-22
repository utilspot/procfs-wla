import { describe, expect, it } from 'vitest';
import { readAsoundVersionFixture as fixture } from '../test/fixtures';
import {
  BANNER,
  builtForAnotherKernel,
  fieldsOf,
  formOf,
  KERNEL_VERSION_SINCE,
  parseAsoundVersion,
  releaseParts,
  seriesOf,
  summarize,
} from './asound-version';

describe('parseAsoundVersion — the modern form', () => {
  const version = parseAsoundVersion(fixture('desktop'))!;

  /** The `k` is a literal in the format string, not part of any version. */
  it('reads the version field as the kernel release behind a literal k', () => {
    expect(version).toMatchObject({
      printed: 'k6.8.0-45-generic',
      release: '6.8.0-45-generic',
      alsaRelease: null,
      built: null,
      compiled: null,
    });
    expect(formOf(version)).toBe('kernel');
  });

  /** The kernel ends the line with a full stop, which is not in the release. */
  it('takes the full stop off the end without taking it out of the release', () => {
    expect(version.terminated).toBe(true);
    expect(version.release).not.toMatch(/\.$/);
    expect(version.raw).toBe(`${BANNER} k6.8.0-45-generic.`);
  });

  it('splits the release into its series and what the distribution added', () => {
    expect(releaseParts('6.8.0-45-generic')).toEqual({
      version: '6.8.0',
      major: 6,
      minor: 8,
      patch: 0,
      localVersion: '45-generic',
    });
    expect(seriesOf('6.8.0-45-generic')).toBe('6.8');
  });

  it('summarizes what the file says and what it is', () => {
    expect(summarize(version)).toMatchObject({
      form: 'kernel',
      printed: 'k6.8.0-45-generic',
      release: '6.8.0-45-generic',
      series: '6.8',
      localVersion: '45-generic',
      alsaRelease: null,
      outOfTree: false,
      terminated: true,
    });
  });

  it('lays the line out a piece at a time, the k among them', () => {
    const fields = fieldsOf(version);

    expect(fields.map((field) => field.label)).toEqual([
      'banner',
      'version field',
      'k',
      'kernel release',
      'series',
      'local version',
    ]);
    expect(fields.find((field) => field.label === 'k')?.note).toMatch(/literal/);
    expect(fields.find((field) => field.label === 'kernel release')?.note).toMatch(/uname -r/);
  });
});

describe('parseAsoundVersion — a vendor release', () => {
  const version = parseAsoundVersion(fixture('raspberry-pi'))!;

  /** `+rpt-rpi-v8` and `-45-generic` are the same thing spelled two ways. */
  it('reads a local version stuck on with a + rather than a -', () => {
    expect(version.release).toBe('6.6.31+rpt-rpi-v8');
    expect(summarize(version)).toMatchObject({
      series: '6.6',
      localVersion: 'rpt-rpi-v8',
    });
  });
});

describe('parseAsoundVersion — a mainline build', () => {
  const version = parseAsoundVersion(fixture('mainline'))!;

  it('reads a release with nothing appended as having no local version', () => {
    expect(version.release).toBe('6.10.0');
    expect(summarize(version)).toMatchObject({ series: '6.10', localVersion: null });
    expect(fieldsOf(version).map((field) => field.label)).not.toContain('local version');
  });
});

describe(`parseAsoundVersion — a kernel older than ${KERNEL_VERSION_SINCE}`, () => {
  const version = parseAsoundVersion(fixture('alsa-1.0'))!;

  /** Which is the one case where the number here is ALSA's own. */
  it("reads the number as ALSA's release rather than the kernel's", () => {
    expect(version).toMatchObject({
      printed: '1.0.25',
      release: null,
      alsaRelease: '1.0.25',
      built: null,
    });
    expect(formOf(version)).toBe('alsa');
  });

  it('says nothing about a kernel release it was not given', () => {
    const summary = summarize(version);

    expect(summary.release).toBeNull();
    expect(summary.series).toBeNull();
    expect(summary.localVersion).toBeNull();
    expect(fieldsOf(version).find((field) => field.label === 'ALSA release')?.note).toMatch(
      new RegExp(`stopped printing in ${KERNEL_VERSION_SINCE}`),
    );
  });
});

describe('parseAsoundVersion — a build with a date on it', () => {
  const version = parseAsoundVersion(fixture('dated-build'))!;

  /** CONFIG_SND_DATE is empty in the tree, so a date means a build outside it. */
  it('takes the parenthesised date off the version rather than into it', () => {
    expect(version).toMatchObject({
      printed: '1.0.20',
      alsaRelease: '1.0.20',
      built: 'Thu Apr 30 09:34:12 2009 UTC',
      compiled: null,
    });
  });

  it('reads the full stop that comes after the date', () => {
    expect(version.terminated).toBe(true);
    expect(version.built).not.toMatch(/\.$/);
  });
});

describe('parseAsoundVersion — the packaged alsa-driver build', () => {
  const version = parseAsoundVersion(fixture('out-of-tree'))!;

  it('reads the second line the kernel tree never printed', () => {
    expect(version.compiled).toEqual({
      date: 'Aug 11 2010',
      release: '2.6.32-24-generic',
      smp: true,
      raw: 'Compiled on Aug 11 2010 for kernel 2.6.32-24-generic (SMP).',
    });
    expect(summarize(version).outOfTree).toBe(true);
  });

  it('keeps the version and its date apart from the compile line', () => {
    expect(version).toMatchObject({
      alsaRelease: '1.0.23',
      built: 'Wed Jun 09 12:04:19 2010 UTC',
    });
  });

  it('lays out both lines, the compile date and the kernel behind it', () => {
    expect(fieldsOf(version).map((field) => field.label)).toEqual([
      'banner',
      'version field',
      'ALSA release',
      'build date',
      'compiled on',
      'compiled for',
      'SMP',
    ]);
  });

  /** Nothing to compare it against: this form prints no kernel release. */
  it('does not read the compile line as disagreeing with a release it has not got', () => {
    expect(builtForAnotherKernel(version)).toBe(false);
  });
});

describe('parseAsoundVersion — lines that are not the ordinary ones', () => {
  it('reads a line the kernel did not terminate', () => {
    const version = parseAsoundVersion(`${BANNER} k6.8.0-45-generic\n`)!;

    expect(version.terminated).toBe(false);
    expect(version.release).toBe('6.8.0-45-generic');
  });

  it('reads a version that is neither shape as neither', () => {
    const version = parseAsoundVersion(`${BANNER} vendor-audio-2024.3.\n`)!;

    expect(formOf(version)).toBe('unknown');
    expect(version).toMatchObject({ printed: 'vendor-audio-2024.3', release: null, alsaRelease: null });
  });

  /** A `k` with no release behind it is not the kernel form either. */
  it('does not read a k in front of a word as a kernel release', () => {
    expect(parseAsoundVersion(`${BANNER} kmod.\n`)).toMatchObject({
      printed: 'kmod',
      release: null,
      alsaRelease: null,
    });
  });

  it('marks a module compiled for a kernel other than the one named above it', () => {
    const version = parseAsoundVersion(
      `${BANNER} k6.8.0-45-generic.\nCompiled on Aug 11 2010 for kernel 2.6.32-24-generic.\n`,
    )!;

    expect(version.compiled).toMatchObject({ release: '2.6.32-24-generic', smp: false });
    expect(builtForAnotherKernel(version)).toBe(true);
  });

  it('skips the blank lines a file may end with', () => {
    expect(parseAsoundVersion(`\n${BANNER} k6.8.0-45-generic.\n\n`)?.release).toBe(
      '6.8.0-45-generic',
    );
  });

  it('returns null for a file that is not this file', () => {
    expect(parseAsoundVersion('')).toBeNull();
    expect(parseAsoundVersion('\n\n')).toBeNull();
    expect(parseAsoundVersion('Linux version 6.8.0-45-generic\n')).toBeNull();
  });
});
