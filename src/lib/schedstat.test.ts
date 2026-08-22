import { describe, expect, it } from 'vitest';
import { readSchedStatFixture as fixture } from '../test/fixtures';
import {
  averageWaitNs,
  countMask,
  formatDuration,
  formatNs,
  idleShare,
  localWakeupShare,
  NAMED_VERSION,
  parseSchedStat,
  summarize,
  waitRatio,
} from './schedstat';

describe('parseSchedStat — a quiet desktop', () => {
  const schedstat = parseSchedStat(fixture('desktop-4core'));

  it('reads the version and timestamp', () => {
    expect(schedstat.version).toBe(15);
    expect(schedstat.timestamp).toBe(4295061837);
    expect(schedstat.named).toBe(true);
  });

  it('reads a CPU per line, in order', () => {
    expect(schedstat.cpus.map((cpu) => cpu.name)).toEqual(['cpu0', 'cpu1', 'cpu2', 'cpu3']);
    expect(schedstat.cpus[0]?.index).toBe(0);
  });

  it('names the nine version 15 fields', () => {
    const cpu = schedstat.cpus[0]!;

    expect(cpu.values).toHaveLength(9);
    expect(cpu.timeslices).toBe(12847203);
    expect(cpu.runTimeNs).toBe(1284000000000);
    // The second field is a legacy counter, always zero, and is left unnamed.
    expect(cpu.values[1]).toBe(0);
    expect(cpu.wakeupsLocal).toBeLessThan(cpu.wakeups!);
  });

  // The domains under a `cpu` line belong to it; the file is grouped, not flat.
  it('attaches each domain to the CPU above it', () => {
    for (const cpu of schedstat.cpus) {
      expect(cpu.domains.map((domain) => domain.name)).toEqual(['domain0', 'domain1']);
      expect(cpu.domains.every((domain) => domain.values.length === 36)).toBe(true);
    }
  });

  // The mask is what makes the topology readable: `03` is an SMT pair, `0f`
  // the whole four-core package.
  it('reads the domain mask and counts the CPUs in it', () => {
    const [inner, outer] = schedstat.cpus[0]!.domains;

    expect(inner).toMatchObject({ mask: '03', cpuCount: 2 });
    expect(outer).toMatchObject({ mask: '0f', cpuCount: 4 });
    // cpu2 and cpu3 are the other SMT pair.
    expect(schedstat.cpus[2]?.domains[0]?.mask).toBe('0c');
  });

  it('works out the average wait per timeslice', () => {
    const cpu = schedstat.cpus[0]!;

    expect(averageWaitNs(cpu)).toBeCloseTo(cpu.waitTimeNs! / cpu.timeslices!, 6);
    expect(formatNs(averageWaitNs(cpu)!)).toBe('42 µs');
    expect(waitRatio(cpu)).toBeLessThan(1);
  });

  it('works out the scheduler ratios', () => {
    const cpu = schedstat.cpus[0]!;

    expect(idleShare(cpu)).toBeCloseTo(0.38, 2);
    expect(localWakeupShare(cpu)).toBeCloseTo(0.66, 2);
  });

  it('summarizes across the CPUs', () => {
    const summary = summarize(schedstat);

    expect(summary.cpus).toBe(4);
    expect(summary.domainLevels).toBe(2);
    expect(summary.timeslices).toBe(
      schedstat.cpus.reduce((sum, cpu) => sum + cpu.timeslices!, 0),
    );
    expect(formatNs(summary.averageWaitNs!)).toBe('46 µs');
    // The worst CPU is the one tasks waited longest on, not the busiest.
    expect(summary.worst?.name).toBe('cpu3');
  });
});

describe('parseSchedStat — a NUMA server', () => {
  const schedstat = parseSchedStat(fixture('server-numa'));

  it('reads three levels of scheduling domain', () => {
    const summary = summarize(schedstat);

    expect(summary.cpus).toBe(8);
    expect(summary.domainLevels).toBe(3);
  });

  it('widens the mask at each level', () => {
    const [smt, package_, node] = schedstat.cpus[0]!.domains;

    expect(smt).toMatchObject({ mask: '03', cpuCount: 2 });
    expect(package_).toMatchObject({ mask: '0f', cpuCount: 4 });
    expect(node).toMatchObject({ mask: 'ff', cpuCount: 8 });
  });

  it('puts the far CPUs in the other half of the machine', () => {
    expect(schedstat.cpus[6]?.domains[0]?.mask).toBe('c0');
    expect(schedstat.cpus[6]?.domains[1]?.mask).toBe('f0');
    expect(schedstat.cpus[6]?.domains[2]?.mask).toBe('ff');
  });
});

describe('parseSchedStat — a uniprocessor board', () => {
  const schedstat = parseSchedStat(fixture('up-single'));

  // Nothing to balance against, so the kernel writes no domain lines at all.
  it('reads a CPU with no domains', () => {
    expect(schedstat.cpus).toHaveLength(1);
    expect(schedstat.cpus[0]?.domains).toEqual([]);
    expect(summarize(schedstat).domainLevels).toBe(0);
  });

  it('has every wakeup staying local, since there is nowhere else', () => {
    expect(localWakeupShare(schedstat.cpus[0]!)).toBe(1);
  });
});

describe('parseSchedStat — an oversubscribed host', () => {
  const schedstat = parseSchedStat(fixture('oversubscribed'));

  it('shows tasks queued far longer than they run', () => {
    const cpu = schedstat.cpus[0]!;

    expect(waitRatio(cpu)).toBeGreaterThan(10);
    expect(averageWaitNs(cpu)).toBeGreaterThan(500_000);
    expect(formatNs(summarize(schedstat).averageWaitNs!)).toBe('829 µs');
  });

  it('rarely keeps a wakeup on the same CPU', () => {
    expect(localWakeupShare(schedstat.cpus[0]!)).toBeCloseTo(0.29, 2);
  });
});

describe('parseSchedStat — every fixture', () => {
  const names = ['desktop-4core', 'server-numa', 'vm-2core', 'up-single', 'oversubscribed'];

  it.each(names)('parses %s into consistent CPUs', (name) => {
    const schedstat = parseSchedStat(fixture(name));

    expect(schedstat.version).toBe(15);
    expect(schedstat.named).toBe(true);
    expect(schedstat.cpus.length).toBeGreaterThan(0);

    schedstat.cpus.forEach((cpu, index) => {
      expect(cpu.index).toBe(index);
      expect(cpu.values).toHaveLength(9);
      // A wakeup that stayed local is one of the wakeups that happened.
      expect(cpu.wakeupsLocal!).toBeLessThanOrEqual(cpu.wakeups!);
      // The CPU cannot have gone idle more often than it scheduled.
      expect(cpu.wentIdle!).toBeLessThanOrEqual(cpu.schedules!);
      expect(cpu.runTimeNs!).toBeGreaterThan(0);
      expect(averageWaitNs(cpu)).toBeGreaterThan(0);
      // Each domain widens or holds, never narrows, going outwards.
      let previous = 0;
      for (const domain of cpu.domains) {
        expect(domain.cpuCount).toBeGreaterThanOrEqual(previous);
        expect(domain.values).toHaveLength(36);
        previous = domain.cpuCount;
      }
    });
  });
});

describe('parseSchedStat — awkward input', () => {
  it('returns nothing for a file that is not schedstat', () => {
    expect(parseSchedStat('')).toMatchObject({ version: null, cpus: [] });
    expect(parseSchedStat('processor\t: 0\n').cpus).toEqual([]);
  });

  /**
   * An older version orders the fields differently, so naming them as if they
   * were v15 would report the wrong numbers under the right labels.
   */
  it('refuses to name the fields of a version it does not know', () => {
    const schedstat = parseSchedStat(
      'version 14\ntimestamp 1\ncpu0 1 2 3 4 5 6 7 8 9 10 11 12\n',
    );

    expect(schedstat.version).toBeLessThan(NAMED_VERSION);
    expect(schedstat.named).toBe(false);
    expect(schedstat.cpus[0]?.values).toHaveLength(12);
    expect(schedstat.cpus[0]?.runTimeNs).toBeNull();
    expect(averageWaitNs(schedstat.cpus[0]!)).toBeNull();
    expect(summarize(schedstat).averageWaitNs).toBeNull();
  });

  it('names the fields of a newer version, which only appends', () => {
    const schedstat = parseSchedStat(`version 16\ncpu0 ${'1 '.repeat(10)}\n`);

    expect(schedstat.named).toBe(true);
    expect(schedstat.cpus[0]?.timeslices).toBe(1);
  });

  it('does not name anything when a CPU line is too short', () => {
    expect(parseSchedStat('version 15\ncpu0 1 2 3\n').named).toBe(false);
  });

  it('ignores a domain line that comes before any CPU', () => {
    const schedstat = parseSchedStat('version 15\ndomain0 03 1 2 3\ncpu0 1 2 3 4 5 6 7 8 9\n');

    expect(schedstat.cpus).toHaveLength(1);
    expect(schedstat.cpus[0]?.domains).toEqual([]);
  });

  it('stops at a non-numeric token rather than shifting the columns', () => {
    const [cpu] = parseSchedStat('version 15\ncpu0 1 2 3 4 nonsense 6 7 8 9\n').cpus;

    expect(cpu?.values).toEqual([1, 2, 3, 4]);
  });

  it('counts a mask wider than 32 bits', () => {
    expect(countMask('ff')).toBe(8);
    expect(countMask('0f')).toBe(4);
    expect(countMask('00000000,ffffffff')).toBe(32);
    expect(countMask('ffffffff,ffffffff')).toBe(64);
    expect(countMask('0')).toBe(0);
  });
});

describe('formatting', () => {
  it('scales a latency through the time units', () => {
    expect(formatNs(0)).toBe('0 ns');
    expect(formatNs(840)).toBe('840 ns');
    expect(formatNs(42_000)).toBe('42 µs');
    expect(formatNs(1_400_000)).toBe('1.4 ms');
    expect(formatNs(2_500_000_000)).toBe('2.5 s');
  });

  it('scales a total through hours and minutes', () => {
    expect(formatDuration(1.5e9)).toBe('1.5s');
    expect(formatDuration(150e9)).toBe('2m 30s');
    expect(formatDuration(11_520e9)).toBe('3h 12m');
  });
});
