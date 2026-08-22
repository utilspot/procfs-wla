import { describe, expect, it } from 'vitest';
import { readCryptoFixture as fixture } from '../test/fixtures';
import { isAccelerated, isGeneric, parseCrypto, preferred, summarize } from './crypto';

describe('parseCrypto — an x86 laptop', () => {
  const algorithms = parseCrypto(fixture('x86-aesni'));

  it('reads a block per registered implementation', () => {
    expect(algorithms).toHaveLength(17);
  });

  it('reads the fields common to every type', () => {
    const xts = algorithms.find((algorithm) => algorithm.driver === 'xts-aes-aesni')!;

    expect(xts).toMatchObject({
      name: 'xts(aes)',
      module: 'aesni_intel',
      priority: 401,
      refcnt: 3,
      selftest: 'passed',
      internal: false,
      type: 'skcipher',
      async: true,
      blocksize: 16,
      minKeysize: 32,
      maxKeysize: 64,
      ivsize: 16,
    });
  });

  it('reads the fields only some types carry', () => {
    const sha256 = algorithms.find((algorithm) => algorithm.driver === 'sha256-avx2')!;
    const gcm = algorithms.find((algorithm) => algorithm.driver === 'generic-gcm-aesni')!;

    expect(sha256).toMatchObject({ type: 'shash', digestsize: 32, blocksize: 64 });
    // A hash has no key sizes, and they must read as absent rather than zero.
    expect(sha256).toMatchObject({ minKeysize: null, maxKeysize: null, ivsize: null });
    expect(gcm).toMatchObject({ type: 'aead', maxauthsize: 16, ivsize: 12 });
  });

  it('keeps every field of a block, including ones it has no column for', () => {
    const gcm = algorithms.find((algorithm) => algorithm.driver === 'generic-gcm-aesni')!;

    expect(gcm.get('geniv')).toBe('<none>');
    expect(gcm.get('GENIV')).toBe('<none>');
    expect(gcm.fields[0]).toEqual({ key: 'name', value: 'gcm(aes)' });
  });

  it('marks the internal building blocks', () => {
    const ghash = algorithms.find((algorithm) => algorithm.driver === 'ghash-clmulni')!;
    expect(ghash.internal).toBe(true);
    expect(algorithms.filter((algorithm) => algorithm.internal)).toHaveLength(1);
  });

  it('summarizes the registrations', () => {
    const summary = summarize(algorithms);

    expect(summary.total).toBe(17);
    // Fewer names than implementations: four names have a driver competing.
    expect(summary.names).toBe(13);
    expect(summary.contested).toBe(4);
    expect(summary.internal).toBe(1);
    expect(summary.asynchronous).toBe(3);
    expect(summary.untested).toEqual([]);
    expect(summary.types[0]).toEqual({ type: 'shash', count: 6 });
  });

  it('picks the highest-priority driver for each name', () => {
    const winners = preferred(algorithms);

    expect(winners.get('aes')?.driver).toBe('aes-aesni');
    expect(winners.get('cbc(aes)')?.driver).toBe('cbc-aes-aesni');
    expect(winners.get('gcm(aes)')?.driver).toBe('generic-gcm-aesni');
    expect(winners.get('sha256')?.driver).toBe('sha256-avx2');
    expect(winners.size).toBe(13);
  });
});

describe('parseCrypto — an ARM64 board', () => {
  const algorithms = parseCrypto(fixture('arm-ce'));

  it('notices a driver whose self-test failed', () => {
    const summary = summarize(algorithms);

    expect(summary.untested.map((algorithm) => algorithm.driver)).toEqual(['sha3-256-ce']);
    expect(summary.untested[0]?.selftest).toBe('failed');
  });

  // The kernel picks by priority alone, so a failed accelerator still shows as
  // preferred here — the page has to surface the failure rather than hide it.
  it('still reports the failed driver as the preferred one', () => {
    expect(preferred(algorithms).get('sha3-256')?.driver).toBe('sha3-256-ce');
  });

  it('recognises the ARM crypto extension and NEON drivers', () => {
    expect(isAccelerated(algorithms.find((a) => a.driver === 'cbc-aes-ce')!)).toBe(true);
    // `neonbs` is the bit-sliced NEON driver — the marker is a prefix here.
    expect(isAccelerated(algorithms.find((a) => a.driver === 'cbc-aes-neonbs')!)).toBe(true);
    expect(isAccelerated(algorithms.find((a) => a.driver === 'sha256-arm64')!)).toBe(true);
    expect(isAccelerated(algorithms.find((a) => a.driver === 'aes-generic')!)).toBe(false);
    expect(isGeneric(algorithms.find((a) => a.driver === 'aes-generic')!)).toBe(true);
  });
});

describe('parseCrypto — a plain VM', () => {
  const algorithms = parseCrypto(fixture('generic-vm'));

  it('has no accelerated driver at all', () => {
    expect(algorithms.every((algorithm) => !isAccelerated(algorithm))).toBe(true);
    expect(summarize(algorithms).asynchronous).toBe(0);
  });

  it('reads a larval entry, which carries almost no fields', () => {
    const larval = algorithms.find((algorithm) => algorithm.type === 'larval')!;

    expect(larval.selftest).toBe('unknown');
    expect(larval.internal).toBe(true);
    expect(larval.blocksize).toBeNull();
    expect(larval.get('flags')).toBe('0x0');
    expect(summarize(algorithms).untested).toHaveLength(1);
  });

  it('has one implementation per name, so nothing is contested', () => {
    expect(summarize(algorithms).contested).toBe(0);
    expect(preferred(algorithms).size).toBe(algorithms.length);
  });
});

describe('parseCrypto — every fixture', () => {
  const names = ['x86-aesni', 'arm-ce', 'generic-vm', 'fips-mode', 'minimal-embedded'];

  it.each(names)('parses %s into usable algorithms', (name) => {
    const algorithms = parseCrypto(fixture(name));

    expect(algorithms.length).toBeGreaterThan(0);
    for (const algorithm of algorithms) {
      expect(algorithm.name).not.toBe('');
      expect(algorithm.driver).not.toBe('');
      expect(algorithm.type).not.toBe('unknown');
      expect(algorithm.priority).toBeGreaterThanOrEqual(0);
    }

    // Every name resolves to exactly one preferred implementation.
    expect(preferred(algorithms).size).toBe(summarize(algorithms).names);
  });
});

describe('parseCrypto — awkward input', () => {
  it('returns nothing for a file that is not /proc/crypto', () => {
    expect(parseCrypto('')).toEqual([]);
    expect(parseCrypto('cpu  1 2 3 4\nctxt 99\n')).toEqual([]);
  });

  it('skips a block with neither a name nor a driver', () => {
    const algorithms = parseCrypto('module : kernel\npriority : 100\n\nname : x\ndriver : x-generic\n');

    expect(algorithms).toHaveLength(1);
    expect(algorithms[0]?.name).toBe('x');
  });

  it('falls back for the fields a block leaves out', () => {
    const [algorithm] = parseCrypto('name : x\ndriver : x-generic\n');

    expect(algorithm).toMatchObject({
      module: 'kernel',
      priority: 0,
      refcnt: 0,
      selftest: 'unknown',
      internal: false,
      type: 'unknown',
      async: null,
      blocksize: null,
    });
  });

  it('copes with blank lines and stray whitespace between blocks', () => {
    const algorithms = parseCrypto(
      '\n\nname : a\ndriver : a-generic\ntype : cipher\n\n   \n\nname : b\ndriver : b-generic\ntype : shash\n\n',
    );

    expect(algorithms.map((algorithm) => algorithm.name)).toEqual(['a', 'b']);
  });

  it('keeps a colon that appears inside a value', () => {
    const [algorithm] = parseCrypto('name : x\ndriver : x-generic\ngeniv : <none>:0\n');

    expect(algorithm?.get('geniv')).toBe('<none>:0');
  });

  it('breaks a tie on priority by the order the kernel registered them', () => {
    const algorithms = parseCrypto(
      'name : a\ndriver : first\npriority : 100\n\nname : a\ndriver : second\npriority : 100\n',
    );

    expect(preferred(algorithms).get('a')?.driver).toBe('first');
  });
});
