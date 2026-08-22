import { describe, expect, it } from 'vitest';
import { readDefaultSmpAffinityFixture as fixture } from '../test/fixtures';
import {
  couldBeAll,
  cpuList,
  groupsOf,
  isDefault,
  isEmpty,
  isUnreadable,
  parseDefaultAffinity,
  slotRange,
} from './irq-default_smp_affinity';

describe('parseDefaultAffinity — an ordinary four-CPU machine', () => {
  const affinity = parseDefaultAffinity(fixture('desktop'));

  it('reads the mask as the CPUs it names', () => {
    expect(affinity.value).toBe('f');
    expect(affinity.cpus).toEqual([0, 1, 2, 3]);
    expect(cpuList(affinity.cpus)).toBe('0-3');
  });

  it('reads four slots out of one hex digit', () => {
    expect(affinity.digits).toBe(1);
    expect(affinity.slots).toBe(4);
  });

  /** Every bit set is the mask `init_irq_default_affinity` leaves at boot. */
  it('knows nothing has narrowed it', () => {
    expect(isDefault(affinity)).toBe(true);
    expect(affinity.none).toBe(false);
  });

  it('reads the newline the kernel writes after the mask', () => {
    expect(affinity.terminated).toBe(true);
    expect(affinity.bytes).toBe(2);
  });
});

describe('parseDefaultAffinity — a narrowed default', () => {
  const affinity = parseDefaultAffinity(fixture('isolated'));

  /** Eight slots wide, and only the two housekeeping CPUs in it. */
  it('reads the two CPUs `irqaffinity=0-1` left set', () => {
    expect(affinity.cpus).toEqual([0, 1]);
    expect(cpuList(affinity.cpus)).toBe('0-1');
    expect(affinity.slots).toBe(8);
  });

  it('is neither the kernel default nor empty', () => {
    expect(isDefault(affinity)).toBe(false);
    expect(affinity.none).toBe(false);
  });
});

describe('parseDefaultAffinity — the groups', () => {
  const affinity = parseDefaultAffinity(fixture('numa-96'));

  /**
   * The most significant group is written first, so the *last* one holds CPU 0
   * — which is the one thing about this format that reads backwards.
   */
  it('numbers the groups from the right', () => {
    expect(groupsOf(affinity)).toEqual([
      { digits: 'ffffffff', first: 64, last: 95, set: true },
      { digits: 'ffffffff', first: 32, last: 63, set: true },
      { digits: 'ffffffff', first: 0, last: 31, set: true },
    ]);
  });

  it('reads all ninety-six CPUs across the three of them', () => {
    expect(affinity.cpus).toHaveLength(96);
    expect(cpuList(affinity.cpus)).toBe('0-95');
    expect(affinity.slots).toBe(96);
  });

  it('reads the groups as the 32-bit chunks the kernel writes', () => {
    expect(affinity.chunked).toBe(true);
    expect(affinity.groups).toEqual(['ffffffff', 'ffffffff', 'ffffffff']);
  });
});

describe('parseDefaultAffinity — a top group narrower than a chunk', () => {
  const affinity = parseDefaultAffinity(fixture('ragged-33'));

  /**
   * `nr_cpu_ids` is 33 here, so the leading chunk is one bit wide and prints as
   * a single digit. The bit it holds is still CPU 32: the groups below it are
   * full 32-bit chunks whatever the leading one's width.
   */
  it('puts the leading digit above the full chunk under it', () => {
    expect(groupsOf(affinity)).toEqual([
      { digits: '1', first: 32, last: 35, set: true },
      { digits: 'ffffffff', first: 0, last: 31, set: true },
    ]);
    expect(affinity.cpus).toHaveLength(33);
    expect(affinity.cpus.at(-1)).toBe(32);
  });

  /** Every CPU there is, and the mask is still not all `f`. */
  it('does not claim the easy case for a padded top digit', () => {
    expect(isDefault(affinity)).toBe(false);
    expect(affinity.chunked).toBe(true);
  });

  it('reads it as padding rather than as a narrowed default', () => {
    expect(couldBeAll(affinity)).toBe(true);
  });

  it('says how many slots the kernel has, to the digit', () => {
    expect(affinity.slots).toBe(36);
    expect(slotRange(affinity)).toEqual({ min: 33, max: 36 });
  });
});

describe('parseDefaultAffinity — a mask naming nothing', () => {
  const affinity = parseDefaultAffinity(fixture('no-cpus'));

  it('reads no CPU without reading the file as empty', () => {
    expect(affinity.cpus).toEqual([]);
    expect(affinity.none).toBe(true);
    expect(isEmpty(affinity)).toBe(false);
    expect(isUnreadable(affinity)).toBe(false);
  });

  it('still knows how wide the mask is', () => {
    expect(affinity.slots).toBe(4);
    expect(groupsOf(affinity)).toEqual([{ digits: '0', first: 0, last: 3, set: false }]);
  });
});

describe('parseDefaultAffinity — masks the fixtures do not hold', () => {
  it('reads a single CPU out of a wide mask', () => {
    const affinity = parseDefaultAffinity('00000100\n');

    expect(affinity.cpus).toEqual([8]);
    expect(cpuList(affinity.cpus)).toBe('8');
    expect(affinity.slots).toBe(32);
  });

  it('reads a mask in upper case', () => {
    expect(parseDefaultAffinity('FF\n').cpus).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(isDefault(parseDefaultAffinity('FF\n'))).toBe(true);
  });

  it('reads CPUs above the first chunk', () => {
    const affinity = parseDefaultAffinity('00000001,00000000\n');

    expect(affinity.cpus).toEqual([32]);
    expect(cpuList(affinity.cpus)).toBe('32');
  });

  it('flags groups that are not the chunks the kernel writes', () => {
    const affinity = parseDefaultAffinity('ff,ff\n');

    expect(affinity.chunked).toBe(false);
    // Read from the digits as they stand rather than assumed to be 32 apart.
    expect(affinity.cpus).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('notices a file the kernel would have ended with a newline', () => {
    expect(parseDefaultAffinity('f').terminated).toBe(false);
    expect(parseDefaultAffinity('f\n').terminated).toBe(true);
  });

  it('refuses anything that is not a mask', () => {
    for (const text of ['0-3\n', 'ffff ffff\n', 'g\n', 'default\n']) {
      const affinity = parseDefaultAffinity(text);
      expect(isUnreadable(affinity)).toBe(true);
      expect(affinity.cpus).toEqual([]);
    }
  });

  it('tells an empty file from an unreadable one', () => {
    const empty = parseDefaultAffinity('\n');

    expect(isEmpty(empty)).toBe(true);
    expect(isUnreadable(empty)).toBe(false);
  });
});

describe('cpuList', () => {
  it('runs consecutive CPUs together and leaves gaps alone', () => {
    expect(cpuList([0, 1, 2, 3])).toBe('0-3');
    expect(cpuList([0, 1, 8])).toBe('0-1,8');
    expect(cpuList([2])).toBe('2');
    expect(cpuList([0, 2, 4])).toBe('0,2,4');
    expect(cpuList([])).toBe('');
  });
});

describe('couldBeAll', () => {
  /** Padding lives in the top hex digit and nowhere else. */
  it('holds for a mask unbroken from zero that stops inside the top digit', () => {
    expect(couldBeAll(parseDefaultAffinity('7\n'))).toBe(true);
    expect(couldBeAll(parseDefaultAffinity('1,ffffffff\n'))).toBe(true);
  });

  it('does not hold for a mask with slots to spare below the top digit', () => {
    expect(couldBeAll(parseDefaultAffinity('03\n'))).toBe(false);
    expect(couldBeAll(parseDefaultAffinity('0000000f\n'))).toBe(false);
  });

  it('does not hold for a mask with a gap in it', () => {
    expect(couldBeAll(parseDefaultAffinity('d\n'))).toBe(false);
  });

  /** The two the caller has already told apart, so neither is this one's case. */
  it('does not hold for a full mask or an empty one', () => {
    expect(couldBeAll(parseDefaultAffinity('f\n'))).toBe(false);
    expect(couldBeAll(parseDefaultAffinity('0\n'))).toBe(false);
  });
});

describe('slotRange', () => {
  /**
   * The width is `nr_cpu_ids` rounded up to a whole hex digit, so a mask says
   * how many slots the kernel has to within three of them — and says nothing
   * at all about how many of those CPUs are online.
   */
  it('bounds nr_cpu_ids by the digits the kernel printed', () => {
    expect(slotRange(parseDefaultAffinity('f\n'))).toEqual({ min: 1, max: 4 });
    expect(slotRange(parseDefaultAffinity('ff\n'))).toEqual({ min: 5, max: 8 });
    expect(slotRange(parseDefaultAffinity('ffffffff\n'))).toEqual({ min: 29, max: 32 });
  });
});
