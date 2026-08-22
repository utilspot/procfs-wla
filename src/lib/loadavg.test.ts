import { describe, expect, it } from 'vitest';
import { readLoadAvgFixture as fixture } from '../test/fixtures';
import {
  excessOverRunnable,
  formatLoad,
  notRunnable,
  parseLoadAvg,
  runnableShare,
  summarize,
  TREND_FLOOR,
  trendOf,
} from './loadavg';

describe('parseLoadAvg — an idle desktop', () => {
  const info = parseLoadAvg(fixture('idle-desktop'));

  it('reads all six fields of the one line', () => {
    expect(info.load).toEqual({
      one: 0.12,
      five: 0.18,
      fifteen: 0.22,
      runnable: 1,
      threads: 1043,
      lastPid: 28714,
    });
  });

  // A tenth of a load either way is not a direction.
  it('calls a load that has barely moved steady', () => {
    expect(trendOf(info.load!)).toBe('steady');
    expect(summarize(info)?.trend).toBe('steady');
  });

  it('counts the threads that are not runnable', () => {
    expect(notRunnable(info.load!)).toBe(1042);
    expect(runnableShare(info.load!)).toBeCloseTo(1 / 1043);
  });

  // Nothing is waiting: the load is below the runnable count, not above it.
  it('finds no load beyond what is runnable', () => {
    expect(excessOverRunnable(info.load!)).toBeCloseTo(-0.88);
  });
});

describe('parseLoadAvg — a busy server', () => {
  const info = parseLoadAvg(fixture('busy-server'));

  /**
   * The figures are damped averages over different windows, so the short one
   * standing above the long one is the load climbing.
   */
  it('reads a climbing load from the short average against the long', () => {
    expect(info.load).toMatchObject({ one: 12.44, five: 9.87, fifteen: 6.2 });
    expect(trendOf(info.load!)).toBe('rising');
  });

  it('reads the runnable count and the thread total', () => {
    expect(runnableShare(info.load!)).toBeCloseTo(14 / 2871);
    expect(notRunnable(info.load!)).toBe(2857);
  });
});

describe('parseLoadAvg — stalled on I/O', () => {
  const info = parseLoadAvg(fixture('io-stalled'));

  /**
   * On Linux the load counts uninterruptible sleepers too, so a load of 8 with
   * one thread runnable is seven things blocked rather than seven wanting CPU.
   */
  it('finds the load standing well above what is runnable', () => {
    expect(info.load).toMatchObject({ one: 8.02, runnable: 1 });
    expect(excessOverRunnable(info.load!)).toBeCloseTo(7.02);
    expect(summarize(info)?.excess).toBeCloseTo(7.02);
  });

  it('reads it as steady, since the spell has been going a while', () => {
    expect(trendOf(info.load!)).toBe('steady');
  });
});

describe('parseLoadAvg — recovering from a spike', () => {
  const info = parseLoadAvg(fixture('recovering'));

  it('reads a falling load from the short average against the long', () => {
    expect(info.load).toMatchObject({ one: 0.84, five: 3.21, fifteen: 5.6 });
    expect(trendOf(info.load!)).toBe('falling');
  });

  // The load has fallen below the runnable count, which is the other direction.
  it('finds nothing waiting beyond the runnable threads', () => {
    expect(excessOverRunnable(info.load!)).toBeLessThan(0);
  });
});

describe('parseLoadAvg — a container', () => {
  const info = parseLoadAvg(fixture('container'));

  it('reads a load of nothing and a PID namespace that has just started', () => {
    expect(info.load).toEqual({
      one: 0,
      five: 0.01,
      fifteen: 0.05,
      runnable: 1,
      threads: 12,
      lastPid: 47,
    });
    expect(trendOf(info.load!)).toBe('steady');
  });

  it('keeps the two decimal places the kernel prints', () => {
    expect(formatLoad(info.load!.one)).toBe('0.00');
    expect(formatLoad(info.load!.fifteen)).toBe('0.05');
  });
});

describe('parseLoadAvg — every fixture', () => {
  const names = ['idle-desktop', 'busy-server', 'io-stalled', 'recovering', 'container'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseLoadAvg(fixture(name));
    const summary = summarize(info)!;
    const load = summary.load;

    expect(load).not.toBeNull();
    for (const value of [load.one, load.five, load.fifteen]) {
      expect(value).toBeGreaterThanOrEqual(0);
      // The kernel prints two places, so nothing finer survives the file.
      expect(formatLoad(value)).toBe(value.toFixed(2));
    }

    // At least the thread doing the reading is runnable.
    expect(load.runnable).toBeGreaterThan(0);
    expect(load.runnable).toBeLessThanOrEqual(load.threads);
    expect(notRunnable(load) + load.runnable).toBe(load.threads);
    expect(runnableShare(load)).toBeLessThanOrEqual(1);
    expect(load.lastPid).toBeGreaterThan(0);

    // The trend is read off the two ends, never the middle figure.
    const spread = Math.abs(load.one - load.fifteen);
    if (summary.trend === 'steady') {
      expect(spread).toBeLessThanOrEqual(Math.max(TREND_FLOOR, load.fifteen * 0.1));
    } else {
      expect(spread).toBeGreaterThan(TREND_FLOOR);
    }
  });
});

describe('parseLoadAvg — awkward input', () => {
  it('finds nothing in an empty file', () => {
    expect(parseLoadAvg('')).toEqual({ load: null });
    expect(summarize(parseLoadAvg(''))).toBeNull();
  });

  it('finds nothing in a file that is not /proc/loadavg', () => {
    expect(parseLoadAvg('processor\t: 0\n').load).toBeNull();
  });

  it('reads a load above 100, which a busy machine reaches', () => {
    expect(parseLoadAvg('142.71 98.02 51.44 96/8412 1204553\n').load).toMatchObject({
      one: 142.71,
      runnable: 96,
    });
  });

  it('reads a line however it is spaced', () => {
    expect(parseLoadAvg('  0.52   0.44   0.39   2/1234   5678  \n').load).toMatchObject({
      one: 0.52,
      lastPid: 5678,
    });
  });

  it('skips a line with a field missing', () => {
    expect(parseLoadAvg('0.52 0.44 0.39 2/1234\n').load).toBeNull();
    expect(parseLoadAvg('0.52 0.44 2/1234 5678\n').load).toBeNull();
  });

  it('skips a line whose runnable field is not a pair', () => {
    expect(parseLoadAvg('0.52 0.44 0.39 2 1234 5678\n').load).toBeNull();
  });

  // The trend is a judgement about presentation, so its edges are pinned.
  it('needs more than the floor to call the load moving', () => {
    const at = parseLoadAvg(`0.15 0.00 0.00 1/10 42\n`).load!;
    const past = parseLoadAvg(`0.16 0.00 0.00 1/10 42\n`).load!;

    expect(trendOf(at)).toBe('steady');
    expect(trendOf(past)).toBe('rising');
  });

  /**
   * The tolerance scales with the load: a tenth of a point is a direction at
   * 0.2, and nothing at all at 20.
   */
  it('measures the difference against the size of the load', () => {
    expect(trendOf({ one: 20.5, five: 20, fifteen: 20, runnable: 1, threads: 10, lastPid: 42 }))
      .toBe('steady');
    expect(trendOf({ one: 0.5, five: 0.2, fifteen: 0.2, runnable: 1, threads: 10, lastPid: 42 }))
      .toBe('rising');
  });

  it('claims no share when the file reports no threads', () => {
    const load = { one: 0, five: 0, fifteen: 0, runnable: 0, threads: 0, lastPid: 1 };

    expect(runnableShare(load)).toBeNull();
    expect(notRunnable(load)).toBe(0);
  });
});
