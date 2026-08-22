import { describe, expect, it } from 'vitest';
import { readStatFixture as fixture } from '../test/fixtures';
import {
  breakdown,
  formatCount,
  formatUptime,
  parseStat,
  seconds,
  uptime,
  USER_HZ,
} from './stat';

describe('parseStat — an idle desktop', () => {
  const stat = parseStat(fixture('desktop-8core'));

  it('reads the aggregate line and every CPU', () => {
    expect(stat.total).toMatchObject({ index: null, user: 1247832, nice: 8421, idle: 48325043 });
    expect(stat.cpus).toHaveLength(8);
    expect(stat.cpus.map((cpu) => cpu.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('reads all ten columns of a modern kernel', () => {
    expect(stat.total).toEqual({
      index: null,
      user: 1247832,
      nice: 8421,
      system: 341156,
      idle: 48325043,
      iowait: 62184,
      irq: 0,
      softirq: 18342,
      steal: 0,
      guest: 0,
      guestNice: 0,
    });
  });

  it('takes only the total from the intr and softirq breakdowns', () => {
    expect(stat.interrupts).toBe(184729103);
    expect(stat.softirqs).toBe(94827361);
  });

  it('reads the scalar counters', () => {
    expect(stat.contextSwitches).toBe(892374615);
    expect(stat.btime).toBe(1721890234);
    expect(stat.processes).toBe(1284736);
    expect(stat.procsRunning).toBe(2);
    expect(stat.procsBlocked).toBe(0);
  });

  it('works out how the time was spent', () => {
    const usage = breakdown(stat.total!);

    expect(usage.total).toBe(1247832 + 8421 + 341156 + 48325043 + 62184 + 0 + 18342 + 0);
    expect(usage.idle).toBe(48325043 + 62184);
    expect(usage.busy).toBe(usage.total - usage.idle);
    expect(usage.busyPercent).toBeCloseTo(3.23, 1);
    expect(usage.states[0]?.state).toBe('idle');
    // The shares of the states that appear account for the whole time.
    expect(usage.states.reduce((sum, entry) => sum + entry.percent, 0)).toBeCloseTo(100, 6);
  });
});

describe('parseStat — a 2.6 kernel', () => {
  const stat = parseStat(fixture('legacy-2.6'));

  it('reports the columns it does not carry as absent, not zero', () => {
    expect(stat.total).toMatchObject({
      user: 2847132,
      iowait: 284719,
      irq: 18402,
      softirq: 94718,
      steal: null,
      guest: null,
      guestNice: null,
    });
  });

  it('ignores the page and swap lines older kernels emit', () => {
    expect(stat.cpus).toHaveLength(2);
    expect(stat.contextSwitches).toBe(1847203941);
    expect(stat.procsBlocked).toBe(1);
  });

  it('has no softirq line at all', () => {
    expect(stat.softirqs).toBeNull();
    expect(stat.interrupts).toBe(947281034);
  });

  it('leaves an absent column out of the breakdown rather than counting zero', () => {
    const usage = breakdown(stat.total!);

    expect(usage.states.map((entry) => entry.state)).not.toContain('steal');
    expect(usage.total).toBe(2847132 + 184203 + 941827 + 18472013 + 284719 + 18402 + 94718);
  });
});

describe('parseStat — a busy VM', () => {
  const stat = parseStat(fixture('busy-server'));

  it('sees the steal time', () => {
    expect(stat.total?.steal).toBe(4829103);
    expect(breakdown(stat.total!).states.find((entry) => entry.state === 'steal')?.percent)
      .toBeGreaterThan(5);
  });

  it('reads the run queue', () => {
    expect(stat.procsRunning).toBe(47);
    expect(stat.procsBlocked).toBe(12);
  });

  it('counts it as mostly busy', () => {
    expect(breakdown(stat.total!).busyPercent).toBeGreaterThan(70);
  });

  // Guest time is added into user and nice as well, so counting it again would
  // make the states total more than the time that actually passed.
  it('does not double-count guest time', () => {
    const usage = breakdown(stat.total!);

    expect(usage.states.map((entry) => entry.state)).not.toContain('guest');
    expect(usage.states.reduce((sum, entry) => sum + entry.percent, 0)).toBeCloseTo(100, 6);
  });
});

describe('parseStat — every fixture', () => {
  const names = [
    'desktop-8core',
    'container-2core',
    'legacy-2.6',
    'busy-server',
    'single-core-idle',
  ];

  it.each(names)('parses %s into a usable set of counters', (name) => {
    const stat = parseStat(fixture(name));

    expect(stat.total).not.toBeNull();
    expect(stat.cpus.length).toBeGreaterThan(0);
    expect(stat.btime).toBeGreaterThan(0);
    expect(stat.contextSwitches).toBeGreaterThan(0);

    // The kernel writes the aggregate line as the sum of the per-CPU ones, and
    // the fixtures hold to that, so this is exact rather than approximate.
    const summed = stat.cpus.reduce((sum, cpu) => sum + breakdown(cpu).total, 0);
    expect(summed).toBe(breakdown(stat.total!).total);
  });
});

describe('parseStat — awkward input', () => {
  it('returns empty counters for a file that is not /proc/stat', () => {
    const stat = parseStat('processor\t: 0\nvendor_id\t: AuthenticAMD\n');

    expect(stat.total).toBeNull();
    expect(stat.cpus).toEqual([]);
    expect(stat.btime).toBeNull();
  });

  it('skips a cpu line with fewer than the four required columns', () => {
    const stat = parseStat('cpu  100 200\ncpu0 1 2 3 4\n');

    expect(stat.total).toBeNull();
    expect(stat.cpus).toHaveLength(1);
  });

  it('stops at a non-numeric token instead of shifting the columns', () => {
    const stat = parseStat('cpu  10 20 30 40 nonsense 60\n');

    // `60` must not slide into iowait, where it would read as real data.
    expect(stat.total).toMatchObject({ user: 10, nice: 20, system: 30, idle: 40, iowait: null });
  });

  it('copes with blank lines and trailing whitespace', () => {
    const stat = parseStat('\n  cpu  1 2 3 4  \n\nctxt 99\n\n');

    expect(stat.total).toMatchObject({ user: 1, idle: 4 });
    expect(stat.contextSwitches).toBe(99);
  });

  it('has no share of anything when no time has passed', () => {
    const usage = breakdown(parseStat('cpu  0 0 0 0\n').total!);

    expect(usage.total).toBe(0);
    expect(usage.busyPercent).toBe(0);
    expect(usage.states).toEqual([]);
  });
});

describe('helpers', () => {
  it('converts jiffies to seconds', () => {
    expect(USER_HZ).toBe(100);
    expect(seconds(100)).toBe(1);
    expect(seconds(4321)).toBeCloseTo(43.21);
  });

  it('measures uptime from btime against a given moment', () => {
    const stat = parseStat('btime 1721890234\n');
    const now = new Date((1721890234 + 3 * 86400 + 4 * 3600) * 1000);

    expect(uptime(stat, now)).toBe(3 * 86400 + 4 * 3600);
    expect(formatUptime(uptime(stat, now)!)).toBe('3d 4h');
  });

  it('has no uptime without a btime', () => {
    expect(uptime(parseStat('cpu  1 2 3 4\n'))).toBeNull();
  });

  it('never reports a negative uptime for a clock behind btime', () => {
    const stat = parseStat('btime 1721890234\n');
    expect(uptime(stat, new Date(1721890234000 - 60_000))).toBe(0);
  });

  it('formats a duration at the two coarsest units that say anything', () => {
    expect(formatUptime(0)).toBe('0m');
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3 * 3600 + 25 * 60)).toBe('3h 25m');
    expect(formatUptime(2 * 86400 + 7 * 3600 + 59 * 60)).toBe('2d 7h');
  });

  it('shortens big counters', () => {
    expect(formatCount(42)).toBe('42');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(2_400_000)).toBe('2.4M');
    expect(formatCount(8_472_103_941)).toBe('8.5G');
    expect(formatCount(1.2e12)).toBe('1.2T');
  });
});
