import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPidTimeInStateFixture as fixture } from '../test/fixtures';
import {
  ascends,
  busiestStep,
  canScale,
  CLOCK_TICK,
  formatDuration,
  formatFrequency,
  frequenciesOf,
  frequencyTable,
  heavyAtTopStep,
  isEmpty,
  meanFrequency,
  neverRan,
  parsePidTimeInState,
  policiesUsed,
  policyShare,
  policyTotal,
  ranOn,
  summarize,
  ticksToSeconds,
  topStepShare,
  totalTicks,
} from './pid-time_in_state';
import { parseUidTimeInState } from './uid_time_in_state';

describe('parsePidTimeInState — a phone with two clusters', () => {
  const info = parsePidTimeInState(fixture('big-little'));

  /** The layout's whole advantage: the boundary is named, not inferred. */
  it('reads a policy per cpuN header rather than one run-together table', () => {
    expect(info.policies.map((policy) => policy.cpu)).toEqual([0, 4]);
    expect(frequenciesOf(info.policies[0]!)).toEqual([300000, 691200, 1132800, 1478400]);
    expect(frequenciesOf(info.policies[1]!)).toEqual([633600, 1113600, 1651200, 2016000]);
    expect(info.orphans).toEqual([]);
    expect(info.malformed).toEqual([]);
  });

  it('reads a frequency and a tick count off each step', () => {
    expect(info.policies[0]!.steps[0]).toMatchObject({ khz: 300000, ticks: 41028 });
    expect(policyTotal(info.policies[0]!)).toBe(41028 + 3401 + 902 + 411);
    expect(totalTicks(info)).toBe(45742 + 9882);
  });

  /** A mean across two clusters' steps would describe neither. */
  it('averages a frequency per policy and never across them', () => {
    const little = meanFrequency(info.policies[0]!)!;
    const big = meanFrequency(info.policies[1]!)!;

    expect(Math.round(little)).toBe(356097);
    expect(Math.round(big)).toBe(762031);
    expect(little).toBeGreaterThan(300000);
    expect(little).toBeLessThan(1478400);
  });

  it('finds the step a task spent longest at, per policy', () => {
    expect(busiestStep(info.policies[0]!)!.khz).toBe(300000);
    expect(busiestStep(info.policies[1]!)!.khz).toBe(633600);
    expect(summarize(info).busiest!.cpu).toBe(0);
  });

  it('shares a task’s time out between the policies', () => {
    expect(policyShare(info, info.policies[0]!)).toBeCloseTo(45742 / 55624, 6);
    expect(policiesUsed(info)).toHaveLength(2);
    expect(neverRan(info)).toBe(false);
  });
});

/** The ordinary shape for something the scheduler keeps off the big cores. */
describe('parsePidTimeInState — a task that never left the little cluster', () => {
  const info = parsePidTimeInState(fixture('little-only', '4242'));

  it('reads a whole policy of zeroes as one never run on', () => {
    expect(ranOn(info.policies[0]!)).toBe(true);
    expect(ranOn(info.policies[1]!)).toBe(false);
    expect(policiesUsed(info).map((policy) => policy.cpu)).toEqual([0]);
    expect(neverRan(info)).toBe(false);
  });

  it('has no mean and no top-step share for a policy never run on', () => {
    expect(meanFrequency(info.policies[1]!)).toBeNull();
    expect(topStepShare(info.policies[1]!)).toBeNull();
    expect(busiestStep(info.policies[1]!)).toBeNull();
    expect(policyShare(info, info.policies[1]!)).toBe(0);
  });
});

/** What a battery question is actually asking this file. */
describe('parsePidTimeInState — a task living at the top step', () => {
  const info = parsePidTimeInState(fixture('top-step'));

  it('works out the share of a policy’s time at its most expensive step', () => {
    const big = info.policies[1]!;

    expect(topStepShare(big)).toBeCloseTo(42118 / 56268, 6);
    expect(heavyAtTopStep(big)).toBe(true);
    // The little cluster is spread across its steps instead.
    expect(heavyAtTopStep(info.policies[0]!)).toBe(false);
  });
});

/** One policy of two steps, which is every operating point a BCM2711 has. */
describe('parsePidTimeInState — a single-cluster machine', () => {
  const info = parsePidTimeInState(fixture('single-cluster'));

  it('reads one policy and says nothing about clusters', () => {
    expect(info.policies).toHaveLength(1);
    expect(canScale(info.policies[0]!)).toBe(true);
    expect(frequencyTable(info)).toEqual([600000, 1500000]);
  });

  it('converts the ticks to the seconds they mean', () => {
    expect(CLOCK_TICK).toBe(100);
    expect(totalTicks(info)).toBe(15255);
    expect(ticksToSeconds(totalTicks(info))).toBe(152.55);
    expect(formatDuration(summarize(info).seconds)).toBe('2m 32s');
  });
});

/**
 * Two answers the file gives the same zeroes to: a task that has had no CPU,
 * and one whose array was never allocated. The uid file omits the column
 * instead, which is the one place it is the more honest of the two.
 */
describe('parsePidTimeInState — never accounted a tick', () => {
  const info = parsePidTimeInState(fixture('never-ran', '901'));

  it('reads all zeroes as idle rather than as an empty file', () => {
    expect(neverRan(info)).toBe(true);
    expect(isEmpty(info)).toBe(false);
    expect(info.policies).toHaveLength(2);
    expect(summarize(info)).toMatchObject({ ticks: 0, seconds: 0, idle: true, busiest: null });
  });

  it('has no busiest policy to name rather than naming the first', () => {
    expect(summarize(info).busiest).toBeNull();
    expect(policiesUsed(info)).toEqual([]);
  });
});

describe('parsePidTimeInState — what is not this file', () => {
  it('reads an empty file as empty', () => {
    const info = parsePidTimeInState('');

    expect(isEmpty(info)).toBe(true);
    expect(info.bytes).toBe(0);
    expect(totalTicks(info)).toBe(0);
  });

  /** Every step the driver prints belongs to a policy it has just named. */
  it('keeps a frequency line that came before any header apart', () => {
    const info = parsePidTimeInState('300000 41\ncpu0\n300000 12\n');

    expect(info.orphans).toEqual([{ khz: 300000, ticks: 41, line: 1 }]);
    expect(info.policies).toHaveLength(1);
    expect(policyTotal(info.policies[0]!)).toBe(12);
  });

  it('keeps a line that is neither a header nor a step aside', () => {
    const info = parsePidTimeInState('cpu0\n300000 12\nnot a step at all\n');

    expect(info.malformed).toEqual(['not a step at all']);
    expect(info.policies[0]!.steps).toHaveLength(1);
  });

  /** A cpufreq table is built ascending and printed in that order. */
  it('notices a policy whose steps do not climb', () => {
    expect(ascends(parsePidTimeInState(fixture('big-little')).policies[0]!)).toBe(true);
    expect(ascends(parsePidTimeInState('cpu0\n1500000 4\n600000 9\n').policies[0]!)).toBe(false);
  });

  it('does not treat a one-step policy as one that can change speed', () => {
    expect(canScale(parsePidTimeInState('cpu0\n1500000 4\n').policies[0]!)).toBe(false);
  });
});

describe('formatting', () => {
  it('reads a frequency out of the kHz the file prints', () => {
    expect(formatFrequency(300000)).toBe('300 MHz');
    expect(formatFrequency(2016000)).toBe('2.02 GHz');
  });
});

/**
 * The Pi is the one capture whose kernel has `CONFIG_CPU_FREQ_TIMES`, so it is
 * the one machine with either of these files — and they are two views of one
 * cpufreq table. Checked against each other so they cannot drift apart the way
 * two files edited by hand otherwise would, which is what the `gpu_load` and
 * `gpu_memory` captures do for the same reason.
 */
describe('the raspberry-pi capture, against its own /proc/uid_time_in_state', () => {
  const machine = (path: string) =>
    readFileSync(resolve(process.cwd(), 'server/machines/raspberry-pi/proc', path), 'utf8');

  const uid = parseUidTimeInState(machine('uid_time_in_state'));
  const pids = ['1', '12282', 'self'];

  it.each(pids)('has the same frequency table under pid %s as the uid file heads with', (pid) => {
    const info = parsePidTimeInState(machine(`${pid}/time_in_state`));

    expect(frequencyTable(info)).toEqual(uid.frequencies);
  });

  /** The uid file accounts every task, so no task can have run longer than it. */
  it.each(pids)('accounts pid %s no more time than the uid table has in total', (pid) => {
    const info = parsePidTimeInState(machine(`${pid}/time_in_state`));
    const uidTotal = uid.uids.reduce(
      (sum, entry) => sum + entry.times.reduce((inner, ticks) => inner + ticks, 0),
      0,
    );

    expect(totalTicks(info)).toBeGreaterThan(0);
    expect(totalTicks(info)).toBeLessThan(uidTotal);
  });

  /** A Pi 4's four cores share one policy, so there is one header and no more. */
  it.each(pids)('reads pid %s as the single-cluster machine a Pi 4 is', (pid) => {
    const info = parsePidTimeInState(machine(`${pid}/time_in_state`));

    expect(info.policies).toHaveLength(1);
    expect(info.policies[0]!.cpu).toBe(0);
    expect(ascends(info.policies[0]!)).toBe(true);
  });
});
