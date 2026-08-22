/**
 * Parser for `/proc/uid_io/stats`.
 *
 * Per-uid I/O accounting from Android's `uid_sys_stats` driver — the same
 * family as `/proc/uid_time_in_state`, which is why the uids here are read with
 * that module's {@link identifyUid}: one uid layout, written down once.
 * A stock Linux has no such file, and the page reports the 404 the backend
 * gives it.
 *
 * No header, and eleven numbers a line:
 *
 *     0 5718673068 1653128701 832693248 104251392 0 0 0 0 866 0
 *     993 970510 1652 647168 0 0 0 0 0 0 0
 *
 * The first is the uid. **The ten after it are not two symmetric groups of
 * five**: they are four counters for the uid's *foreground* time, the same four
 * for its *background* time, and then the two `fsync` counts — foreground's and
 * background's — pushed to the end, away from the groups they belong to. A
 * reader taking the line as five and five has every background counter shifted
 * by one, which is the one thing this file gets misread as.
 *
 * The four in each group are the two pairs of `task_io_accounting`, and the
 * difference between the pairs is the whole point of the file:
 *
 *  - **`rchar` and `wchar` are bytes that went through `read()` and `write()`**
 *    — every one of them, whether it came from a disk, the page cache, a pipe,
 *    a socket or a tty.
 *  - **`read_bytes` and `write_bytes` are bytes the block layer actually
 *    moved**, which is why they come in multiples of 512 and why they can be
 *    far smaller: a file already in the page cache is read with no disk in it
 *    at all. See {@link withoutDisk}.
 *
 * Two things follow that look like errors and are not. `write_bytes` can be
 * **behind** `wchar` indefinitely, since a write is counted here when it
 * reaches the block layer rather than when the program made it, and dirty pages
 * are written back on the kernel's schedule. And `read_bytes` can be **larger**
 * than `rchar`, because readahead fetches what the program has not asked for
 * and may never ask for — see {@link overRead}, which is what a uid reading a
 * little of a lot of files looks like.
 *
 * Foreground and background are Android's notion, not the kernel's: userspace
 * tells the driver which state a uid is in, and the counters that were running
 * at the time are the ones that moved. A uid with nothing in its background
 * columns has never been accounted there rather than having been idle.
 */
import { identify, type UidIdentity } from './uid_time_in_state';

/** Android's uid layout, which this file's uids share with `uid_time_in_state`. */
export function identifyUid(uid: number): UidIdentity {
  return identify(uid);
}

/** What the block layer counts in, which is why those two columns are round. */
export const SECTOR_SIZE = 512;

/** One state's counters: the four of `task_io_accounting`, and its `fsync`s. */
export interface UidIo {
  /** Bytes through `read()`, wherever they came from. */
  rchar: number;
  /** Bytes through `write()`, wherever they went. */
  wchar: number;
  /** Of those reads, the bytes the block layer actually fetched. */
  readBytes: number;
  /** And the bytes it has actually written back so far. */
  writeBytes: number;
  /** `fsync()` calls, which is a count rather than a size. */
  fsync: number;
}

export interface UidIoStats {
  uid: number;
  foreground: UidIo;
  background: UidIo;
}

export interface UidIoInfo {
  uids: UidIoStats[];
}

/** Eleven numbers, and nothing else on the line. */
const ROW = /^\s*(\d+)((?:\s+\d+){10})\s*$/;

export function parseUidIoStats(text: string): UidIoInfo {
  const uids: UidIoStats[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const row = ROW.exec(line);
    if (row === null) continue;

    const [
      rchar,
      wchar,
      readBytes,
      writeBytes,
      bgRchar,
      bgWchar,
      bgReadBytes,
      bgWriteBytes,
      fsync,
      bgFsync,
    ] = row[2]!.trim().split(/\s+/).map(Number) as number[];

    uids.push({
      uid: Number(row[1]),
      // The two fsync counts are the last columns rather than the fifth of each
      // group, so each is picked out of the tail rather than read in order.
      foreground: { rchar: rchar!, wchar: wchar!, readBytes: readBytes!, writeBytes: writeBytes!, fsync: fsync! },
      background: {
        rchar: bgRchar!,
        wchar: bgWchar!,
        readBytes: bgReadBytes!,
        writeBytes: bgWriteBytes!,
        fsync: bgFsync!,
      },
    });
  }

  return { uids };
}

/** The two states summed, which is everything a uid has done. */
export function total(entry: UidIoStats): UidIo {
  const { foreground: fg, background: bg } = entry;

  return {
    rchar: fg.rchar + bg.rchar,
    wchar: fg.wchar + bg.wchar,
    readBytes: fg.readBytes + bg.readBytes,
    writeBytes: fg.writeBytes + bg.writeBytes,
    fsync: fg.fsync + bg.fsync,
  };
}

/** Bytes through the read and write calls, which is the larger pair. */
export function charTotal(io: UidIo): number {
  return io.rchar + io.wchar;
}

/** Bytes the block layer moved, which is the pair a disk would notice. */
export function blockTotal(io: UidIo): number {
  return io.readBytes + io.writeBytes;
}

/**
 * Bytes read without the disk being touched: what the program asked for, less
 * what the block layer fetched.
 *
 * The page cache, mostly — and pipes, sockets, ttys and `/proc` itself, none of
 * which have a disk behind them. **Negative where readahead fetched more than
 * the program ever asked for**, which is a real state rather than a parse
 * error; {@link overRead} is the same fact the other way up.
 */
export function withoutDisk(io: UidIo): number {
  return io.rchar - io.readBytes;
}

/** Whether the block layer fetched more for this uid than it asked for. */
export function overRead(io: UidIo): boolean {
  return io.readBytes > io.rchar;
}

/**
 * Bytes written that the block layer has not moved yet: dirty pages, waiting
 * on writeback. Never negative — a write reaches the block layer after the call
 * that made it, not before.
 */
export function notYetWritten(io: UidIo): number {
  return Math.max(0, io.wchar - io.writeBytes);
}

/** Whether either block counter is not a whole number of sectors. */
export function isUnaligned(io: UidIo): boolean {
  return io.readBytes % SECTOR_SIZE !== 0 || io.writeBytes % SECTOR_SIZE !== 0;
}

/** Whether a uid has never been accounted in the background state at all. */
export function foregroundOnly(entry: UidIoStats): boolean {
  return charTotal(entry.background) === 0 && blockTotal(entry.background) === 0;
}

/** A uid's share of its traffic done in the foreground, or null with none. */
export function foregroundShare(entry: UidIoStats): number | null {
  const all = charTotal(total(entry));
  return all === 0 ? null : charTotal(entry.foreground) / all;
}

/** The uids by everything they have read and written, busiest first. */
export function byTraffic(info: UidIoInfo): UidIoStats[] {
  return [...info.uids].sort(
    (a, b) => charTotal(total(b)) - charTotal(total(a)) || a.uid - b.uid,
  );
}

/** The uids the block layer fetched more for than they asked for, worst first. */
export function overReading(info: UidIoInfo): UidIoStats[] {
  return info.uids
    .filter((entry) => overRead(total(entry)))
    .sort((a, b) => withoutDisk(total(a)) - withoutDisk(total(b)) || a.uid - b.uid);
}

export interface UidIoSummary {
  uids: number;
  /** Bytes through the read and write calls, over every uid. */
  chars: number;
  /** Bytes the block layer moved, over every uid. */
  block: number;
  /** `fsync()` calls over every uid, in both states. */
  fsyncs: number;
  /** Uids never accounted in the background state. */
  foregroundOnly: number;
  /** The uid that has read and written the most, or null where there are none. */
  busiest: UidIoStats | null;
}

export function summarize(info: UidIoInfo): UidIoSummary {
  const totals = info.uids.map(total);

  return {
    uids: info.uids.length,
    chars: totals.reduce((sum, io) => sum + charTotal(io), 0),
    block: totals.reduce((sum, io) => sum + blockTotal(io), 0),
    fsyncs: totals.reduce((sum, io) => sum + io.fsync, 0),
    foregroundOnly: info.uids.filter(foregroundOnly).length,
    busiest: byTraffic(info)[0] ?? null,
  };
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** Binary units, since these are bytes of memory and disk rather than a capacity. */
export function formatBytes(value: number): string {
  const size = Math.abs(value);
  if (size === 0) return '0 B';

  let scaled = size;
  let unit = 0;
  while (scaled >= 1024 && unit < UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }

  const sign = value < 0 ? '-' : '';
  return `${sign}${scaled.toFixed(scaled < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}

/** `4,361` — fsync counts run from none to a few thousand. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** `94%`, and `<1%` for a share that is not quite nothing. */
export function formatShare(value: number): string {
  if (value === 0) return '0%';
  if (value >= 0.995) return '100%';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
