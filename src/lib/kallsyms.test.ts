import { describe, expect, it } from 'vitest';
import { readKallsymsFixture as fixture } from '../test/fixtures';
import {
  addressesHidden,
  countTypes,
  isUpperCase,
  isZeroAddress,
  modules,
  parseKallsyms,
  scopeOf,
  summarize,
  typeName,
} from './kallsyms';

describe('parseKallsyms — the kernel’s own symbols', () => {
  const info = parseKallsyms(fixture('kernel-text'));

  it('reads an address, a type and a name', () => {
    expect(info.symbols[3]).toEqual({
      address: 'ffffffff81000000',
      type: 'T',
      name: 'startup_64',
      module: null,
    });
  });

  /**
   * The address is kept as written: `ffffffff81000000` is past what a JS
   * number holds exactly, and turning it into one would quietly round it.
   */
  it('keeps the address as the kernel wrote it', () => {
    const address = info.symbols[3]!.address;

    expect(address).toBe('ffffffff81000000');
    expect(address).toHaveLength(16);
    expect(Number(`0x${address}`)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
  });

  // For a built-in symbol, the case is global against static.
  it('reads the case of the type letter as scope', () => {
    expect(scopeOf(info.symbols[3]!)).toBe('global');
    expect(scopeOf(info.symbols.find((symbol) => symbol.name === 'verify_cpu')!)).toBe('local');
  });

  it('names what each type letter stands for', () => {
    expect(typeName('T')).toMatch(/text/);
    expect(typeName('t')).toBe(typeName('T'));
    expect(typeName('b')).toMatch(/BSS/);
    expect(typeName('A')).toMatch(/absolute/);
  });

  it('counts the type letters, both cases together, commonest first', () => {
    const counts = countTypes(info);

    expect(counts[0]).toEqual({ type: 't', count: 7 });
    expect(counts.find((entry) => entry.type === 'a')).toEqual({ type: 'a', count: 3 });
    expect(counts.every((entry) => entry.type === entry.type.toLowerCase())).toBe(true);
  });

  it('has nothing from a module', () => {
    const summary = summarize(info);

    expect(summary).toMatchObject({ total: 17, builtIn: 17, fromModules: 0, exported: 0 });
    expect(summary.modules).toEqual([]);
  });
});

describe('parseKallsyms — with modules loaded', () => {
  const info = parseKallsyms(fixture('with-modules'));

  it('reads the module out of the brackets', () => {
    expect(info.symbols.find((symbol) => symbol.name === 'nvme_probe')).toEqual({
      address: 'ffffffffc0000000',
      type: 't',
      name: 'nvme_probe',
      module: 'nvme',
    });
  });

  /**
   * For a module symbol the kernel upper-cases the letter when the symbol is
   * exported, so the case means something different here than it does for a
   * built-in one.
   */
  it('reads the case of a module symbol as exported or not', () => {
    const exported = info.symbols.find((symbol) => symbol.name === 'nvme_complete_rq')!;
    const internal = info.symbols.find((symbol) => symbol.name === 'nvme_probe')!;

    expect(scopeOf(exported)).toBe('exported');
    expect(scopeOf(internal)).toBe('internal');
    // The same letter case on a built-in symbol means global instead.
    expect(scopeOf(info.symbols.find((symbol) => symbol.name === 'do_syscall_64')!)).toBe('global');
  });

  it('lists the modules in the order they first appear', () => {
    expect(modules(info)).toEqual(['nvme', 'ext4', 'vboxguest']);
  });

  it('counts what came from modules and what is exported', () => {
    expect(summarize(info)).toMatchObject({
      total: 15,
      builtIn: 4,
      fromModules: 11,
      exported: 4,
    });
  });
});

describe('parseKallsyms — read under kptr_restrict', () => {
  const info = parseKallsyms(fixture('restricted'));

  /**
   * Zeroed addresses are the kernel hiding pointers from a reader without
   * CAP_SYSLOG; the names, types and modules all still arrive.
   */
  it('reads the zeroed addresses as hidden', () => {
    expect(addressesHidden(info)).toBe(true);
    expect(summarize(info).hidden).toBe(true);
    expect(info.symbols.map((symbol) => symbol.name)).toContain('do_syscall_64');
  });

  it('keeps everything the kernel did not hide', () => {
    expect(summarize(info)).toMatchObject({ total: 8, fromModules: 3, exported: 1 });
    expect(modules(info)).toEqual(['nvme', 'ext4']);
  });
});

describe('parseKallsyms — a 32-bit kernel', () => {
  const info = parseKallsyms(fixture('i386-32bit'));

  // Eight hex digits rather than sixteen, and nothing else changes.
  it('reads a narrower address', () => {
    expect(info.symbols[0]).toMatchObject({ address: 'c1000000', name: 'startup_32' });
    expect(info.symbols.every((symbol) => symbol.address.length === 8)).toBe(true);
  });

  it('reads a module symbol just the same', () => {
    expect(info.symbols.at(-1)).toEqual({
      address: 'c9000400',
      type: 'T',
      name: 'rtl8139_interrupt',
      module: '8139too',
    });
  });

  // Only an address of nothing but zeroes is hidden, whatever its width.
  it('does not mistake a low address for a hidden one', () => {
    expect(addressesHidden(info)).toBe(false);
    expect(isZeroAddress({ address: '00000000', type: 'T', name: 'x', module: null })).toBe(true);
    expect(isZeroAddress({ address: 'c1000000', type: 'T', name: 'x', module: null })).toBe(false);
  });
});

describe('parseKallsyms — the odd type letters', () => {
  const info = parseKallsyms(fixture('mixed-types'));

  it('reads the weak, absolute and debugging letters', () => {
    const types = new Map(info.symbols.map((symbol) => [symbol.name, symbol.type]));

    expect(types.get('__weak_default_handler')).toBe('W');
    expect(types.get('__gnu_lto_v1')).toBe('V');
    expect(types.get('__debug_note_start')).toBe('N');
    expect(types.get('fixed_percpu_data')).toBe('a');
  });

  /**
   * A letter with no case says nothing about scope, and nothing is invented
   * for one no tool names.
   */
  it('claims nothing for a type letter it cannot read', () => {
    const unknown = info.symbols.find((symbol) => symbol.name === '__unnamed_type')!;

    expect(unknown.type).toBe('?');
    expect(typeName('?')).toBeNull();
    expect(isUpperCase('?')).toBeNull();
    expect(scopeOf(unknown)).toBeNull();
  });

  it('still counts a letter it cannot name', () => {
    expect(countTypes(info).find((entry) => entry.type === '?')).toEqual({ type: '?', count: 1 });
  });
});

describe('parseKallsyms — every fixture', () => {
  const names = ['kernel-text', 'with-modules', 'restricted', 'i386-32bit', 'mixed-types'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseKallsyms(fixture(name));
    const summary = summarize(info);

    expect(summary.total).toBeGreaterThan(0);

    for (const symbol of info.symbols) {
      expect(symbol.name).not.toBe('');
      expect(symbol.type).toHaveLength(1);
      expect(symbol.address).toMatch(/^[0-9a-f]+$/);
      // The file prints one width throughout, 8 or 16 digits.
      expect(symbol.address).toHaveLength(info.symbols[0]!.address.length);
      expect(symbol.module).not.toBe('');
    }

    // Built-in and module symbols account for all of them.
    expect(summary.builtIn + summary.fromModules).toBe(summary.total);
    expect(summary.exported).toBeLessThanOrEqual(summary.fromModules);
    // Every symbol is counted once under its type letter.
    expect(summary.types.reduce((total, entry) => total + entry.count, 0)).toBe(summary.total);
    // Only a module symbol can be exported.
    for (const symbol of info.symbols) {
      if (scopeOf(symbol) === 'exported' || scopeOf(symbol) === 'internal') {
        expect(symbol.module).not.toBeNull();
      }
    }
  });
});

describe('parseKallsyms — awkward input', () => {
  it('returns nothing for an empty file', () => {
    expect(parseKallsyms('').symbols).toEqual([]);
    expect(addressesHidden(parseKallsyms(''))).toBe(false);
  });

  it('returns nothing for a file that is not /proc/kallsyms', () => {
    expect(parseKallsyms('processor\t: 0\n').symbols).toEqual([]);
  });

  it('reads a symbol name with dots and digits in it', () => {
    expect(parseKallsyms('ffffffff81002000 t do_syscall_64.cold.3\n').symbols[0]?.name).toBe(
      'do_syscall_64.cold.3',
    );
  });

  it('lower-cases an address written in capitals', () => {
    expect(parseKallsyms('FFFFFFFF81000000 T startup_64\n').symbols[0]?.address).toBe(
      'ffffffff81000000',
    );
  });

  it('reads the module however the line is spaced', () => {
    expect(parseKallsyms('ffffffffc0000000 t nvme_probe   [nvme]\n').symbols[0]?.module).toBe(
      'nvme',
    );
  });

  it('skips a line with no name', () => {
    expect(parseKallsyms('ffffffff81000000 T\n').symbols).toEqual([]);
  });

  it('skips a line whose type is more than a letter', () => {
    expect(parseKallsyms('ffffffff81000000 TT startup_64\n').symbols).toEqual([]);
  });

  // One symbol at zero is ordinary; every symbol at zero is kptr_restrict.
  it('does not read a single zero address as hidden', () => {
    const info = parseKallsyms('0000000000000000 A __per_cpu_start\nffffffff81000000 T start\n');

    expect(addressesHidden(info)).toBe(false);
  });
});
