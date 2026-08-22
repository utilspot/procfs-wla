import { describe, expect, it } from 'vitest';
import { readVersionSignatureFixture as fixture } from '../test/fixtures';
import {
  DERIVATIVE_ABI,
  describeFlavour,
  fieldsOf,
  hidesUpstream,
  isBackport,
  isDerivative,
  parseVersionSignature,
  seriesAgree,
  seriesOf,
  summarize,
  unameRelease,
} from './version_signature';

describe('parseVersionSignature — an ordinary Ubuntu server', () => {
  const signature = parseVersionSignature(fixture('generic'))!;

  it('reads the three fields the line is made of', () => {
    expect(signature).toMatchObject({
      vendor: 'Ubuntu',
      packageVersion: '5.15.0-91.101-generic',
      upstream: '5.15.131',
    });
  });

  /** The package version carries two numbers where it looks like one. */
  it('takes the ABI number apart from the upload number', () => {
    expect(signature).toMatchObject({
      base: '5.15.0',
      abi: 91,
      upload: 101,
      flavour: 'generic',
      backport: null,
    });
  });

  /**
   * The upload number and any backport suffix do not survive into uname -r,
   * which is why two machines agreeing there can be running different builds.
   */
  it('works out what uname -r would say', () => {
    expect(unameRelease(signature)).toBe('5.15.0-91-generic');
  });

  /**
   * Ubuntu freezes the base version's last component, so uname names the
   * series and this field names the release.
   */
  it('reads the upstream release uname -r hides', () => {
    expect(hidesUpstream(signature)).toBe(true);
    expect(signature.upstream).toBe('5.15.131');
    expect(seriesAgree(signature)).toBe(true);
  });

  it('summarizes the kernel', () => {
    const summary = summarize(signature);

    expect(summary).toMatchObject({
      vendor: 'Ubuntu',
      upstream: '5.15.131',
      uname: '5.15.0-91-generic',
      abi: 91,
      upload: 101,
      flavour: 'generic',
      backport: null,
      derivative: false,
      hidesUpstream: true,
      seriesMismatch: false,
    });
  });

  it('lays the line out a piece at a time', () => {
    const fields = fieldsOf(signature);

    expect(fields.map((field) => field.label)).toEqual([
      'vendor',
      'base version',
      'ABI number',
      'upload number',
      'flavour',
      'upstream release',
    ]);
    expect(fields.find((field) => field.label === 'ABI number')?.value).toBe('91');
    expect(fields.find((field) => field.label === 'upload number')?.note).toMatch(
      /nowhere in uname -r/,
    );
  });
});

describe('parseVersionSignature — an HWE kernel backported to an older release', () => {
  // Read off the machine this was written on, where uname -r says
  // 7.0.0-28-generic and the tree is really 7.0.12.
  const signature = parseVersionSignature(fixture('hwe-backport'))!;

  it('reads the backport suffix out of the package version', () => {
    expect(signature).toMatchObject({
      base: '7.0.0',
      abi: 28,
      upload: 28,
      backport: '24.04.1',
      flavour: 'generic',
    });
    expect(isBackport(signature)).toBe(true);
  });

  /** The suffix is in the package version and not in uname -r. */
  it('leaves the suffix out of what uname -r would say', () => {
    expect(unameRelease(signature)).toBe('7.0.0-28-generic');
    expect(unameRelease(signature)).not.toContain('24.04.1');
  });

  it('names the upstream release behind the frozen base', () => {
    expect(summarize(signature)).toMatchObject({ upstream: '7.0.12', hidesUpstream: true });
  });

  it('says what the suffix means', () => {
    const backport = fieldsOf(signature).find((field) => field.label === 'backported to')!;

    expect(backport.value).toBe('24.04.1');
    expect(backport.note).toMatch(/HWE/);
  });
});

describe('parseVersionSignature — a cloud kernel', () => {
  const signature = parseVersionSignature(fixture('cloud-azure'))!;

  /**
   * Derivatives number their ABI from 1000 upwards, separately from generic's,
   * so four digits is a flavour rather than a thousand ABI breaks.
   */
  it('reads a four-digit ABI as a derivative’s numbering', () => {
    expect(signature.abi).toBe(1053);
    expect(signature.abi!).toBeGreaterThanOrEqual(DERIVATIVE_ABI);
    expect(isDerivative(signature)).toBe(true);
    expect(unameRelease(signature)).toBe('5.15.0-1053-azure');
  });

  it('says what the flavour is for', () => {
    expect(describeFlavour('azure')).toMatch(/Built for Azure/);
    expect(describeFlavour(signature.flavour)).toMatch(/Built for Azure/);
  });

  it('leaves the generic kernel out of it', () => {
    expect(isDerivative(parseVersionSignature(fixture('generic'))!)).toBe(false);
  });
});

describe('parseVersionSignature — the other flavours', () => {
  it('reads a low-latency build', () => {
    const signature = parseVersionSignature(fixture('lowlatency'))!;

    expect(signature.flavour).toBe('lowlatency');
    expect(describeFlavour('lowlatency')).toMatch(/faster tick/);
    expect(unameRelease(signature)).toBe('6.8.0-31-lowlatency');
  });

  /** A board kernel: derivative numbering, and the two versions agreeing. */
  it('reads a Raspberry Pi build whose two versions agree', () => {
    const signature = parseVersionSignature(fixture('raspi'))!;

    expect(signature).toMatchObject({ base: '6.8.0', abi: 1008, flavour: 'raspi' });
    expect(isDerivative(signature)).toBe(true);
    expect(hidesUpstream(signature)).toBe(false);
    expect(summarize(signature).hidesUpstream).toBe(false);
  });

  it('has no note for a flavour it does not know', () => {
    expect(describeFlavour('intel-iotg')).toBeNull();
    expect(describeFlavour(null)).toBeNull();
  });
});

describe('parseVersionSignature — a kernel from the 2.6 days', () => {
  const signature = parseVersionSignature(fixture('legacy-lucid'))!;

  /** A three-component base, and an upstream with four and a suffix. */
  it('reads a version shaped the way that era’s were', () => {
    expect(signature).toMatchObject({
      base: '2.6.32',
      abi: 21,
      upload: 32,
      flavour: 'generic',
      upstream: '2.6.32.11+drm33.2',
    });
    expect(unameRelease(signature)).toBe('2.6.32-21-generic');
  });

  it('still reads the series off both fields', () => {
    expect(seriesOf(signature.base!)).toBe('2.6');
    expect(seriesOf(signature.upstream)).toBe('2.6');
    expect(seriesAgree(signature)).toBe(true);
  });
});

describe('parseVersionSignature — the awkward files', () => {
  it('reads an empty file as no signature at all', () => {
    expect(parseVersionSignature('')).toBeNull();
    expect(parseVersionSignature('\n\n')).toBeNull();
  });

  it('refuses a line with nothing but a vendor on it', () => {
    expect(parseVersionSignature('Ubuntu\n')).toBeNull();
  });

  it('reads CRLF line endings', () => {
    const signature = parseVersionSignature('Ubuntu 5.15.0-91.101-generic 5.15.131\r\n')!;

    expect(signature.abi).toBe(91);
    expect(signature.upstream).toBe('5.15.131');
  });

  /**
   * A package version it cannot take apart still leaves the line readable,
   * rather than throwing the whole file away.
   */
  it('keeps what it can from a package version it cannot parse', () => {
    const signature = parseVersionSignature('Ubuntu something-odd 5.15.131')!;

    expect(signature).toMatchObject({
      vendor: 'Ubuntu',
      packageVersion: 'something-odd',
      upstream: '5.15.131',
      abi: null,
      flavour: null,
    });
    expect(unameRelease(signature)).toBeNull();
    expect(fieldsOf(signature).map((field) => field.label)).toEqual(['vendor', 'upstream release']);
  });

  it('does not invent an upstream release that was not printed', () => {
    const signature = parseVersionSignature('Ubuntu 5.15.0-91.101-generic')!;

    expect(signature.upstream).toBe('');
    expect(hidesUpstream(signature)).toBe(false);
    expect(seriesAgree(signature)).toBe(true);
  });

  /** A package cannot have been built from a different series' tree. */
  it('notices two version fields that disagree about the series', () => {
    const signature = parseVersionSignature('Ubuntu 5.15.0-91.101-generic 5.4.44')!;

    expect(seriesAgree(signature)).toBe(false);
    expect(summarize(signature).seriesMismatch).toBe(true);
  });

  it('reads a vendor that is not Ubuntu without complaint', () => {
    expect(parseVersionSignature('Pop!_OS 6.8.0-31.31-generic 6.8.1')?.vendor).toBe('Pop!_OS');
  });
});

describe('seriesOf', () => {
  it('reads the X.Y a version belongs to', () => {
    expect(seriesOf('7.0.12')).toBe('7.0');
    expect(seriesOf('5.15.131')).toBe('5.15');
    expect(seriesOf('2.6.32.11+drm33.2')).toBe('2.6');
    expect(seriesOf('nonsense')).toBeNull();
  });
});
