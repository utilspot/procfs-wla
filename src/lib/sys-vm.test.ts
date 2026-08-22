import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatTunable,
  isDeferredToPair,
  isRescaled,
  isTrigger,
  meaningOf,
  parseTunable,
  TUNABLES,
  tunableFor,
  tunablesIn,
  UNIT_LABELS,
  VM_GROUPS,
  WRITE_CAPABILITY,
} from './sys-vm';

/** One file's contents, read as the page reads them. */
const read = (text: string) => parseTunable(text)!;
const of = (name: string) => tunableFor(name)!;

describe('the /proc/sys/vm tunables', () => {
  it('names each file once', () => {
    const names = TUNABLES.map((tunable) => tunable.name);

    expect(new Set(names).size).toBe(names.length);
  });

  /** A row that named a group the page does not show would never be drawn. */
  it('puts every one in a group the page has', () => {
    for (const tunable of TUNABLES) {
      expect(VM_GROUPS, tunable.name).toContain(tunable.group);
    }
  });

  it('gives every unit a word to show it as', () => {
    for (const tunable of TUNABLES) {
      expect(UNIT_LABELS[tunable.unit], tunable.name).toBeTruthy();
    }
  });

  /** Every group is worth a section, so none of them may be empty. */
  it('has something in every group', () => {
    for (const group of VM_GROUPS) {
      expect(tunablesIn(group).length, group).toBeGreaterThan(0);
    }
  });

  it('keeps a group’s own order', () => {
    // The two spellings of one threshold, the ratio first: a machine is
    // usually on the ratio, and the bytes spelling zeroes it.
    const writeback = tunablesIn('Writeback').map((tunable) => tunable.name);

    expect(writeback.indexOf('dirty_ratio')).toBeLessThan(writeback.indexOf('dirty_bytes'));
    expect(writeback.indexOf('dirty_background_ratio')).toBeLessThan(
      writeback.indexOf('dirty_background_bytes'),
    );
  });

  it('carries the knobs a reader comes to this directory for', () => {
    for (const name of [
      'swappiness',
      'overcommit_memory',
      'min_free_kbytes',
      'max_map_count',
      'drop_caches',
      'nr_hugepages',
      'panic_on_oom',
    ]) {
      expect(tunableFor(name), name).toBeDefined();
    }
  });

  it('has nothing for a name it carries no facts for', () => {
    // A knob an older kernel had and this one does not, and a file from the
    // directory next door.
    expect(tunableFor('nr_pdflush_threads')).toBeUndefined();
    expect(tunableFor('max_ipc_namespaces')).toBeUndefined();
    expect(tunableFor('')).toBeUndefined();
  });

  /**
   * The knobs a 6.x kernel grew, which a table written against an older one
   * would leave in the ordinary Files section.
   */
  it('carries the newer knobs too', () => {
    for (const name of [
      'defrag_mode',
      'enable_soft_offline',
      'memfd_noexec',
      'movable_gigantic_pages',
      'numa_zonelist_order',
      'page_lock_unfairness',
      'vfs_cache_pressure_denom',
    ]) {
      expect(tunableFor(name), name).toBeDefined();
    }
  });

  /** The denominator sits with the number it is the denominator of. */
  it('keeps a pair of files together', () => {
    const reclaim = tunablesIn('Reclaim and watermarks').map((tunable) => tunable.name);
    const pressure = reclaim.indexOf('vfs_cache_pressure');

    expect(reclaim[pressure + 1]).toBe('vfs_cache_pressure_denom');
  });

  /** Writing any of these is one capability, unlike `/proc/sys/user`'s. */
  it('names the capability a writer needs', () => {
    expect(WRITE_CAPABILITY).toBe('CAP_SYS_ADMIN');
  });

  /**
   * The lines are what the page says about a file, so they are prose about the
   * setting rather than a restatement of its name.
   */
  it('says what each one sets in a line of its own', () => {
    for (const tunable of TUNABLES) {
      expect(tunable.sets.length, tunable.name).toBeGreaterThan(30);
      expect(tunable.sets.startsWith(tunable.name), tunable.name).toBe(false);
    }
  });
});

describe('parseTunable', () => {
  it('reads the single figure nearly every one of these holds', () => {
    const value = read('60\n');

    expect(value.raw).toBe('60');
    expect(value.fields).toEqual(['60']);
    expect(value.numbers).toEqual([60]);
    expect(value.terminated).toBe(true);
  });

  it('reads the one that holds a field per zone', () => {
    const value = read('256\t256\t32\t0\t0\n');

    expect(value.fields).toHaveLength(5);
    expect(value.numbers).toEqual([256, 256, 32, 0, 0]);
  });

  it('reads the one that holds a word', () => {
    const value = read('Node\n');

    expect(value.raw).toBe('Node');
    expect(value.numbers).toBeNull();
  });

  it('notices a file the kernel did not terminate', () => {
    expect(read('60').terminated).toBe(false);
  });

  /** Under /proc/sys an empty read is a failed read rather than an empty setting. */
  it('has nothing for a file with nothing in it', () => {
    expect(parseTunable('')).toBeNull();
    expect(parseTunable('\n')).toBeNull();
    expect(parseTunable('   ')).toBeNull();
  });
});

describe('formatTunable', () => {
  it('reads a threshold in the unit it is counted in', () => {
    expect(formatTunable(of('dirty_ratio'), read('20'))).toBe('20%');
    expect(formatTunable(of('dirty_expire_centisecs'), read('3000'))).toBe('30 s');
    expect(formatTunable(of('dirtytime_expire_seconds'), read('43200'))).toBe('12 h');
    expect(formatTunable(of('min_free_kbytes'), read('67584'))).toBe('66 MiB');
    expect(formatTunable(of('dirty_bytes'), read('1073741824'))).toBe('1 GiB');
    expect(formatTunable(of('defrag_mode'), read('1'))).toBe('on');
    expect(formatTunable(of('max_map_count'), read('1048576'))).toBe('1,048,576');
  });

  /** 0 is 0 in any unit, and reading it as `0 B` would be noise. */
  it('leaves a zero alone', () => {
    expect(formatTunable(of('dirty_bytes'), read('0'))).toBe('0');
    expect(formatTunable(of('laptop_mode'), read('0'))).toBe('0');
  });

  /** A line of fields is shown as it came: it is not one quantity. */
  it('shows a many-field value as written', () => {
    expect(formatTunable(of('lowmem_reserve_ratio'), read('256 256 32'))).toBe('256 256 32');
    expect(formatTunable(of('numa_zonelist_order'), read('Node'))).toBe('Node');
  });

  it('says which readings restate the figure and which dress it', () => {
    expect(isRescaled(of('min_free_kbytes'))).toBe(true);
    expect(isRescaled(of('dirty_expire_centisecs'))).toBe(true);
    // A percentage read as `20%` is the same figure with a sign on it.
    expect(isRescaled(of('dirty_ratio'))).toBe(false);
    expect(isRescaled(of('swappiness'))).toBe(false);
  });
});

describe('what a value means', () => {
  it('says what each value of a mode is', () => {
    expect(meaningOf(of('overcommit_memory'), read('2'))).toMatch(/never overcommit/);
    expect(meaningOf(of('panic_on_oom'), read('0'))).toMatch(/picks a process/);
    expect(meaningOf(of('memfd_noexec'), read('1'))).toMatch(/MFD_NOEXEC_SEAL/);
    expect(meaningOf(of('numa_zonelist_order'), read('Node'))).toMatch(/only order/);
  });

  it('has nothing to say about a value on a scale', () => {
    expect(meaningOf(of('swappiness'), read('60'))).toBeUndefined();
    expect(meaningOf(of('overcommit_memory'), read('9'))).toBeUndefined();
  });

  /**
   * The trap: writing either spelling of a paired threshold zeroes the other,
   * so a 0 says the other one is in force rather than that the setting is off.
   */
  it('knows a zero that means the other spelling is in force', () => {
    expect(isDeferredToPair(of('dirty_ratio'), read('0'))).toBe(true);
    expect(isDeferredToPair(of('dirty_bytes'), read('0'))).toBe(true);
    expect(isDeferredToPair(of('overcommit_ratio'), read('0'))).toBe(true);

    expect(isDeferredToPair(of('dirty_ratio'), read('20'))).toBe(false);
    // A file with no other spelling has no such reading to give.
    expect(isDeferredToPair(of('swappiness'), read('0'))).toBe(false);
  });

  it('pairs each of the three both ways round', () => {
    for (const tunable of TUNABLES) {
      if (tunable.pairedWith === undefined) continue;
      expect(tunableFor(tunable.pairedWith)?.pairedWith, tunable.name).toBe(tunable.name);
    }
  });

  it('knows which files are written rather than read', () => {
    expect(isTrigger(of('drop_caches'))).toBe(true);
    expect(isTrigger(of('compact_memory'))).toBe(true);
    expect(isTrigger(of('swappiness'))).toBe(false);
  });
});

describe('the formatters', () => {
  it('reads bytes as the round binary figures they are', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KiB');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(1024 ** 3)).toBe('1 GiB');
  });

  it('reads a duration in the largest unit it is whole in', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(5)).toBe('5 s');
    expect(formatDuration(300)).toBe('5 min');
    expect(formatDuration(43200)).toBe('12 h');
    expect(formatDuration(172800)).toBe('2 d');
  });
});
