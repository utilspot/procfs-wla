import { describe, expect, it } from 'vitest';
import { readUptimeFixture as fixture } from '../test/fixtures';
import {
  candidateCpuCounts,
  formatDuration,
  formatShare,
  idleBelowUptime,
  idlePerSecond,
  idleShare,
  IMPLAUSIBLE_CPUS,
  impliesTimeNamespace,
  minimumCpus,
  parseUptime,
  summarize,
} from './uptime';

describe('parseUptime — an ordinary desktop', () => {
  const uptime = parseUptime(fixture('desktop'))!;

  it('reads the two fields the file is made of', () => {
    expect(uptime).toMatchObject({ seconds: 17465.37, idleSeconds: 98587.48 });
    expect(uptime.raw).toEqual(['17465.37', '98587.48']);
  });

  /**
   * The second figure is idle summed over every CPU, so it exceeding the
   * uptime is ordinary rather than a contradiction.
   */
  it('reads the idle total as CPUs’ worth of idle, not as wall time', () => {
    expect(idlePerSecond(uptime)).toBeCloseTo(5.6447, 4);
    expect(uptime.idleSeconds!).toBeGreaterThan(uptime.seconds);
  });

  /**
   * A CPU cannot be idle for more than a second per second, so the ratio is a
   * floor on the count. This pair was read off a machine with six.
   */
  it('reads the fewest CPUs that could have produced this much idle', () => {
    expect(minimumCpus(uptime)).toBe(6);
  });

  it('gives the idle share per candidate count, since the count is not here', () => {
    expect(idleShare(uptime, 6)).toBeCloseTo(0.9408, 4);
    expect(idleShare(uptime, 8)).toBeCloseTo(0.7056, 4);
    // Never past 100%, whatever the arithmetic says.
    expect(idleShare(uptime, 1)).toBe(1);
  });

  it('summarizes the pair', () => {
    const summary = summarize(uptime);

    expect(summary).toMatchObject({
      seconds: 17465.37,
      idleSeconds: 98587.48,
      minimumCpus: 6,
      idleBelowUptime: false,
      timeNamespace: false,
    });
    expect(summary.candidates).toEqual([6, 8, 16, 32]);
  });
});

describe('parseUptime — a server that has been working', () => {
  const uptime = parseUptime(fixture('busy-server'))!;

  it('reads 200 days of uptime', () => {
    expect(formatDuration(uptime.seconds)).toBe('200d 0h 2m');
  });

  /**
   * Only 1.6 CPUs' worth of idle: on a machine with sixteen of them that is
   * 90% busy, which is the reading the ratio alone cannot give.
   */
  it('reads a machine with little idle to go round', () => {
    expect(idlePerSecond(uptime)).toBeCloseTo(1.6, 4);
    expect(minimumCpus(uptime)).toBe(2);
    expect(idleShare(uptime, 16)).toBeCloseTo(0.1, 4);
    expect(formatShare(idleShare(uptime, 16)!)).toBe('10%');
    expect(formatShare(1 - idleShare(uptime, 16)!)).toBe('90%');
  });
});

describe('parseUptime — seconds after a boot', () => {
  const uptime = parseUptime(fixture('fresh-boot'))!;

  it('reads a machine that has barely started', () => {
    expect(uptime.seconds).toBe(12.34);
    expect(formatDuration(uptime.seconds)).toBe('12 s');
    expect(minimumCpus(uptime)).toBe(6);
  });
});

describe('parseUptime — a laptop that spent the week suspended', () => {
  const uptime = parseUptime(fixture('after-suspend'))!;

  /**
   * Uptime comes from CLOCK_BOOTTIME and counts the sleep; the idle total does
   * not advance while the CPUs are off, so it falls behind.
   */
  it('reads less idle than a second per second of uptime', () => {
    expect(idleBelowUptime(uptime)).toBe(true);
    expect(idlePerSecond(uptime)).toBeCloseTo(0.4296, 4);
    expect(summarize(uptime).idleBelowUptime).toBe(true);
  });

  /** Which is not a time namespace, and must not be reported as one. */
  it('is not mistaken for a namespaced uptime', () => {
    expect(impliesTimeNamespace(uptime)).toBe(false);
    expect(minimumCpus(uptime)).toBe(1);
  });
});

describe('parseUptime — one core, idle for a day', () => {
  const uptime = parseUptime(fixture('single-core-idle'))!;

  /** The one case where the two figures are comparable at all. */
  it('reads the only shape where idle and uptime line up', () => {
    expect(minimumCpus(uptime)).toBe(1);
    expect(idleShare(uptime, 1)).toBeCloseTo(0.9942, 4);
    expect(formatDuration(uptime.seconds)).toBe('1d 0h 0m');
  });
});

describe('parseUptime — a container in a time namespace', () => {
  const uptime = parseUptime(fixture('container-timens'))!;

  /**
   * The uptime is the container's and the idle total is the host's, so the
   * pair implies a machine far larger than any that exists. The mismatch is
   * the only thing that gives it away.
   */
  it('reads a pair that cannot describe one machine', () => {
    expect(minimumCpus(uptime)).toBe(14953);
    expect(minimumCpus(uptime)!).toBeGreaterThan(IMPLAUSIBLE_CPUS);
    expect(impliesTimeNamespace(uptime)).toBe(true);
    expect(summarize(uptime).timeNamespace).toBe(true);
  });
});

describe('parseUptime — the awkward files', () => {
  it('reads an empty file as no uptime at all', () => {
    expect(parseUptime('')).toBeNull();
    expect(parseUptime('\n\n')).toBeNull();
  });

  it('refuses a file that is not two numbers', () => {
    expect(parseUptime('nonsense\n')).toBeNull();
    expect(parseUptime('up 4 days\n')).toBeNull();
  });

  /** Every kernel prints both, but a rewritten file need not. */
  it('reads an uptime with no idle figure beside it', () => {
    const uptime = parseUptime('17465.37\n')!;

    expect(uptime.seconds).toBe(17465.37);
    expect(uptime.idleSeconds).toBeNull();
    expect(idlePerSecond(uptime)).toBeNull();
    expect(minimumCpus(uptime)).toBeNull();
    expect(summarize(uptime).candidates).toEqual([]);
  });

  it('reads CRLF line endings', () => {
    expect(parseUptime('17465.37 98587.48\r\n')?.seconds).toBe(17465.37);
  });

  it('reads whole seconds with no decimal point', () => {
    expect(parseUptime('120 480\n')).toMatchObject({ seconds: 120, idleSeconds: 480 });
  });

  it('does not divide by an uptime of zero', () => {
    const uptime = parseUptime('0.00 0.00\n')!;

    expect(idlePerSecond(uptime)).toBeNull();
    expect(minimumCpus(uptime)).toBeNull();
    expect(idleShare(uptime, 4)).toBeNull();
  });

  it('ignores a nonsense CPU count rather than dividing by it', () => {
    const uptime = parseUptime(fixture('desktop'))!;

    expect(idleShare(uptime, 0)).toBeNull();
    expect(idleShare(uptime, -4)).toBeNull();
  });
});

describe('candidateCpuCounts', () => {
  it('starts at the fewest possible and doubles from there', () => {
    expect(candidateCpuCounts(6)).toEqual([6, 8, 16, 32]);
    expect(candidateCpuCounts(1)).toEqual([1, 2, 4, 8]);
    expect(candidateCpuCounts(2)).toEqual([2, 4, 8, 16]);
    expect(candidateCpuCounts(16)).toEqual([16, 32, 64, 128]);
  });

  it('gives as many rows as it is asked for', () => {
    expect(candidateCpuCounts(3, 2)).toEqual([3, 4]);
  });
});

describe('formatting', () => {
  it('says a duration the way uptime(1) does', () => {
    expect(formatDuration(0)).toBe('0.00 s');
    expect(formatDuration(12.34)).toBe('12 s');
    expect(formatDuration(59.9)).toBe('60 s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(17465.37)).toBe('4h 51m');
    expect(formatDuration(86400)).toBe('1d 0h 0m');
    expect(formatDuration(17280144.62)).toBe('200d 0h 2m');
  });

  it('rounds a share without claiming a whole one it does not have', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.0001)).toBe('<1%');
    expect(formatShare(0.9408)).toBe('94%');
    expect(formatShare(0.994)).toBe('99%');
    expect(formatShare(1)).toBe('100%');
  });
});
