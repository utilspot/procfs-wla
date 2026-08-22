import { describe, expect, it } from 'vitest';
import { readVersionFixture as fixture } from '../test/fixtures';
import { parseVersion, preemption, series } from './version';

describe('parseVersion — an Ubuntu desktop', () => {
  const version = parseVersion(fixture('ubuntu-desktop'))!;

  it('reads the release and its numeric part', () => {
    expect(version.os).toBe('Linux');
    expect(version.release).toBe('6.8.0-45-generic');
    expect(version.version).toBe('6.8.0');
    expect(version).toMatchObject({ major: 6, minor: 8, patch: 0 });
    expect(version.localVersion).toBe('45-generic');
    expect(series(version)).toBe('6.8');
  });

  it('splits the builder into user and host', () => {
    expect(version.buildUser).toBe('buildd');
    expect(version.buildHost).toBe('lcy02-amd64-098');
  });

  it('keeps each compiler whole, brackets and all', () => {
    expect(version.toolchain).toEqual([
      'x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0',
      'GNU ld (GNU Binutils for Ubuntu) 2.42',
    ]);
  });

  it('reads the build counter, its distribution tag and the flags', () => {
    expect(version.buildNumber).toBe(45);
    expect(version.buildTag).toBe('Ubuntu');
    expect(version.flags).toEqual(['SMP', 'PREEMPT_DYNAMIC']);
    expect(version.built).toBe('Fri Aug 30 12:02:04 UTC 2024');
    expect(preemption(version)).toBe('dynamic');
  });
});

describe('parseVersion — a Debian server', () => {
  const version = parseVersion(fixture('debian-server'))!;

  it('takes a mailing list as the builder', () => {
    expect(version.buildUser).toBe('debian-kernel');
    expect(version.buildHost).toBe('lists.debian.org');
  });

  // Debian ends the line with its own version rather than a date, and that
  // version carries brackets of its own — which must not be read as a group.
  it('keeps the trailing distribution version, brackets included', () => {
    expect(version.built).toBe('Debian 6.1.76-1 (2024-02-01)');
    expect(version.buildTag).toBeNull();
    expect(version.toolchain).toHaveLength(2);
  });
});

describe('parseVersion — a Raspberry Pi', () => {
  const version = parseVersion(fixture('rpi-arm64'))!;

  it('strips the + that starts a local version', () => {
    expect(version.release).toBe('6.6.31+rpt-rpi-v8');
    expect(version.version).toBe('6.6.31');
    expect(version.localVersion).toBe('rpt-rpi-v8');
  });

  it('reads plain PREEMPT as voluntary preemption', () => {
    expect(version.flags).toEqual(['SMP', 'PREEMPT']);
    expect(preemption(version)).toBe('voluntary');
  });
});

describe('parseVersion — a CentOS 6 kernel', () => {
  const version = parseVersion(fixture('legacy-centos'))!;

  it('reads a 2.6 release', () => {
    expect(version).toMatchObject({ major: 2, minor: 6, patch: 32 });
    expect(version.localVersion).toBe('754.35.1.el6.x86_64');
  });

  // `gcc version 4.4.7 20120313 (Red Hat 4.4.7-23) (GCC) ` — two bracket groups
  // inside the compiler group, and a trailing space before the closing bracket.
  it('keeps a nested old-style compiler banner in one piece', () => {
    expect(version.toolchain).toEqual(['gcc version 4.4.7 20120313 (Red Hat 4.4.7-23) (GCC)']);
  });

  it('reports no preemption when the kernel has no PREEMPT flag', () => {
    expect(version.flags).toEqual(['SMP']);
    expect(preemption(version)).toBe('none');
  });
});

describe('parseVersion — a realtime kernel', () => {
  const version = parseVersion(fixture('rt-preempt'))!;

  it('reads PREEMPT_RT', () => {
    expect(version.localVersion).toBe('rt16');
    expect(version.flags).toEqual(['SMP', 'PREEMPT_RT']);
    expect(preemption(version)).toBe('realtime');
  });
});

describe('parseVersion — every fixture', () => {
  const names = ['ubuntu-desktop', 'debian-server', 'rpi-arm64', 'legacy-centos', 'rt-preempt'];

  it.each(names)('parses %s into a usable banner', (name) => {
    const version = parseVersion(fixture(name))!;

    expect(version.os).toBe('Linux');
    expect(version.major).toBeGreaterThan(0);
    expect(version.buildNumber).not.toBeNull();
    expect(version.toolchain.length).toBeGreaterThan(0);
    expect(version.built).not.toBeNull();
    // The builder group is never mistaken for a compiler.
    expect(version.toolchain.join(' ')).not.toContain('@');
  });
});

describe('parseVersion — awkward input', () => {
  it('returns null for a file that is not a banner', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('\n\n')).toBeNull();
    expect(parseVersion('processor\t: 0\n')).toBeNull();
  });

  it('reads a banner with no builder, compiler or flags', () => {
    const version = parseVersion('Linux version 5.4.0 #1 Mon Jan 6 10:00:00 UTC 2020')!;

    expect(version.release).toBe('5.4.0');
    expect(version.localVersion).toBeNull();
    expect(version.buildUser).toBeNull();
    expect(version.toolchain).toEqual([]);
    expect(version.flags).toEqual([]);
    expect(version.built).toBe('Mon Jan 6 10:00:00 UTC 2020');
    expect(preemption(version)).toBe('none');
  });

  it('leaves an unbalanced bracket in the remainder rather than hanging', () => {
    const version = parseVersion('Linux version 5.4.0 (root@box #1 SMP')!;

    expect(version.release).toBe('5.4.0');
    expect(version.toolchain).toEqual([]);
    expect(version.buildNumber).toBeNull();
  });

  it('takes the first line of a file with trailing blank lines', () => {
    const version = parseVersion(`${fixture('rt-preempt')}\n\n`)!;
    expect(version.release).toBe('6.1.59-rt16');
  });
});
