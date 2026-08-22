import { describe, expect, it } from 'vitest';
import { readUidTimeInStateFixture as fixture } from '../test/fixtures';
import {
  byTime,
  clusterTimes,
  clusterTotal,
  formatDuration,
  formatFrequency,
  formatShare,
  heavyAtTopStep,
  identify,
  isShortRow,
  meanFrequency,
  parseUidTimeInState,
  splitClusters,
  summarize,
  ticksToSeconds,
  TOP_STEP_HEAVY,
  topStepShare,
} from './uid_time_in_state';

describe('parseUidTimeInState — a big.LITTLE phone', () => {
  const info = parseUidTimeInState(fixture('big-little'));

  it('reads the header as every frequency the machine can run at', () => {
    expect(info.frequencies).toHaveLength(16);
    expect(info.frequencies[0]).toBe(300000);
    expect(info.frequencies[15]).toBe(2419200);
  });

  it('reads a line as one count per frequency', () => {
    const system = info.uids.find((uid) => uid.uid === 1000)!;

    expect(system.times).toHaveLength(16);
    expect(system.times[0]).toBe(210443);
    expect(system.total).toBe(system.times.reduce((sum, ticks) => sum + ticks, 0));
  });

  /**
   * The header is the policies' tables one after another, and a policy starts
   * again at its own lowest step — which is the only thing saying where one
   * cluster ends and the next begins.
   */
  it('splits the header back into the clusters it was made of', () => {
    expect(info.clusters).toHaveLength(2);
    expect(info.clusters[0]).toMatchObject({ index: 0, offset: 0 });
    expect(info.clusters[0]!.frequencies).toHaveLength(8);
    expect(info.clusters[1]).toMatchObject({ index: 1, offset: 8 });
    expect(info.clusters[1]!.frequencies[0]).toBe(710400);
  });

  it('takes each cluster’s columns out of a uid’s row', () => {
    const app = info.uids.find((uid) => uid.uid === 10123)!;
    const [little, big] = info.clusters;

    expect(clusterTimes(app, little!)).toHaveLength(8);
    expect(clusterTimes(app, big!)[0]).toBe(14022);
    expect(clusterTotal(app, little!) + clusterTotal(app, big!)).toBe(app.total);
  });

  /**
   * A mean over both clusters would sit between a little core's steps and a big
   * one's and describe neither, so it is worked out per cluster.
   */
  it('weights the mean frequency by the time spent at each step', () => {
    const app = info.uids.find((uid) => uid.uid === 10123)!;
    const [little, big] = info.clusters;

    const times = clusterTimes(app, little!);
    const weighted =
      times.reduce((sum, ticks, step) => sum + ticks * little!.frequencies[step]!, 0) /
      clusterTotal(app, little!);

    expect(meanFrequency(app, little!)).toBeCloseTo(weighted);
    // The app spends far more of its big-cluster time high up than root does.
    expect(meanFrequency(app, big!)!).toBeGreaterThan(
      meanFrequency(info.uids.find((uid) => uid.uid === 0)!, big!)!,
    );
  });

  it('measures the share spent at a cluster’s top step', () => {
    const app = info.uids.find((uid) => uid.uid === 10123)!;
    const [little, big] = info.clusters;

    expect(topStepShare(app, big!)).toBeCloseTo(30000 / clusterTotal(app, big!));
    expect(topStepShare(app, little!)).toBeCloseTo(1420 / clusterTotal(app, little!));
  });

  it('ranks the uids by the CPU time they have had', () => {
    expect(byTime(info).map((uid) => uid.uid).slice(0, 3)).toEqual([1000, 10123, 0]);
  });

  it('summarizes the machine and the uids on it', () => {
    expect(summarize(info)).toMatchObject({ uids: 9, clusters: 2, apps: 2 });
    expect(summarize(info).busiest?.uid).toBe(1000);
    expect(summarize(info).total).toBe(
      info.uids.reduce((sum, uid) => sum + uid.total, 0),
    );
  });
});

describe('heavyAtTopStep', () => {
  const info = parseUidTimeInState(fixture('big-little'));

  it('finds the uids sitting at a cluster’s top step, worst first', () => {
    const heavy = heavyAtTopStep(info, 0.1);

    expect(heavy[0]!.uid.uid).toBe(10123);
    expect(heavy[0]!.cluster.index).toBe(1);
    expect(heavy.map((use) => use.share)).toEqual([...heavy.map((use) => use.share)].sort((a, b) => b - a));
  });

  it('says nothing of anyone below the threshold', () => {
    expect(heavyAtTopStep(info, 0.9)).toEqual([]);
  });

  /** Every tick of a one-step cluster is at its top step, for everybody. */
  it('leaves out a cluster with a single step', () => {
    const single = parseUidTimeInState('uid: 1200000\n0: 400\n1000: 900\n');

    expect(single.clusters).toHaveLength(1);
    expect(heavyAtTopStep(single)).toEqual([]);
  });
});

describe('parseUidTimeInState — one cpufreq policy', () => {
  const info = parseUidTimeInState(fixture('single-cluster'));

  it('finds the one cluster, which is every column', () => {
    expect(info.clusters).toHaveLength(1);
    expect(info.clusters[0]!.frequencies).toEqual(info.frequencies);
  });

  it('gives every uid a mean frequency on it', () => {
    for (const uid of info.uids) {
      expect(meanFrequency(uid, info.clusters[0]!), String(uid.uid)).not.toBeNull();
    }
  });
});

/**
 * The capture the test server serves at `/proc/uid_time_in_state`, which is the
 * one machine here that has the file at all.
 */
describe('parseUidTimeInState — the Pi the server can be', () => {
  const info = parseUidTimeInState(fixture('raspberry-pi'));

  it('reads the two operating points a BCM2711 has as one policy', () => {
    expect(info.frequencies).toEqual([600000, 1500000]);
    expect(info.clusters).toHaveLength(1);
  });

  it('reads a line per uid that has run', () => {
    expect(info.uids.map((uid) => uid.uid)).toEqual([0, 102, 1000, 65534]);
    expect(byTime(info)[0]!.uid).toBe(1000);
  });

  /** Two steps and no third: the mean sits between them, never outside. */
  it('puts the mean frequency between the two steps', () => {
    const mean = meanFrequency(byTime(info)[0]!, info.clusters[0]!)!;

    expect(mean).toBeGreaterThan(600000);
    expect(mean).toBeLessThan(1500000);
  });

  it('finds the session sitting at the top step often enough to say so', () => {
    const heavy = heavyAtTopStep(info);

    expect(heavy.map((use) => use.uid.uid)).toEqual([1000]);
    expect(heavy[0]!.share).toBeCloseTo(172000 / (402118 + 172000));
  });
});

/**
 * The kernel prints as many counts as that uid's table had entries, which for a
 * uid first seen before a policy came up is fewer than the header has columns.
 */
describe('parseUidTimeInState — a row shorter than the header', () => {
  const info = parseUidTimeInState(fixture('short-rows'));
  const system = info.uids.find((uid) => uid.uid === 1000)!;

  it('keeps the row at the length the kernel printed', () => {
    expect(system.times).toHaveLength(8);
    expect(info.frequencies).toHaveLength(16);
    expect(isShortRow(system, info)).toBe(true);
    expect(isShortRow(info.uids.find((uid) => uid.uid === 0)!, info)).toBe(false);
  });

  /** The columns that were never printed are time never accounted, not zeroes. */
  it('reads the clusters it does have and nothing of the one it does not', () => {
    const [little, big] = info.clusters;

    expect(clusterTimes(system, little!)).toHaveLength(8);
    expect(clusterTimes(system, big!)).toEqual([]);
    expect(clusterTotal(system, big!)).toBe(0);
    expect(meanFrequency(system, big!)).toBeNull();
    expect(topStepShare(system, big!)).toBeNull();
  });
});

/**
 * A uid gets a line here by having been *seen*, not by having run — so a line of
 * nothing but zeros is an ordinary thing to find, and so are rows whose whole
 * time is under a second.
 */
describe('parseUidTimeInState — a uid that has never run', () => {
  const info = parseUidTimeInState(fixture('never-ran'));
  const cluster = info.clusters[0]!;
  const uidFor = (uid: number) => info.uids.find((entry) => entry.uid === uid)!;

  it('reads the nine even steps as one policy', () => {
    expect(info.frequencies).toEqual([
      600000, 700000, 800000, 900000, 1000000, 1100000, 1200000, 1300000, 1400000,
    ]);
    expect(info.clusters).toHaveLength(1);
  });

  /** Every column printed, and nothing in any of them. */
  it('reads a line of zeros as a uid with no time rather than a short row', () => {
    const idle = uidFor(65534);

    expect(idle.times).toHaveLength(9);
    expect(idle.total).toBe(0);
    expect(isShortRow(idle, info)).toBe(false);
    expect(clusterTotal(idle, cluster)).toBe(0);
    expect(meanFrequency(idle, cluster)).toBeNull();
    expect(topStepShare(idle, cluster)).toBeNull();
  });

  it('ranks it last and still counts it among the uids', () => {
    expect(byTime(info).map((uid) => uid.uid)).toEqual([0, 999, 992, 993, 65534]);
    expect(summarize(info)).toMatchObject({ uids: 5, clusters: 1, apps: 0 });
    expect(summarize(info).busiest?.uid).toBe(0);
  });

  /**
   * A ratio of almost nothing is noise: uid 993 has half a second to its name
   * and more than half of it at the top step, and means nothing by it.
   */
  it('keeps a row of half a second out of the top-step finding', () => {
    expect(topStepShare(uidFor(993), cluster)!).toBeGreaterThan(0.5);
    expect(uidFor(993).total).toBeLessThan(100);

    expect(heavyAtTopStep(info).map((use) => use.uid.uid)).toEqual([999]);
    // Without the floor it would lead the finding, ahead of the uid that means it.
    expect(heavyAtTopStep(info, TOP_STEP_HEAVY, 0).map((use) => use.uid.uid)).toEqual([993, 999]);
  });

  it('reads the uids of a machine Android names none of', () => {
    expect(identify(0)).toMatchObject({ kind: 'root' });
    for (const uid of [992, 993, 999, 65534]) {
      expect(identify(uid), String(uid)).toMatchObject({ kind: 'other', name: null });
    }
  });
});

describe('parseUidTimeInState — the counters just reset', () => {
  const info = parseUidTimeInState(fixture('just-reset'));

  it('reads the header with no uid under it', () => {
    expect(info.frequencies).toHaveLength(16);
    expect(info.clusters).toHaveLength(2);
    expect(info.uids).toEqual([]);
    expect(summarize(info)).toMatchObject({ uids: 0, total: 0, busiest: null });
  });
});

describe('parseUidTimeInState — what is not a file of this kind', () => {
  it('reads nothing out of an empty file', () => {
    expect(parseUidTimeInState('')).toEqual({ frequencies: [], clusters: [], uids: [] });
  });

  it('ignores a line that is neither the header nor a uid', () => {
    const info = parseUidTimeInState('uid: 300000 600000\nsomething else\n1000: 40 20\n');

    expect(info.uids).toHaveLength(1);
    expect(info.uids[0]!.uid).toBe(1000);
  });

  /** Every column is a position as well as a value, so a hole is not read past. */
  it('drops a line whose columns cannot all be read', () => {
    const info = parseUidTimeInState('uid: 300000 600000\n1000: 40 ?\n1001: 10 5\n');

    expect(info.uids.map((uid) => uid.uid)).toEqual([1001]);
  });
});

describe('splitClusters', () => {
  it('starts a cluster where the frequency stops climbing', () => {
    expect(splitClusters([300000, 600000, 900000, 400000, 800000]).map((c) => c.frequencies)).toEqual([
      [300000, 600000, 900000],
      [400000, 800000],
    ]);
  });

  /** Two policies with the same table print it twice, which is a step down. */
  it('splits a repeated table into the two policies that printed it', () => {
    expect(splitClusters([300000, 900000, 300000, 900000])).toHaveLength(2);
  });

  it('has nothing to split in an empty header', () => {
    expect(splitClusters([])).toEqual([]);
  });
});

describe('identify', () => {
  it('names root and the platform uids', () => {
    expect(identify(0)).toMatchObject({ kind: 'root', name: 'root' });
    expect(identify(1000)).toMatchObject({ kind: 'platform', name: 'system' });
    expect(identify(2000)).toMatchObject({ kind: 'platform', name: 'shell' });
  });

  it('names an app by the app id its uid carries', () => {
    expect(identify(10123)).toMatchObject({ kind: 'app', name: 'u0_a123', userId: 0, appId: 10123 });
  });

  it('names an isolated process of one', () => {
    expect(identify(90012)).toMatchObject({ kind: 'isolated', name: 'u0_i12' });
  });

  /** The whole layout is multiplied by the user: 1010045 is user 10's app 45. */
  it('reads the Android user out of the uid', () => {
    expect(identify(1010045)).toMatchObject({ kind: 'app', name: 'u10_a45', userId: 10 });
    expect(identify(1090008)).toMatchObject({ kind: 'isolated', name: 'u10_i8', userId: 10 });
    expect(identify(1001000)).toMatchObject({ kind: 'platform', name: 'u10_system' });
  });

  /** An ordinary Linux uid on a kernel with this file and no Android under it. */
  it('has no name for a uid outside every range', () => {
    expect(identify(5678)).toMatchObject({ kind: 'other', name: null, appId: 5678 });
  });
});

describe('formatting', () => {
  it('reads the counts as the clock ticks they are', () => {
    expect(ticksToSeconds(100)).toBe(1);
    expect(ticksToSeconds(210443)).toBeCloseTo(2104.43);
  });

  it('shows a duration at the units that say something', () => {
    expect(formatDuration(2.44)).toBe('2.44 s');
    expect(formatDuration(42.6)).toBe('43 s');
    expect(formatDuration(750)).toBe('12m 30s');
    expect(formatDuration(11052)).toBe('3h 4m');
    expect(formatDuration(180000)).toBe('2d 2h 0m');
  });

  it('shows a frequency from the kHz the file prints', () => {
    expect(formatFrequency(300000)).toBe('300 MHz');
    expect(formatFrequency(1785600)).toBe('1.79 GHz');
  });

  it('shows a share that is not quite nothing as more than nothing', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.004)).toBe('<1%');
    expect(formatShare(0.42)).toBe('42%');
    expect(formatShare(0.999)).toBe('100%');
  });
});
