/**
 * Parser for `/proc/uid_time_in_state`.
 *
 * A matrix of **CPU time per uid at each clock frequency**, written by
 * `drivers/cpufreq/cpufreq_times.c` and present only where
 * `CONFIG_CPU_FREQ_TIMES` is on — an Android kernel, in practice, which is
 * where the accounting it feeds lives. On a machine without it the file is not
 * there at all, and the page reports the 404 the backend gives it.
 *
 * The first line is the header, and every line after it is one uid:
 *
 *     uid: 300000 691200 1132800 1478400 633600 1113600 1651200 2016000
 *     0: 41028 3401 902 411 8022 1240 502 118
 *     1000: 15540 2210 640 288 3110 702 240 66
 *     10123: 2044 980 1204 3320 1180 902 1640 4260
 *
 * The header is `uid:` followed by **every frequency the machine can run at,
 * in kHz**, and each uid line is one clock-tick count per frequency in the same
 * order. The kernel writes the counts with `nsec_to_clock_t`, so they are in
 * ticks like the times in `/proc/stat` rather than in seconds — see
 * {@link CLOCK_TICK}.
 *
 * **The header is the frequency tables of every cpufreq policy, concatenated.**
 * The kernel walks the CPUs and prints each policy's table once, skipping the
 * CPUs that share one, so a big.LITTLE machine prints its little cluster's
 * steps and then its big cluster's — eight columns for four frequencies, in the
 * example above. Nothing in the file says where one ends and the next begins,
 * because nothing in the file is asked to: a reader that only sums has no need
 * to know. This module works it out anyway, since a mean frequency across two
 * different clusters is a number about nothing — see {@link splitClusters}.
 *
 * Two shapes are worth expecting, both of them normal:
 *
 *  - **A short line.** The kernel prints as many counts as that uid's table had
 *    entries when it was allocated, which for a uid first seen before a policy
 *    came up is fewer than the header has columns. The missing columns are time
 *    that was never accounted rather than zero time, and are left off the row
 *    rather than filled in.
 *  - **A uid seen nowhere else.** The file names the uids that have run, which
 *    on Android includes ones that no longer exist: an app's uid stays in the
 *    table until the accounting is reset by writing to the file.
 */

/** Clock ticks in a second: `sysconf(_SC_CLK_TCK)`, 100 on every Linux in practice. */
export const CLOCK_TICK = 100;

/**
 * What Android divides a uid by to get the user it belongs to — the `u10` of
 * `u10_a123`. A uid is that user times this, plus the app id below.
 */
export const USER_OFFSET = 100000;

/** `AID_APP_START`..`AID_APP_END`: the range an installed app's uid comes from. */
export const APP_ID_START = 10000;
export const APP_ID_END = 19999;

/** `AID_ISOLATED_START`..`AID_ISOLATED_END`: a sandboxed process of one of them. */
export const ISOLATED_ID_START = 90000;
export const ISOLATED_ID_END = 99999;

/**
 * The platform uids worth naming, from `android_filesystem_config.h`. Only the
 * ones that turn up here — a uid gets a line in this file by running, so the
 * ones that never do are left out.
 *
 * A uid this table has no name for is shown as the number it is: the file is a
 * kernel's, and a kernel with `CONFIG_CPU_FREQ_TIMES` on but no Android
 * userspace under it counts ordinary Linux uids, which none of these names fit.
 */
export const PLATFORM_UIDS = new Map<number, string>([
  [0, 'root'],
  [1000, 'system'],
  [1001, 'radio'],
  [1002, 'bluetooth'],
  [1003, 'graphics'],
  [1004, 'input'],
  [1005, 'audio'],
  [1006, 'camera'],
  [1007, 'log'],
  [1010, 'wifi'],
  [1013, 'media'],
  [1017, 'keystore'],
  [1019, 'drm'],
  [1021, 'gps'],
  [1023, 'media_rw'],
  [1027, 'nfc'],
  [1036, 'logd'],
  [1041, 'audioserver'],
  [1047, 'cameraserver'],
  [2000, 'shell'],
  [9999, 'nobody'],
]);

/**
 * One cpufreq policy's worth of the header: the frequencies a cluster of CPUs
 * shares, and where they sit in the row.
 */
export interface Cluster {
  /** 0-based, in the order the file prints them, which is CPU order. */
  index: number;
  /** Column of this cluster's first frequency, into {@link UidTimes.times}. */
  offset: number;
  /** The policy's frequency table in kHz, ascending, as the kernel prints it. */
  frequencies: number[];
}

/** One line of the file: a uid, and what it spent at each frequency. */
export interface UidTimes {
  uid: number;
  /**
   * Clock ticks at each frequency of the header, in the same order. Shorter
   * than the header where the kernel printed fewer — see the note above.
   */
  times: number[];
  /** Those ticks summed, which is the uid's CPU time at every frequency. */
  total: number;
}

export interface UidTimeInState {
  /** The header, in kHz: every frequency, of every cluster, in file order. */
  frequencies: number[];
  /** The same frequencies, split back into the policies they came from. */
  clusters: Cluster[];
  uids: UidTimes[];
}

/** `uid: 300000 691200 …` — the header, which is the one line naming no uid. */
const HEADER = /^uid:(.*)$/;

/** `10123: 2044 980 …` — every other line. */
const ROW = /^(\d+):(.*)$/;

/**
 * The numbers after the colon, or null if any of them is not one — a line whose
 * columns cannot all be read is dropped rather than read with a hole in it,
 * since every column here is a position as well as a value.
 */
function numbers(rest: string): number[] | null {
  const trimmed = rest.trim();
  if (trimmed === '') return [];

  const values = trimmed.split(/\s+/).map(Number);
  return values.every((value) => Number.isFinite(value)) ? values : null;
}

export function parseUidTimeInState(text: string): UidTimeInState {
  let frequencies: number[] = [];
  const uids: UidTimes[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const header = HEADER.exec(line);
    if (header !== null) {
      frequencies = numbers(header[1]!) ?? frequencies;
      continue;
    }

    const row = ROW.exec(line);
    if (row === null) continue;

    const times = numbers(row[2]!);
    if (times === null) continue;

    uids.push({
      uid: Number(row[1]),
      times,
      total: times.reduce((sum, ticks) => sum + ticks, 0),
    });
  }

  return { frequencies, clusters: splitClusters(frequencies), uids };
}

/**
 * The header split back into the policies it was made of.
 *
 * A policy's table is printed **ascending**, and each one starts again at that
 * cluster's lowest step, so a frequency no higher than the one before it is
 * where the next cluster starts. That is a reading of the numbers rather than
 * something the file states, and it is wrong in exactly one case: two clusters
 * whose tables are one frequency each, ascending across the pair. A machine
 * like that has nothing to say about frequency anyway, since neither cluster
 * ever changes speed.
 */
export function splitClusters(frequencies: number[]): Cluster[] {
  const clusters: Cluster[] = [];

  frequencies.forEach((frequency, column) => {
    const current = clusters[clusters.length - 1];

    if (current === undefined || frequency <= current.frequencies[current.frequencies.length - 1]!) {
      clusters.push({ index: clusters.length, offset: column, frequencies: [frequency] });
    } else {
      current.frequencies.push(frequency);
    }
  });

  return clusters;
}

/** The columns of one cluster, which is fewer than its frequencies on a short row. */
export function clusterTimes(uid: UidTimes, cluster: Cluster): number[] {
  return uid.times.slice(cluster.offset, cluster.offset + cluster.frequencies.length);
}

/** What a uid spent on one cluster, in ticks. */
export function clusterTotal(uid: UidTimes, cluster: Cluster): number {
  return clusterTimes(uid, cluster).reduce((sum, ticks) => sum + ticks, 0);
}

/**
 * The frequency a uid ran at on one cluster on average, in kHz, weighted by the
 * time spent at each step — null when it never ran there, which is a mean of
 * nothing rather than a zero.
 *
 * Per cluster because the frequencies of two clusters are not comparable: a
 * mean over both would sit between a little core's steps and a big one's and
 * describe neither.
 */
export function meanFrequency(uid: UidTimes, cluster: Cluster): number | null {
  const times = clusterTimes(uid, cluster);
  const total = times.reduce((sum, ticks) => sum + ticks, 0);
  if (total === 0) return null;

  const weighted = times.reduce(
    (sum, ticks, step) => sum + ticks * cluster.frequencies[step]!,
    0,
  );
  return weighted / total;
}

/**
 * Share of a uid's time on a cluster spent at that cluster's **top step**, from
 * 0 to 1 — null where it never ran there.
 *
 * The step that costs the most for what it delivers, since power goes up faster
 * than clock does. It is what a battery question asks of this file.
 */
export function topStepShare(uid: UidTimes, cluster: Cluster): number | null {
  const times = clusterTimes(uid, cluster);
  const total = times.reduce((sum, ticks) => sum + ticks, 0);
  if (total === 0) return null;

  // A short row may stop before the top step, which is time never accounted
  // there rather than time at it.
  return (times[cluster.frequencies.length - 1] ?? 0) / total;
}

/**
 * Share of a cluster's time at its top step past which the page says so.
 *
 * There is no kernel threshold here to borrow — nothing fails at any level, and
 * the file is not a limit. It is the point at which the number is worth a
 * reader's attention, since a quarter of a uid's time at the step that costs
 * the most is a battery answer.
 */
export const TOP_STEP_HEAVY = 0.25;

/**
 * CPU time a uid needs on a cluster before its share of the top step is worth
 * reporting at all: one second, in ticks.
 *
 * A share is a ratio, and a ratio of almost nothing is noise — a service uid
 * with half a second to its name can sit at 54% of the top step and mean
 * nothing by it, while the uid that actually ran the battery down is at 30% of
 * hours. Without a floor the notice would be led by the smallest rows in the
 * file.
 */
export const HEAVY_MINIMUM = 100;

/** A uid sitting at one cluster's top step for more of its time than most. */
export interface TopStepUse {
  uid: UidTimes;
  cluster: Cluster;
  share: number;
}

/**
 * The uids spending at least `threshold` of their time on some cluster at that
 * cluster's top step, worst first — and enough time there for the share to be
 * about something, see {@link HEAVY_MINIMUM}.
 *
 * **A cluster with one step is left out**, since a uid that runs there at all
 * spends every tick at the top of it: the number would be 100% for everybody
 * and would say nothing about any of them.
 */
export function heavyAtTopStep(
  info: UidTimeInState,
  threshold = TOP_STEP_HEAVY,
  minimum = HEAVY_MINIMUM,
): TopStepUse[] {
  const heavy: TopStepUse[] = [];

  for (const cluster of info.clusters) {
    if (cluster.frequencies.length < 2) continue;

    for (const uid of info.uids) {
      if (clusterTotal(uid, cluster) < minimum) continue;

      const share = topStepShare(uid, cluster);
      if (share !== null && share >= threshold) heavy.push({ uid, cluster, share });
    }
  }

  return heavy.sort((a, b) => b.share - a.share || a.uid.uid - b.uid.uid);
}

/** Whether the kernel printed fewer columns for this uid than the header has. */
export function isShortRow(uid: UidTimes, info: UidTimeInState): boolean {
  return uid.times.length < info.frequencies.length;
}

export type UidKind = 'root' | 'platform' | 'app' | 'isolated' | 'other';

export interface UidIdentity {
  kind: UidKind;
  /** Android's own name for it — `system`, `u0_a123` — or null where it has none. */
  name: string | null;
  /** The Android user it belongs to: the `10` of `u10_a123`. */
  userId: number;
  /** The uid within that user, which is what the ranges are about. */
  appId: number;
}

/**
 * Who a uid is, as far as the number itself says.
 *
 * Android carves the uid space up by range — apps from 10000, their isolated
 * processes from 90000, the platform's own below 10000 — and multiplies the
 * whole layout by the user, so uid 1010123 is user 10's copy of app 123. The
 * name that comes back is the one `ps` would print for it.
 *
 * A uid outside every range is `other` with no name: an ordinary Linux uid on a
 * kernel that has this file without Android under it, and nothing here pretends
 * to know more about it than the number.
 */
export function identify(uid: number): UidIdentity {
  const userId = Math.floor(uid / USER_OFFSET);
  const appId = uid % USER_OFFSET;
  // `system` in user 0, `u10_system` in user 10 — the prefix is what says which.
  const named = (name: string) => (userId === 0 ? name : `u${userId}_${name}`);

  if (uid === 0) return { kind: 'root', name: 'root', userId, appId };

  const platform = PLATFORM_UIDS.get(appId);
  if (platform !== undefined) return { kind: 'platform', name: named(platform), userId, appId };

  if (appId >= APP_ID_START && appId <= APP_ID_END) {
    return { kind: 'app', name: `u${userId}_a${appId - APP_ID_START}`, userId, appId };
  }

  if (appId >= ISOLATED_ID_START && appId <= ISOLATED_ID_END) {
    return { kind: 'isolated', name: `u${userId}_i${appId - ISOLATED_ID_START}`, userId, appId };
  }

  return { kind: 'other', name: null, userId, appId };
}

/** The uids by CPU time, most first, which is the order the page shows them in. */
export function byTime(info: UidTimeInState): UidTimes[] {
  return [...info.uids].sort((a, b) => b.total - a.total || a.uid - b.uid);
}

export interface UidTimeInStateSummary {
  uids: number;
  clusters: number;
  /** Ticks summed over every uid and every frequency. */
  total: number;
  /** The uid that has had the most CPU, or null where the file names none. */
  busiest: UidTimes | null;
  /** How many of the uids are installed apps rather than the platform's own. */
  apps: number;
}

export function summarize(info: UidTimeInState): UidTimeInStateSummary {
  return {
    uids: info.uids.length,
    clusters: info.clusters.length,
    total: info.uids.reduce((sum, uid) => sum + uid.total, 0),
    busiest: byTime(info)[0] ?? null,
    apps: info.uids.filter((uid) => identify(uid.uid).kind === 'app').length,
  };
}

/** Ticks as seconds, which is what the counts mean. */
export function ticksToSeconds(ticks: number): number {
  return ticks / CLOCK_TICK;
}

/** `2.44 s`, `12m 30s`, `3h 4m` — a duration at the units that say something. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 0)} s`;

  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${whole % 60}s`;
}

/** `1.71 GHz`, `300 MHz` — a frequency from the kHz the file prints. */
export function formatFrequency(kHz: number): string {
  return kHz >= 1e6 ? `${(kHz / 1e6).toFixed(2)} GHz` : `${Math.round(kHz / 1000)} MHz`;
}

/** `94%`, and `<1%` for a share that is not quite nothing. */
export function formatShare(value: number): string {
  if (value === 0) return '0%';
  if (value >= 0.995) return '100%';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
