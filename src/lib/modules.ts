/**
 * Parser for `/proc/modules`, the file behind `lsmod`.
 *
 * One line per loaded module, six fields and an optional seventh:
 *
 *   nf_conntrack 172032 6 nf_nat,xt_conntrack, Live 0xffffffffc0a12000
 *   nvidia 56717312 43 nvidia_modeset, Live 0xffffffffc1800000 (PO)
 *   snd_hda_intel 53248 5 - Live 0xffffffffc09e0000
 *
 *   name  size  use count  used-by  state  address  [taint]
 *
 * The fourth field is the thing most people read backwards: it lists the
 * modules that **depend on this one**, not the ones it depends on — `lsmod`
 * heads the column "Used by" for that reason. It ends in a trailing comma and
 * is `-` when nothing uses the module. {@link dependencies} inverts the whole
 * table to answer the other question.
 *
 * The use count is usually the length of that list but can be higher: an open
 * device node or a mounted filesystem holds a reference without being a module.
 *
 * The address is `0x0000000000000000` for every module unless the reader is
 * privileged, since `kptr_restrict` hides kernel pointers by default.
 */

export interface Module {
  name: string;
  /** Memory the module occupies, in bytes. */
  size: number;
  /** References held on the module, which can exceed `usedBy.length`. */
  useCount: number;
  /** Modules that depend on this one — the kernel's own field. */
  usedBy: string[];
  /** `Live`, `Loading` or `Unloading`. */
  state: string;
  /** Load address, or null when the kernel hid it. */
  address: string | null;
  /** Taint letters the module carries, e.g. `['P', 'O']`. */
  taints: string[];
}

/**
 * What each taint letter means, from
 * `Documentation/admin-guide/tainted-kernels.rst`. Anything unrecognised is
 * kept and shown as-is rather than dropped.
 */
const TAINTS: Record<string, string> = {
  P: 'proprietary, not GPL-compatible',
  O: 'built out of tree',
  E: 'unsigned',
  F: 'force loaded',
  C: 'staging driver',
  X: 'auxiliary taint, defined by the distribution',
};

export function describeTaint(letter: string): string {
  return TAINTS[letter] ?? 'unknown taint';
}

/** An address of nothing but zeroes is `kptr_restrict` hiding it. */
const HIDDEN_ADDRESS = /^0x0+$/;

export function parseModules(text: string): Module[] {
  const modules: Module[] = [];

  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/).filter((field) => field !== '');
    // name, size, use count, used-by, state, address — six at minimum.
    if (fields.length < 6) continue;

    const [name, size, useCount, usedBy, state, address, ...rest] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      ...string[],
    ];

    if (!/^\d+$/.test(size) || !/^\d+$/.test(useCount)) continue;

    // `(PO)` — one group of letters, or absent.
    const taint = rest.find((field) => field.startsWith('(') && field.endsWith(')'));

    modules.push({
      name,
      size: Number(size),
      useCount: Number(useCount),
      usedBy:
        usedBy === '-'
          ? []
          : usedBy
              .split(',')
              .map((dependent) => dependent.trim())
              .filter((dependent) => dependent !== ''),
      state,
      address: HIDDEN_ADDRESS.test(address) ? null : address,
      taints: taint === undefined ? [] : [...taint.slice(1, -1)],
    });
  }

  return modules;
}

/**
 * Inverts the `usedBy` lists: what each module depends on. The file only states
 * the relationship one way round, so this is the only way to answer "what does
 * this module need?" from it.
 */
export function dependencies(modules: readonly Module[]): Map<string, string[]> {
  const needs = new Map<string, string[]>(modules.map((module) => [module.name, []]));

  for (const module of modules) {
    for (const dependent of module.usedBy) {
      const existing = needs.get(dependent);
      // A dependent that is not itself a line in the file is still recorded.
      if (existing === undefined) needs.set(dependent, [module.name]);
      else if (!existing.includes(module.name)) existing.push(module.name);
    }
  }

  return needs;
}

/**
 * Nothing holds a reference and nothing depends on it, so `rmmod` would take
 * it out. Not the same as unnecessary — a driver for idle hardware looks like
 * this too.
 */
export function isRemovable(module: Module): boolean {
  return module.useCount === 0 && module.usedBy.length === 0;
}

/** A module carrying any taint at all. */
export function isTainted(module: Module): boolean {
  return module.taints.length > 0;
}

export interface ModulesSummary {
  count: number;
  totalBytes: number;
  removable: number;
  /** Modules carrying a taint, largest first. */
  tainted: Module[];
  /** Every taint letter present, with how many modules carry it. */
  taints: { letter: string; count: number }[];
  /** Modules not in the `Live` state, which is worth noticing. */
  unsettled: Module[];
  /** By memory, largest first. */
  largest: Module[];
}

export function summarize(modules: readonly Module[]): ModulesSummary {
  const letters = new Map<string, number>();
  for (const module of modules) {
    for (const letter of module.taints) {
      letters.set(letter, (letters.get(letter) ?? 0) + 1);
    }
  }

  const bySize = [...modules].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));

  return {
    count: modules.length,
    totalBytes: modules.reduce((sum, module) => sum + module.size, 0),
    removable: modules.filter(isRemovable).length,
    tainted: bySize.filter(isTainted),
    taints: [...letters]
      .map(([letter, count]) => ({ letter, count }))
      .sort((a, b) => b.count - a.count || a.letter.localeCompare(b.letter)),
    unsettled: modules.filter((module) => module.state !== 'Live'),
    largest: bySize,
  };
}

/** `1.2 MiB` — module sizes run from a few kilobytes to tens of megabytes. */
export function formatBytes(value: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? size : size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}
