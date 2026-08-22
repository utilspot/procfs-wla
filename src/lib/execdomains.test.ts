import { describe, expect, it } from 'vitest';
import { readExecDomainsFixture as fixture } from '../test/fixtures';
import {
  abisOf,
  isBuiltIn,
  isStub,
  overlaps,
  parseExecDomains,
  personalitiesOf,
  personalityCount,
  personalityName,
  summarize,
} from './execdomains';

describe('parseExecDomains — a current kernel', () => {
  const info = parseExecDomains(fixture('modern-stub'));

  /**
   * Exec domains were removed in 4.1 and the file kept as a fixed line, so
   * this is what every current kernel prints whatever the machine is.
   */
  it('reads the single built-in Linux domain', () => {
    expect(info.domains).toEqual([{ low: 0, high: 0, name: 'Linux', module: 'kernel' }]);
    expect(isBuiltIn(info.domains[0]!)).toBe(true);
  });

  it('recognises the fixed line for what it is', () => {
    expect(isStub(info)).toBe(true);
    expect(summarize(info)).toMatchObject({ domains: 1, personalities: 1, stub: true });
    expect(summarize(info).fromModules).toEqual([]);
  });
});

describe('parseExecDomains — an ABI module loaded', () => {
  const info = parseExecDomains(fixture('svr4-module'));

  it('reads the domain the module registered', () => {
    expect(info.domains).toHaveLength(2);
    expect(info.domains[1]).toEqual({ low: 1, high: 1, name: 'SVR4', module: 'abi_svr4' });
  });

  // The bracketed name is `kernel` for a built-in domain and the module's
  // otherwise, which is the only thing that tells the two apart.
  it('tells a module domain from a built-in one', () => {
    expect(isBuiltIn(info.domains[0]!)).toBe(true);
    expect(isBuiltIn(info.domains[1]!)).toBe(false);
    expect(summarize(info).fromModules.map((domain) => domain.module)).toEqual(['abi_svr4']);
  });

  it('is no longer the fixed line once something else is registered', () => {
    expect(isStub(info)).toBe(false);
  });
});

describe('parseExecDomains — the full linux-abi stack', () => {
  const info = parseExecDomains(fixture('linux-abi'));

  it('reads every registered domain', () => {
    expect(info.domains.map((domain) => domain.name)).toEqual([
      'Linux',
      'SVR4',
      'SVR3',
      'SCO OpenServer',
      'Interactive UNIX',
      'Solaris',
      'UnixWare 7',
    ]);
  });

  // The name is padded to 16 columns, and two of these contain a space.
  it('keeps a name with a space in it, without its padding', () => {
    expect(info.domains[3]?.name).toBe('SCO OpenServer');
    expect(info.domains[6]?.name).toBe('UnixWare 7');
  });

  it('reads a two-digit personality number', () => {
    expect(info.domains[5]).toMatchObject({ low: 13, high: 13, module: 'abi_solaris' });
  });

  it('counts the personalities covered, not the domains', () => {
    const summary = summarize(info);

    expect(summary.domains).toBe(7);
    expect(summary.personalities).toBe(7);
    expect(summary.fromModules).toHaveLength(6);
  });
});

describe('parseExecDomains — one domain over a range', () => {
  const info = parseExecDomains(fixture('ibcs-range'));

  /**
   * A domain claims a range, not a number: the iBCS2 module took the SVR3,
   * SVR4, SCO, Wyse and Interactive personalities in one registration.
   */
  it('reads the whole range the domain claims', () => {
    expect(info.domains[1]).toMatchObject({ low: 1, high: 5, name: 'iBCS2' });
    expect(personalityCount(info.domains[1]!)).toBe(5);
    expect(personalitiesOf(info.domains[1]!)).toEqual([1, 2, 3, 4, 5]);
  });

  it('names every ABI in the range', () => {
    expect(abisOf(info.domains[1]!)).toEqual([
      'SVR4',
      'SVR3',
      'SCO OpenServer',
      'Wyse V/386',
      'Interactive UNIX',
    ]);
  });

  it('counts the range towards the personalities covered', () => {
    expect(summarize(info)).toMatchObject({ domains: 2, personalities: 6, stub: false });
  });
});

describe('parseExecDomains — a personality the kernel does not name', () => {
  const info = parseExecDomains(fixture('custom-domain'));

  // Only the PER_* constants have names; a domain may claim any number, and
  // there is nothing to say about one that stands for no known ABI.
  it('claims no ABI for a number outside the PER_* list', () => {
    expect(info.domains[1]).toMatchObject({ low: 42, high: 42, name: 'AcmeOS' });
    expect(abisOf(info.domains[1]!)).toEqual([]);
    expect(personalityName(42)).toBeNull();
  });

  it('still counts it as a personality covered', () => {
    expect(summarize(info)).toMatchObject({ domains: 2, personalities: 2 });
  });
});

describe('parseExecDomains — every fixture', () => {
  const names = ['modern-stub', 'svr4-module', 'linux-abi', 'ibcs-range', 'custom-domain'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseExecDomains(fixture(name));
    const summary = summarize(info);

    expect(info.domains.length).toBeGreaterThan(0);

    for (const domain of info.domains) {
      expect(domain.name).not.toBe('');
      expect(domain.module).not.toBe('');
      expect(Number.isInteger(domain.low)).toBe(true);
      expect(domain.low).toBeGreaterThanOrEqual(0);
      expect(domain.high).toBeGreaterThanOrEqual(domain.low);
    }

    // Every file has the Linux domain on personality 0, built into the kernel.
    expect(info.domains[0]).toMatchObject({ low: 0, high: 0, name: 'Linux', module: 'kernel' });

    // The kernel refuses to register a domain over a claimed personality.
    expect(summary.overlapping).toEqual([]);
    expect(summary.personalities).toBe(
      info.domains.reduce((total, domain) => total + personalityCount(domain), 0),
    );
    expect(summary.fromModules).toHaveLength(summary.domains - 1);
  });
});

describe('parseExecDomains — awkward input', () => {
  it('returns nothing for an empty file', () => {
    const info = parseExecDomains('');

    expect(info.domains).toEqual([]);
    expect(isStub(info)).toBe(false);
    expect(summarize(info)).toMatchObject({ domains: 0, personalities: 0, stub: false });
  });

  it('returns nothing for a file that is not /proc/execdomains', () => {
    expect(parseExecDomains('processor\t: 0\n').domains).toEqual([]);
  });

  it('reads a line however it is spaced', () => {
    expect(parseExecDomains('0-0 Linux [kernel]\n').domains).toEqual([
      { low: 0, high: 0, name: 'Linux', module: 'kernel' },
    ]);
  });

  it('skips a line with no domain name', () => {
    expect(parseExecDomains('0-0\t\t[kernel]\n').domains).toEqual([]);
  });

  it('skips a line with no bracketed module', () => {
    expect(parseExecDomains('0-0\tLinux\n').domains).toEqual([]);
  });

  // Not a real kernel's output, so nothing is invented for the range.
  it('claims no personalities for a range that runs backwards', () => {
    const info = parseExecDomains('5-1\tBackwards       \t[nonsense]\n');

    expect(personalityCount(info.domains[0]!)).toBe(0);
    expect(personalitiesOf(info.domains[0]!)).toEqual([]);
    expect(summarize(info).personalities).toBe(0);
  });

  /**
   * The kernel refused to register a domain overlapping one already there, so
   * an overlap means the file did not come from a running machine.
   */
  it('reports personalities claimed twice', () => {
    const info = parseExecDomains(
      '0-0\tLinux           \t[kernel]\n1-5\tiBCS2           \t[binfmt_coff]\n4-6\tOther           \t[abi_other]\n',
    );

    expect(overlaps(info)).toEqual([4, 5]);
    expect(summarize(info).overlapping).toEqual([4, 5]);
    // Each personality is counted once even though two domains claim it.
    expect(summarize(info).personalities).toBe(7);
  });

  it('names only the personalities the kernel has constants for', () => {
    expect(personalityName(0)).toBe('Linux');
    expect(personalityName(13)).toBe('Solaris');
    expect(personalityName(16)).toBe('HP-UX');
    expect(personalityName(17)).toBeNull();
    expect(personalityName(-1)).toBeNull();
  });

  it('is not the fixed line when the Linux domain came from a module', () => {
    expect(isStub(parseExecDomains('0-0\tLinux           \t[some_module]\n'))).toBe(false);
    expect(isStub(parseExecDomains('0-5\tLinux           \t[kernel]\n'))).toBe(false);
  });
});
