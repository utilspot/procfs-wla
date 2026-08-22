import { describe, expect, it } from 'vitest';
import { readGpuLoadFixture as fixture } from '../test/fixtures';
import {
  byActive,
  contextActive,
  exceedsDevice,
  formatDuration,
  formatShare,
  hasNoIdle,
  isKernelContext,
  isThread,
  nsToSeconds,
  parseGpuLoad,
  span,
  summarize,
  utilization,
} from './gpu_load';

describe('parseGpuLoad — the capture the machine serves', () => {
  const load = parseGpuLoad(fixture('raspberry-pi'));
  const contextFor = (id: number) => load.contexts.find((context) => context.id === id)!;

  it('reads the device line as the device rather than as a context', () => {
    expect(load.device).toEqual({
      name: 'mali0',
      active: 395061345792,
      inactive: 535991866112,
    });
    expect(load.contexts).toHaveLength(5);
  });

  it('skips the line naming the columns', () => {
    expect(load.contexts.some((context) => Number.isNaN(context.id))).toBe(false);
    expect(load.contexts.map((context) => context.id)).toEqual([0, 12, 3, 2, 1]);
  });

  it('reads a context as its ids and its two durations', () => {
    expect(contextFor(2)).toEqual({
      id: 2,
      tgid: 11620,
      pid: 11620,
      active: 5845115345720,
      inactive: 6467620158574,
    });
  });

  /** Active over active plus inactive, which is the span the counter has run. */
  it('works out what share of its span each thing has been active', () => {
    expect(utilization(load.device!)).toBeCloseTo(395061345792 / 931053211904);
    expect(utilization(contextFor(2))!).toBeCloseTo(0.4747, 3);
    expect(utilization(contextFor(3))!).toBeCloseTo(0.0218, 3);
    expect(span(contextFor(1))).toBe(203889532 + 6582537094);
  });

  /**
   * `tgid` is the process and `pid` the thread in it that opened the device, so
   * the two differing is a context belonging to a thread rather than a second
   * process.
   */
  it('tells a context opened by a thread from one opened by the process', () => {
    expect(isThread(contextFor(3))).toBe(true);
    expect(isThread(contextFor(1))).toBe(true);
    expect(isThread(contextFor(2))).toBe(false);
    expect(isThread(contextFor(12))).toBe(false);
  });

  /** Id, tgid and pid all zero: the driver's own, since there is no process 0. */
  it('tells the driver’s own context from a process’s', () => {
    expect(isKernelContext(contextFor(0))).toBe(true);
    expect(load.contexts.filter(isKernelContext)).toHaveLength(1);
  });

  /**
   * Nothing has been counted against it, so its 100% is not a share of
   * anything — which is the one row on which the number has to be read twice.
   */
  it('marks the row with no inactive time at all', () => {
    expect(hasNoIdle(contextFor(0))).toBe(true);
    expect(utilization(contextFor(0))).toBe(1);
    expect(load.contexts.filter(hasNoIdle).map((context) => context.id)).toEqual([0]);
  });

  /** Hours against the device's fifteen minutes: neither is the other's total. */
  it('does not take the device line for the total of the rows', () => {
    expect(contextActive(load)).toBeGreaterThan(load.device!.active);
    expect(exceedsDevice(load)).toBe(true);
  });

  it('ranks the contexts by how long each has been active', () => {
    expect(byActive(load).map((context) => context.id)).toEqual([2, 12, 1, 3, 0]);
  });

  it('summarizes the contexts and the processes behind them', () => {
    expect(summarize(load)).toMatchObject({ contexts: 5, processes: 4, threads: 2 });
    // The driver's own context belongs to no process, so it leads nothing.
    expect(summarize(load).busiest?.id).toBe(2);
    expect(summarize(load).active).toBe(contextActive(load));
  });
});

describe('parseGpuLoad — one process holding two contexts', () => {
  const load = parseGpuLoad(fixture('many-contexts'));

  it('counts a process once however many contexts it holds', () => {
    expect(summarize(load)).toMatchObject({ contexts: 6, processes: 3, threads: 2 });
  });

  it('keeps the device line under the rows rather than over them', () => {
    expect(exceedsDevice(load)).toBe(false);
    expect(utilization(load.device!)).toBeCloseTo(2204551234567 / 10659663580245);
  });
});

describe('parseGpuLoad — a driver with nothing on it', () => {
  it('reads a header with no context under it', () => {
    const load = parseGpuLoad(fixture('no-contexts'));

    expect(load.device).toMatchObject({ name: 'mali0', active: 0, inactive: 0 });
    expect(load.contexts).toEqual([]);
    expect(summarize(load)).toMatchObject({ contexts: 0, processes: 0, busiest: null });
  });

  /** A counter that has never run is a share of nothing rather than a zero. */
  it('has no share to give for a counter that has never run', () => {
    const load = parseGpuLoad(fixture('no-contexts'));

    expect(utilization(load.device!)).toBeNull();
    expect(hasNoIdle(load.device!)).toBe(false);
    expect(exceedsDevice(load)).toBe(false);
  });

  it('reads a GPU that has done almost nothing', () => {
    const load = parseGpuLoad(fixture('idle'));

    expect(utilization(load.device!)!).toBeLessThan(0.001);
    expect(summarize(load)).toMatchObject({ contexts: 1, processes: 0, busiest: null });
  });
});

describe('parseGpuLoad — what is not a file of this kind', () => {
  it('reads nothing out of an empty file', () => {
    expect(parseGpuLoad('')).toEqual({ device: null, contexts: [] });
  });

  it('ignores a line that is neither the device, the header nor a context', () => {
    const load = parseGpuLoad('mali0: 10 20\nsomething else\n1 2 2 30 40\n');

    expect(load.device?.name).toBe('mali0');
    expect(load.contexts).toHaveLength(1);
  });

  it('drops a row that is not five numbers', () => {
    const load = parseGpuLoad('mali0: 10 20\n1 2 2 30\n3 4 4 50 60\n');

    expect(load.contexts.map((context) => context.id)).toEqual([3]);
  });

  /** This file is one driver's, so a second device line is not a second device. */
  it('keeps the first device line', () => {
    const load = parseGpuLoad('mali0: 10 20\nmali1: 30 40\n');

    expect(load.device).toMatchObject({ name: 'mali0', active: 10 });
  });
});

describe('formatting', () => {
  it('reads the columns as the nanoseconds they are named in', () => {
    expect(nsToSeconds(1e9)).toBe(1);
    expect(nsToSeconds(395061345792)).toBeCloseTo(395.06, 2);
  });

  it('shows a duration at the units that say something', () => {
    expect(formatDuration(nsToSeconds(21527740))).toBe('22 ms');
    expect(formatDuration(nsToSeconds(6239059548))).toBe('6.24 s');
    expect(formatDuration(nsToSeconds(395061345792))).toBe('6m 35s');
    expect(formatDuration(nsToSeconds(5845115345720))).toBe('1h 37m');
  });

  it('shows a share that is not quite nothing as more than nothing', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.004)).toBe('<1%');
    expect(formatShare(0.475)).toBe('48%');
    expect(formatShare(1)).toBe('100%');
  });
});
