import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPidSchedStatFixture as fixture } from '../test/fixtures';
import {
  averageSliceNs,
  averageWaitNs,
  CONTENDED,
  DISABLED,
  FIELDS,
  formatCount,
  formatNs,
  formatShare,
  isAllZero,
  isChatty,
  isContended,
  isEmpty,
  isUnreadable,
  parsePidSchedStat,
  SHORT_SLICE_NS,
  summarize,
  waitShare,
  wantedNs,
} from './pid-schedstat';
import { parseSchedStat, summarize as summarizeMachine } from './schedstat';

describe('parsePidSchedStat — a CPU-bound task', () => {
  const stat = parsePidSchedStat(fixture('busy'));

  it('reads the three counters by position', () => {
    expect(stat).toMatchObject({
      runtimeNs: 284_119_402_118,
      waitNs: 412_118_004,
      slices: 84_211,
      complete: true,
      terminated: true,
    });
    expect(stat.extra).toEqual([]);
  });

  it('reads the times as the nanoseconds they are', () => {
    expect(formatNs(stat.runtimeNs)).toBe('4m 44s');
    expect(formatNs(stat.waitNs)).toBe('412 ms');
    expect(wantedNs(stat)).toBe(284_119_402_118 + 412_118_004);
  });

  /** Barely queued at all: the machine had a CPU whenever it wanted one. */
  it('works out how little of its wanted time went to the queue', () => {
    expect(waitShare(stat)!).toBeLessThan(0.01);
    expect(isContended(stat)).toBe(false);
    expect(isChatty(stat)).toBe(false);
  });

  it('turns the counters into an average turn and an average wait', () => {
    expect(averageSliceNs(stat)).toBeCloseTo(284_119_402_118 / 84_211, 3);
    expect(formatNs(averageSliceNs(stat)!)).toBe('3.4 ms');
    expect(formatNs(averageWaitNs(stat)!)).toBe('4.9 µs');
  });
});

/** The number the second column exists for, and the one nobody reads. */
describe('parsePidSchedStat — starved on an oversubscribed box', () => {
  const stat = parsePidSchedStat(fixture('contended', '4242'));

  it('reads more time queued than running', () => {
    expect(stat.waitNs).toBeGreaterThan(stat.runtimeNs);
    expect(waitShare(stat)).toBeCloseTo(4_118_002_884 / (4_118_002_884 + 1_284_004_118), 6);
    expect(formatShare(waitShare(stat)!)).toBe('76%');
  });

  it('is past the share where the queue is the answer rather than noise', () => {
    expect(isContended(stat)).toBe(true);
    expect(waitShare(stat)!).toBeGreaterThan(CONTENDED);
    expect(summarize(stat).contended).toBe(true);
  });
});

describe('parsePidSchedStat — waking constantly and doing nothing', () => {
  const stat = parsePidSchedStat(fixture('chatty', '901'));

  it('reads turns too short for the work to be worth the scheduling', () => {
    expect(averageSliceNs(stat)!).toBeLessThan(SHORT_SLICE_NS);
    expect(isChatty(stat)).toBe(true);
    // Small runtime because there is little work, not because it is starved.
    expect(isContended(stat)).toBe(false);
  });
});

/**
 * The kernel prints `0 0 0` verbatim when it is not collecting, so the line
 * means two things and this file cannot separate them.
 */
describe('parsePidSchedStat — three zeroes', () => {
  const stat = parsePidSchedStat(fixture('not-collecting'));

  it('reads them as an answer rather than an empty file', () => {
    expect(isAllZero(stat)).toBe(true);
    expect(isEmpty(stat)).toBe(false);
    expect(stat.readable).toBe(true);
    expect(stat.value).toBe(DISABLED);
  });

  it('has no share and no averages to give rather than zeroes', () => {
    expect(waitShare(stat)).toBeNull();
    expect(averageSliceNs(stat)).toBeNull();
    expect(averageWaitNs(stat)).toBeNull();
    expect(isContended(stat)).toBe(false);
    expect(isChatty(stat)).toBe(false);
  });
});

describe('FIELDS', () => {
  it('is the three the kernel prints, in the order it prints them', () => {
    expect(FIELDS.map((field) => field.name)).toEqual([
      'sum_exec_runtime',
      'run_delay',
      'pcount',
    ]);
    expect(FIELDS.map((field) => field.column)).toEqual([1, 2, 3]);
  });

  /** Two are nanoseconds and the third is not — which is easy to misread. */
  it('marks the one that is a count rather than a time', () => {
    expect(FIELDS.filter((field) => field.unit === 'ns').map((f) => f.column)).toEqual([1, 2]);
    expect(FIELDS[2]!.unit).toBe('count');
    // And it is turns on a CPU, not context switches.
    expect(FIELDS[2]!.what).toContain('timeslices, not context switches');
  });
});

describe('parsePidSchedStat — what is not this file', () => {
  it('reads an empty file as empty rather than as three zeroes', () => {
    const stat = parsePidSchedStat('');

    expect(isEmpty(stat)).toBe(true);
    expect(isAllZero(stat)).toBe(false);
    expect(stat.bytes).toBe(0);
  });

  it('refuses a line that is not unsigned numbers', () => {
    const stat = parsePidSchedStat('not a schedstat line\n');

    expect(isUnreadable(stat)).toBe(true);
    expect(stat.complete).toBe(false);
  });

  it('names a line short of the three, and counts the rest as zero', () => {
    const stat = parsePidSchedStat('100 50\n');

    expect(stat.complete).toBe(false);
    expect(stat.slices).toBe(0);
    expect(stat.runtimeNs).toBe(100);
  });

  it('keeps numbers past the third out of the counters', () => {
    const stat = parsePidSchedStat('100 50 7 99\n');

    expect(stat.extra).toEqual([99]);
    expect(stat.slices).toBe(7);
  });

  it('notices a file with no trailing newline', () => {
    expect(parsePidSchedStat('100 50 7').terminated).toBe(false);
  });
});

describe('formatNs', () => {
  it('picks the unit that says something', () => {
    expect(formatNs(0)).toBe('0');
    expect(formatNs(640)).toBe('640 ns');
    expect(formatNs(4_900)).toBe('4.9 µs');
    expect(formatNs(1_300_000)).toBe('1.3 ms');
    expect(formatNs(4_280_000_000)).toBe('4.28 s');
    expect(formatNs(284_119_402_118)).toBe('4m 44s');
    expect(formatNs(4_118_002_884_004)).toBe('1h 8m');
  });

  it('counts and shares in the units those are in', () => {
    expect(formatCount(4_281_002)).toBe('4,281,002');
    expect(formatShare(0.7622)).toBe('76%');
    expect(formatShare(0.0005)).toBe('<1%');
  });
});

/**
 * A task's counters are a share of its machine's. The per-CPU totals in that
 * machine's own `/proc/schedstat` are the ceiling for any one task, so the
 * captures are held against them — and against each other, since all three
 * processes ran on the same machine.
 */
describe('the machine captures, against their own /proc/schedstat', () => {
  const root = resolve(process.cwd(), 'server/machines');
  const machines = ['container', 'desktop', 'raspberry-pi', 'server', 'vm'];
  const pids = ['1', '12282', 'self'];
  const all = machines.flatMap((machine) => pids.map((pid) => ({ machine, pid })));

  const taskStat = (machine: string, pid: string) =>
    parsePidSchedStat(readFileSync(resolve(root, machine, 'proc', pid, 'schedstat'), 'utf8'));

  const machineTotals = (machine: string) =>
    summarizeMachine(parseSchedStat(readFileSync(resolve(root, machine, 'proc', 'schedstat'), 'utf8')));

  it.each(all)('$machine/$pid is a line the kernel could have printed', ({ machine, pid }) => {
    const stat = taskStat(machine, pid);

    expect(stat.readable).toBe(true);
    expect(stat.complete).toBe(true);
    expect(stat.terminated).toBe(true);
    expect(stat.extra).toEqual([]);
  });

  it.each(all)('$machine/$pid has run no longer than its machine has', ({ machine, pid }) => {
    const stat = taskStat(machine, pid);
    const totals = machineTotals(machine);

    expect(stat.runtimeNs).toBeLessThanOrEqual(totals.runTimeNs);
    expect(stat.waitNs).toBeLessThanOrEqual(totals.waitTimeNs);
    expect(stat.slices).toBeLessThanOrEqual(totals.timeslices);
  });

  it.each(machines)('%s: its three tasks together still fit inside it', (machine) => {
    const totals = machineTotals(machine);
    const tasks = pids.map((pid) => taskStat(machine, pid));
    const sum = (pick: (s: ReturnType<typeof taskStat>) => number) =>
      tasks.reduce((total, task) => total + pick(task), 0);

    expect(sum((task) => task.runtimeNs)).toBeLessThanOrEqual(totals.runTimeNs);
    expect(sum((task) => task.waitNs)).toBeLessThanOrEqual(totals.waitTimeNs);
    expect(sum((task) => task.slices)).toBeLessThanOrEqual(totals.timeslices);
  });

  /** A turn of a few nanoseconds, or of a whole second, is not a real capture. */
  it.each(all)('$machine/$pid has turns of a plausible length', ({ machine, pid }) => {
    const slice = averageSliceNs(taskStat(machine, pid))!;

    expect(slice).toBeGreaterThan(1_000);
    expect(slice).toBeLessThan(50_000_000);
  });

  /**
   * Every machine's own `/proc/schedstat` carries real counters, so schedstats
   * are switched on — and no task on such a machine can be printing the `0 0 0`
   * that means the kernel is not collecting.
   */
  it.each(all)('$machine/$pid is not the not-collecting line', ({ machine, pid }) => {
    expect(machineTotals(machine).runTimeNs).toBeGreaterThan(0);
    expect(isAllZero(taskStat(machine, pid))).toBe(false);
  });
});
