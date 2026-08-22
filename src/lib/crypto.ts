/**
 * Parser for `/proc/crypto`.
 *
 * The kernel's crypto API registers one block per algorithm implementation,
 * blank-line separated, each a list of `key : value` lines:
 *
 *   name         : cbc(aes)
 *   driver       : cbc(aes-aesni)
 *   module       : kernel
 *   priority     : 300
 *   refcnt       : 1
 *   selftest     : passed
 *   internal     : no
 *   type         : skcipher
 *   blocksize    : 16
 *   min keysize  : 16
 *
 * `name` is the algorithm — several implementations of it can be registered at
 * once, each with its own `driver` and `priority`. That is the point of the
 * file: `aes` on an x86 machine is registered generically *and* as `aes-aesni`,
 * and the kernel uses whichever has the highest priority. See
 * {@link preferred}.
 *
 * Which fields a block carries depends on its `type` — a hash has `digestsize`,
 * a skcipher has key sizes and an `ivsize`, an `aead` adds `maxauthsize` — so
 * every field is kept as it appeared and the common ones are also read out into
 * typed properties, absent where the block did not carry them.
 */

export interface CryptoField {
  key: string;
  value: string;
}

export interface CryptoAlgorithm {
  /** The algorithm, e.g. `cbc(aes)`. Not unique: one per implementation. */
  name: string;
  /** The implementation, e.g. `cbc(aes-aesni)`. Unique within a running kernel. */
  driver: string;
  /** Module providing it, or `kernel` when it is built in. */
  module: string;
  /** Higher wins when several drivers offer the same name. */
  priority: number;
  refcnt: number;
  /** `passed`, `unknown` for an algorithm still being set up, or `failed`. */
  selftest: string;
  /** Internal algorithms are building blocks, not usable on their own. */
  internal: boolean;
  /** `skcipher`, `shash`, `aead`, `akcipher`, `rng`, `larval`, … */
  type: string;
  async: boolean | null;
  blocksize: number | null;
  digestsize: number | null;
  minKeysize: number | null;
  maxKeysize: number | null;
  ivsize: number | null;
  maxauthsize: number | null;
  seedsize: number | null;
  /** Every field of the block, in file order. */
  fields: CryptoField[];
  /** Case-insensitive lookup of those fields. */
  get(key: string): string | undefined;
}

function parseBlock(block: string): CryptoField[] {
  const fields: CryptoField[] = [];

  for (const line of block.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (key === '') continue;
    fields.push({ key, value: line.slice(separator + 1).trim() });
  }

  return fields;
}

function makeAlgorithm(fields: CryptoField[]): CryptoAlgorithm | null {
  const lookup = new Map(fields.map((field) => [field.key.toLowerCase(), field.value]));
  const get = (key: string): string | undefined => lookup.get(key.toLowerCase());

  const name = get('name');
  const driver = get('driver');
  // A block with no name and no driver is not an algorithm.
  if (name === undefined || driver === undefined) return null;

  const number = (key: string): number | null => {
    const raw = get(key);
    if (raw === undefined) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const flag = (key: string): boolean | null => {
    const raw = get(key);
    return raw === undefined ? null : raw === 'yes';
  };

  return {
    name,
    driver,
    module: get('module') ?? 'kernel',
    priority: number('priority') ?? 0,
    refcnt: number('refcnt') ?? 0,
    selftest: get('selftest') ?? 'unknown',
    internal: flag('internal') ?? false,
    type: get('type') ?? 'unknown',
    async: flag('async'),
    blocksize: number('blocksize'),
    digestsize: number('digestsize'),
    minKeysize: number('min keysize'),
    maxKeysize: number('max keysize'),
    ivsize: number('ivsize'),
    maxauthsize: number('maxauthsize'),
    seedsize: number('seedsize'),
    fields,
    get,
  };
}

export function parseCrypto(text: string): CryptoAlgorithm[] {
  const algorithms: CryptoAlgorithm[] = [];

  for (const block of text.split(/\n\s*\n/)) {
    const fields = parseBlock(block);
    if (fields.length === 0) continue;

    const algorithm = makeAlgorithm(fields);
    if (algorithm !== null) algorithms.push(algorithm);
  }

  return algorithms;
}

export interface CryptoSummary {
  /** Registered implementations, i.e. blocks in the file. */
  total: number;
  /** Distinct algorithm names, which is fewer when drivers compete. */
  names: number;
  /** Types with how many implementations each, most first. */
  types: { type: string; count: number }[];
  /** Anything whose self-test did not pass — worth noticing. */
  untested: CryptoAlgorithm[];
  internal: number;
  /** Implementations the kernel runs asynchronously, usually off-CPU. */
  asynchronous: number;
  /** Names with more than one implementation registered. */
  contested: number;
}

export function summarize(algorithms: readonly CryptoAlgorithm[]): CryptoSummary {
  const counts = new Map<string, number>();
  for (const algorithm of algorithms) {
    counts.set(algorithm.type, (counts.get(algorithm.type) ?? 0) + 1);
  }

  const byName = new Map<string, number>();
  for (const algorithm of algorithms) {
    byName.set(algorithm.name, (byName.get(algorithm.name) ?? 0) + 1);
  }

  return {
    total: algorithms.length,
    names: byName.size,
    types: [...counts]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    untested: algorithms.filter((algorithm) => algorithm.selftest !== 'passed'),
    internal: algorithms.filter((algorithm) => algorithm.internal).length,
    asynchronous: algorithms.filter((algorithm) => algorithm.async === true).length,
    contested: [...byName.values()].filter((count) => count > 1).length,
  };
}

/**
 * The implementation the kernel would pick for each name: the highest priority,
 * and among equals the one registered first, which is how the crypto API
 * resolves a tie.
 */
export function preferred(algorithms: readonly CryptoAlgorithm[]): Map<string, CryptoAlgorithm> {
  const winners = new Map<string, CryptoAlgorithm>();

  for (const algorithm of algorithms) {
    const current = winners.get(algorithm.name);
    if (current === undefined || algorithm.priority > current.priority) {
      winners.set(algorithm.name, algorithm);
    }
  }

  return winners;
}

/**
 * Whether a driver looks hardware-accelerated, from the suffixes the kernel
 * uses for them: AES-NI and SHA-NI on x86, the ARM crypto extensions and NEON,
 * POWER's VMX, s390's CPACF, and VIA PadLock.
 *
 * A hint for reading the table, not something the kernel states outright — the
 * authoritative signal that a driver is preferred is its priority.
 */
const ACCELERATED =
  /(?:^|[-_(])(aesni|sha_?ni|ce|neon[a-z]*|arm64|vmx|vpmsum|s390|cpacf|padlock|ppc|avx2?|sse\d?|asm)(?:$|[-_)])/;

export function isAccelerated(algorithm: CryptoAlgorithm): boolean {
  return ACCELERATED.test(algorithm.driver);
}

/** `generic` drivers are the portable C fallbacks every kernel carries. */
export function isGeneric(algorithm: CryptoAlgorithm): boolean {
  return /(?:^|[-_(])generic(?:$|[-_)])/.test(algorithm.driver);
}
