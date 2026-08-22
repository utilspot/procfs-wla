import { describe, expect, it } from 'vitest';
import { readUidIoStatsFixture as fixture } from '../test/fixtures';
import {
  blockTotal,
  byTraffic,
  charTotal,
  foregroundOnly,
  foregroundShare,
  formatBytes,
  formatCount,
  formatShare,
  identifyUid,
  isUnaligned,
  notYetWritten,
  overRead,
  overReading,
  parseUidIoStats,
  SECTOR_SIZE,
  summarize,
  total,
  withoutDisk,
} from './uid_io-stats';

describe('parseUidIoStats — the capture the machine serves', () => {
  const info = parseUidIoStats(fixture('raspberry-pi'));
  const uidFor = (uid: number) => info.uids.find((entry) => entry.uid === uid)!;

  /**
   * The two fsync counts are the last two columns rather than the fifth of each
   * group, so a reader taking the line as five and five has every background
   * counter shifted by one.
   */
  it('reads the line as four, four and the two fsyncs at the end', () => {
    expect(uidFor(0).foreground).toEqual({
      rchar: 5718673068,
      wchar: 1653128701,
      readBytes: 832693248,
      writeBytes: 104251392,
      fsync: 866,
    });
    expect(uidFor(0).background).toEqual({
      rchar: 0,
      wchar: 0,
      readBytes: 0,
      writeBytes: 0,
      fsync: 0,
    });
  });

  it('reads a uid per line', () => {
    expect(info.uids.map((entry) => entry.uid)).toEqual([0, 993, 65534, 992]);
  });

  /** rchar counts what the program asked for; read_bytes what the disk moved. */
  it('tells bytes through the calls from bytes off the disk', () => {
    const root = total(uidFor(0));

    expect(charTotal(root)).toBe(5718673068 + 1653128701);
    expect(blockTotal(root)).toBe(832693248 + 104251392);
    expect(withoutDisk(root)).toBe(5718673068 - 832693248);
  });

  /**
   * Readahead fetches what the program has not asked for, so the disk can be
   * read harder than the program ever read.
   */
  it('reports a uid the block layer fetched more for than it asked for', () => {
    const small = total(uidFor(992));

    expect(overRead(small)).toBe(true);
    expect(withoutDisk(small)).toBe(24228 - 94208);
    expect(overReading(info).map((entry) => entry.uid)).toEqual([992]);
    expect(overRead(total(uidFor(0)))).toBe(false);
  });

  /** A write is counted when it reaches the block layer, not when it is made. */
  it('reports the writes the block layer has not moved yet', () => {
    expect(notYetWritten(total(uidFor(0)))).toBe(1653128701 - 104251392);
    // 1652 bytes written and nothing on the disk for it at all.
    expect(notYetWritten(total(uidFor(993)))).toBe(1652);
  });

  it('reads every block counter as the whole sectors they come in', () => {
    expect(SECTOR_SIZE).toBe(512);
    for (const entry of info.uids) {
      expect(isUnaligned(entry.foreground), String(entry.uid)).toBe(false);
      expect(isUnaligned(entry.background), String(entry.uid)).toBe(false);
    }
  });

  /** Nothing here has been accounted in the background state at all. */
  it('tells a uid never accounted in the background from an idle one', () => {
    expect(info.uids.every(foregroundOnly)).toBe(true);
    expect(foregroundShare(uidFor(0))).toBe(1);
  });

  it('ranks the uids by everything they have read and written', () => {
    expect(byTraffic(info).map((entry) => entry.uid)).toEqual([0, 65534, 993, 992]);
  });

  it('summarizes the uids and what they moved', () => {
    expect(summarize(info)).toMatchObject({ uids: 4, foregroundOnly: 4, fsyncs: 866 + 4361 });
    expect(summarize(info).busiest?.uid).toBe(0);
    expect(summarize(info).chars).toBe(
      info.uids.reduce((sum, entry) => sum + charTotal(total(entry)), 0),
    );
  });

  /** The same uid layout as `uid_time_in_state`, since it is the same driver family. */
  it('reads the uids the way the other per-uid file does', () => {
    expect(identifyUid(0)).toMatchObject({ kind: 'root' });
    expect(identifyUid(65534)).toMatchObject({ kind: 'other', name: null });
  });
});

describe('parseUidIoStats — an app working in the background', () => {
  const info = parseUidIoStats(fixture('background-heavy'));
  const uidFor = (uid: number) => info.uids.find((entry) => entry.uid === uid)!;

  it('keeps the two states apart', () => {
    const app = uidFor(10123);

    expect(app.foreground.rchar).toBe(83886080);
    expect(app.background.rchar).toBe(1677721600);
    expect(foregroundOnly(app)).toBe(false);
    expect(foregroundShare(app)!).toBeLessThan(0.1);
  });

  it('sums the two into what the uid has done altogether', () => {
    const app = total(uidFor(10123));

    expect(app.rchar).toBe(83886080 + 1677721600);
    expect(app.fsync).toBe(88 + 402);
  });

  it('names an app uid the way Android does', () => {
    expect(identifyUid(10123)).toMatchObject({ kind: 'app', name: 'u0_a123' });
    expect(identifyUid(90012)).toMatchObject({ kind: 'isolated', name: 'u0_i12' });
  });

  it('counts only the uids that have never been in the background', () => {
    expect(summarize(info)).toMatchObject({ uids: 4, foregroundOnly: 0 });
  });
});

describe('parseUidIoStats — nothing that reached a disk', () => {
  const info = parseUidIoStats(fixture('cache-only'));

  it('reads traffic with every block counter at zero', () => {
    for (const entry of info.uids) {
      expect(blockTotal(total(entry)), String(entry.uid)).toBe(0);
      expect(charTotal(total(entry)), String(entry.uid)).toBeGreaterThan(0);
      expect(overRead(total(entry)), String(entry.uid)).toBe(false);
    }
    expect(summarize(info).block).toBe(0);
  });

  it('counts every byte read as one the disk was not touched for', () => {
    const system = info.uids.find((entry) => entry.uid === 1000)!;

    expect(withoutDisk(total(system))).toBe(209715200 + 12582912);
  });
});

describe('parseUidIoStats — what is not a file of this kind', () => {
  it('reads nothing out of an empty file', () => {
    expect(parseUidIoStats(fixture('empty'))).toEqual({ uids: [] });
    expect(summarize(parseUidIoStats(''))).toMatchObject({ uids: 0, busiest: null });
  });

  /** Eleven numbers or nothing: a line a column short is not read short. */
  it('drops a line that is not eleven numbers', () => {
    const info = parseUidIoStats('0 1 2 3 4 5 6 7 8 9\n1 1 2 3 4 5 6 7 8 9 10\n');

    expect(info.uids.map((entry) => entry.uid)).toEqual([1]);
  });

  it('drops a line with something that is not a number in it', () => {
    const info = parseUidIoStats('0 1 2 3 4 5 6 7 8 9 x\n1 1 2 3 4 5 6 7 8 9 10\n');

    expect(info.uids.map((entry) => entry.uid)).toEqual([1]);
  });

  it('ignores a line that is not a row at all', () => {
    const info = parseUidIoStats('uid_io stats\n1 1 2 3 4 5 6 7 8 9 10\n');

    expect(info.uids).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('shows a size in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(94208)).toBe('92 KiB');
    expect(formatBytes(5718673068)).toBe('5.3 GiB');
  });

  /** Readahead can put the disk ahead of the program, which is a negative. */
  it('shows a negative size as one', () => {
    expect(formatBytes(24228 - 94208)).toBe('-68 KiB');
  });

  it('shows an fsync count as a count', () => {
    expect(formatCount(4361)).toBe('4,361');
    expect(formatShare(0.5)).toBe('50%');
    expect(formatShare(0.004)).toBe('<1%');
  });
});
