import { describe, expect, it } from 'vitest';
import { readSoftIrqsFixture as fixture } from '../test/fixtures';
import {
  busiestCpu,
  concentration,
  describeVector,
  formatCount,
  formatShare,
  isIdle,
  NOTABLE_SHARE,
  parseSoftirqs,
  PINNED_SHARE,
  share,
  summarize,
  total,
  VECTORS,
} from './softirqs';

describe('parseSoftirqs — an ordinary desktop', () => {
  const softirqs = parseSoftirqs(fixture('desktop'));

  it('reads the CPU columns from the header rather than counting them', () => {
    expect(softirqs.cpus).toEqual([
      'CPU0',
      'CPU1',
      'CPU2',
      'CPU3',
      'CPU4',
      'CPU5',
      'CPU6',
      'CPU7',
    ]);
  });

  it('reads a count per CPU for every vector', () => {
    expect(softirqs.vectors).toHaveLength(10);
    expect(softirqs.vectors.every((vector) => vector.counts.length === 8)).toBe(true);
    expect(softirqs.vectors[0]).toEqual({ name: 'HI', counts: [12, 3, 0, 5, 1, 0, 2, 0] });
  });

  /** The rows are the kernel's enum, printed in its order, not sorted. */
  it('keeps the kernel’s order', () => {
    expect(softirqs.vectors.map((vector) => vector.name)).toEqual([
      'HI',
      'TIMER',
      'NET_TX',
      'NET_RX',
      'BLOCK',
      'IRQ_POLL',
      'TASKLET',
      'SCHED',
      'HRTIMER',
      'RCU',
    ]);
  });

  it('adds a vector up across the CPUs', () => {
    const timer = softirqs.vectors.find((vector) => vector.name === 'TIMER')!;

    expect(total(timer)).toBe(23604219);
  });

  /**
   * A zero row is the vector never having run, not the machine lacking it: the
   * list is fixed, so the row is printed either way.
   */
  it('reads a row of zeroes as never run rather than as missing', () => {
    const hrtimer = softirqs.vectors.find((vector) => vector.name === 'HRTIMER')!;

    expect(hrtimer.counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isIdle(hrtimer)).toBe(true);
    expect(busiestCpu(hrtimer)).toBe(-1);
  });

  it('summarizes the machine and its per-CPU totals', () => {
    const summary = summarize(softirqs);

    expect(summary).toMatchObject({ cpus: 8, vectors: 10, raised: 8, total: 84315698 });
    expect(summary.perCpu).toEqual([
      11298377, 10668378, 10628199, 10376993, 10495481, 10272774, 10352388, 10223108,
    ]);
    expect(summary.busiest.map((vector) => vector.name).slice(0, 3)).toEqual([
      'SCHED',
      'TIMER',
      'RCU',
    ]);
  });

  /**
   * Tasklets land back on whichever CPU raised them, so a vector that ran a
   * few dozen times is pinned in a way that says nothing about the machine.
   */
  it('says nothing about a pinned vector doing no real work', () => {
    const tasklet = softirqs.vectors.find((vector) => vector.name === 'TASKLET')!;

    expect(concentration(tasklet)).toBeGreaterThan(PINNED_SHARE);
    expect(share(tasklet, 84315698)).toBeLessThan(NOTABLE_SHARE);
    expect(summarize(softirqs).pinned).toEqual([]);
  });
});

describe('parseSoftirqs — a NIC with one receive queue', () => {
  const softirqs = parseSoftirqs(fixture('single-queue-nic'));

  /**
   * A softirq runs on the CPU that raised it, so NET_RX on one CPU is where
   * the packets arrive — and the other three cannot help however idle.
   */
  it('flags a vector doing real work that one CPU ran nearly all of', () => {
    const summary = summarize(softirqs);

    expect(summary.pinned.map((vector) => vector.name)).toEqual(['NET_RX']);
    expect(busiestCpu(summary.pinned[0]!)).toBe(0);
    expect(concentration(summary.pinned[0]!)).toBeCloseTo(0.993, 3);
  });

  it('leaves the vectors that are merely small alone', () => {
    const netTx = softirqs.vectors.find((vector) => vector.name === 'NET_TX')!;

    // Just as concentrated, and 2% of the machine's softirq work.
    expect(concentration(netTx)).toBeGreaterThan(PINNED_SHARE);
    expect(summarize(softirqs).pinned.map((vector) => vector.name)).not.toContain('NET_TX');
  });
});

describe('parseSoftirqs — a kernel from before the rename', () => {
  const softirqs = parseSoftirqs(fixture('legacy-2.6'));

  /** `BLOCK_IOPOLL` became `IRQ_POLL` in 4.5: same vector, same position. */
  it('reads BLOCK_IOPOLL where IRQ_POLL now is', () => {
    expect(softirqs.vectors[5]?.name).toBe('BLOCK_IOPOLL');
    expect(describeVector('BLOCK_IOPOLL')).toMatch(/before 4\.5/);
  });

  /** The name is 12 characters, so `%12s:` prints it with no leading space. */
  it('reads a name that fills the label field', () => {
    expect(softirqs.vectors.map((vector) => vector.name)).toContain('BLOCK_IOPOLL');
    expect(softirqs.vectors[5]?.counts).toEqual([0, 0]);
  });

  it('reads HRTIMER still being raised on a kernel that used it', () => {
    const hrtimer = softirqs.vectors.find((vector) => vector.name === 'HRTIMER')!;

    expect(isIdle(hrtimer)).toBe(false);
    expect(total(hrtimer)).toBe(159662);
  });

  /**
   * On two CPUs the busier one holds at least half of everything by
   * definition, which is not the same as a vector being pinned to it.
   */
  it('does not call an even split across two CPUs pinned', () => {
    expect(summarize(softirqs).pinned).toEqual([]);
  });
});

describe('parseSoftirqs — the awkward files', () => {
  it('reads an empty file as no vectors at all', () => {
    expect(parseSoftirqs('')).toEqual({ cpus: [], vectors: [] });
  });

  it('survives a file with a header and nothing under it', () => {
    const softirqs = parseSoftirqs('                    CPU0       CPU1       \n');

    expect(softirqs.cpus).toEqual(['CPU0', 'CPU1']);
    expect(softirqs.vectors).toEqual([]);
  });

  it('ignores a line that carries no counts', () => {
    const softirqs = parseSoftirqs(
      ['                    CPU0', '       TIMER:      15588', '        JUNK: nonsense'].join('\n'),
    );

    expect(softirqs.vectors.map((vector) => vector.name)).toEqual(['TIMER']);
  });

  /**
   * Stopping at the first non-count rather than skipping it: skipping would
   * shift the rest of the row into the wrong CPUs.
   */
  it('stops a row at the first token that is not a count', () => {
    const softirqs = parseSoftirqs(
      ['                    CPU0       CPU1       CPU2', '       TIMER:  1  ? 3'].join('\n'),
    );

    expect(softirqs.vectors[0]?.counts).toEqual([1]);
  });

  it('reads CRLF line endings', () => {
    const softirqs = parseSoftirqs('                    CPU0\r\n          HI:          7\r\n');

    expect(softirqs.cpus).toEqual(['CPU0']);
    expect(softirqs.vectors[0]).toEqual({ name: 'HI', counts: [7] });
  });

  /** Offline CPUs are left out, so the columns are not always 0..n-1. */
  it('takes the CPU labels as printed rather than numbering them', () => {
    const softirqs = parseSoftirqs(
      ['                    CPU0       CPU2       CPU5', '       TIMER:  10  20  30'].join('\n'),
    );

    expect(softirqs.cpus).toEqual(['CPU0', 'CPU2', 'CPU5']);
    expect(summarize(softirqs).perCpu).toEqual([10, 20, 30]);
  });

  it('has nothing to spread across on a single-CPU machine', () => {
    const softirqs = parseSoftirqs(
      ['                    CPU0', '       TIMER:  1000'].join('\n'),
    );

    expect(concentration(softirqs.vectors[0]!)).toBe(1);
    expect(summarize(softirqs).pinned).toEqual([]);
  });

  it('divides by no total without producing a NaN share', () => {
    expect(share({ name: 'TIMER', counts: [0] }, 0)).toBe(0);
    expect(concentration({ name: 'TIMER', counts: [0, 0] })).toBe(0);
  });
});

describe('the vector notes', () => {
  it('describes every vector the fixtures print', () => {
    for (const name of ['desktop', 'legacy-2.6']) {
      for (const vector of parseSoftirqs(fixture(name)).vectors) {
        expect(describeVector(vector.name), `no note for ${vector.name}`).not.toBeNull();
      }
    }
  });

  it('has no note for a vector a later kernel might add', () => {
    expect(describeVector('SOMETHING_NEW')).toBeNull();
    expect(Object.keys(VECTORS)).toContain('IRQ_POLL');
  });
});

describe('formatting', () => {
  it('shortens the counts a machine reaches after a few days', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(15588)).toBe('15.6k');
    expect(formatCount(23604219)).toBe('23.6M');
    expect(formatCount(1.5e9)).toBe('1.5G');
  });

  it('keeps a vector that is not quite nothing apart from one that is', () => {
    expect(formatShare(0)).toBe('—');
    expect(formatShare(0.0001)).toBe('<1%');
    expect(formatShare(0.283)).toBe('28%');
    expect(formatShare(1)).toBe('100%');
  });
});
