/**
 * Parser for `/proc/kallsyms`.
 *
 * Every symbol in the running kernel, in address order, as `address type name`
 * with a tab and the module in brackets when one provides it:
 *
 *    ffffffff81002000 T do_syscall_64
 *    ffffffffc0000000 t nvme_probe	[nvme]
 *
 * The address is printed as-is, sixteen hex digits on a 64-bit kernel and
 * eight on a 32-bit one. It is **kept as the string the kernel wrote**: an
 * address such as `ffffffff81002000` is far past what a JavaScript number holds
 * exactly, and nothing here needs arithmetic on it.
 *
 * The type is a single `nm(1)` letter, and its **case means two different
 * things** depending on where the symbol comes from:
 *
 *  - for the kernel's own symbols, upper case is global and lower case is
 *    static to one file;
 *  - for a module's, the kernel upper-cases the letter when the symbol is
 *    exported with `EXPORT_SYMBOL` and lower-cases it otherwise, so the case
 *    says whether another module can link against it.
 *
 * See {@link scopeOf}, which is the one place that distinction is made.
 *
 * With `kptr_restrict` set, a reader without `CAP_SYSLOG` gets every address
 * as zero rather than being refused the file — see {@link addressesHidden}.
 */

/** What a type letter means, keyed by its lower-case form. */
export const TYPES: Readonly<Record<string, string>> = {
  a: 'absolute — the value is not an address that relocation changes',
  b: 'BSS — data that starts as zeroes',
  d: 'initialized data',
  i: 'indirect reference to another symbol',
  n: 'debugging',
  r: 'read-only data',
  t: 'text — code',
  u: 'unique global, one across the whole kernel',
  v: 'weak object, overridable without an error',
  w: 'weak symbol, overridable without an error',
};

export interface KernelSymbol {
  /** Hex exactly as printed, since a 64-bit address outruns a JS number. */
  address: string;
  /** The `nm(1)` type letter as printed, its case carrying meaning. */
  type: string;
  name: string;
  /** The module providing it, or null for one built into the kernel. */
  module: string | null;
}

export interface KallsymsInfo {
  symbols: KernelSymbol[];
}

/** `ffffffffc0000000 t nvme_probe\t[nvme]` */
const LINE = /^([0-9a-f]+)\s+(\S)\s+(\S+)(?:\s+\[([^\]]+)\])?\s*$/i;

export function parseKallsyms(text: string): KallsymsInfo {
  const symbols: KernelSymbol[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = LINE.exec(line);
    if (match === null) continue;

    symbols.push({
      address: (match[1] ?? '').toLowerCase(),
      type: match[2] ?? '',
      name: match[3] ?? '',
      module: match[4] ?? null,
    });
  }

  return { symbols };
}

/** What the type letter stands for, or null for one no tool names. */
export function typeName(type: string): string | null {
  return TYPES[type.toLowerCase()] ?? null;
}

/**
 * Whether the letter is upper case. Null for a letter with no case at all,
 * such as `?`, where nothing can be read from it.
 */
export function isUpperCase(type: string): boolean | null {
  if (type.toLowerCase() === type.toUpperCase()) return null;
  return type === type.toUpperCase();
}

export type Scope = 'global' | 'local' | 'exported' | 'internal';

/**
 * What the case of the type letter says about this symbol — which depends on
 * whether a module provides it. Null when the letter has no case to read.
 */
export function scopeOf(symbol: KernelSymbol): Scope | null {
  const upper = isUpperCase(symbol.type);
  if (upper === null) return null;

  if (symbol.module !== null) return upper ? 'exported' : 'internal';
  return upper ? 'global' : 'local';
}

/** Whether the address is nothing but zeroes, however wide it was printed. */
export function isZeroAddress(symbol: KernelSymbol): boolean {
  return /^0+$/.test(symbol.address);
}

/**
 * Every address is zero, which is `kptr_restrict` hiding them from a reader
 * without `CAP_SYSLOG` rather than a kernel whose symbols all sit at zero.
 */
export function addressesHidden(info: KallsymsInfo): boolean {
  return info.symbols.length > 0 && info.symbols.every((symbol) => isZeroAddress(symbol));
}

/** The modules providing symbols here, in the order they first appear. */
export function modules(info: KallsymsInfo): string[] {
  const seen = new Set<string>();

  for (const symbol of info.symbols) {
    if (symbol.module !== null) seen.add(symbol.module);
  }

  return Array.from(seen);
}

export interface TypeCount {
  /** The letter in its lower-case form; both cases are counted together. */
  type: string;
  count: number;
}

/** How many symbols carry each type letter, commonest first. */
export function countTypes(info: KallsymsInfo): TypeCount[] {
  const counts = new Map<string, number>();

  for (const symbol of info.symbols) {
    const type = symbol.type.toLowerCase();
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  return Array.from(counts, ([type, count]) => ({ type, count })).sort(
    (a, b) => b.count - a.count || a.type.localeCompare(b.type),
  );
}

export interface KallsymsSummary {
  total: number;
  /** Symbols the kernel itself provides, as opposed to a module. */
  builtIn: number;
  fromModules: number;
  modules: string[];
  /** Module symbols another module can link against. */
  exported: number;
  types: TypeCount[];
  hidden: boolean;
}

export function summarize(info: KallsymsInfo): KallsymsSummary {
  const fromModules = info.symbols.filter((symbol) => symbol.module !== null);

  return {
    total: info.symbols.length,
    builtIn: info.symbols.length - fromModules.length,
    fromModules: fromModules.length,
    modules: modules(info),
    exported: fromModules.filter((symbol) => scopeOf(symbol) === 'exported').length,
    types: countTypes(info),
    hidden: addressesHidden(info),
  };
}
