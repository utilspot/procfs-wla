import { useMemo } from 'react';
import {
  byTraffic,
  foregroundOnly,
  foregroundShare,
  formatBytes,
  formatCount,
  formatShare,
  identifyUid,
  notYetWritten,
  overRead,
  overReading,
  parseUidIoStats,
  summarize,
  total,
  type UidIoStats,
} from '../lib/uid_io-stats';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** What to call a uid: Android's name for it, or the number and nothing more. */
function UidName({ uid }: { uid: number }) {
  const who = identifyUid(uid);

  return (
    <>
      {uid}
      {who.name !== null && (
        <span className="chip" title={`Android calls this uid ${who.name}`}>
          {who.name}
        </span>
      )}
    </>
  );
}

/**
 * One direction of a uid's traffic: what went through the calls, and what the
 * block layer moved for it underneath — the pair being the point of the file.
 */
function Traffic({
  chars,
  block,
  label,
  note,
}: {
  chars: number;
  block: number;
  label: string;
  note: string;
}) {
  return (
    <>
      {formatBytes(chars)}
      <span className="uidio__block" title={note}>
        {formatBytes(block)} {label}
      </span>
    </>
  );
}

/** Where a uid did its work, as the split between the two states. */
function States({ entry }: { entry: UidIoStats }) {
  const share = foregroundShare(entry);

  if (share === null) {
    return (
      <span className="muted" title="Nothing has gone through this uid’s read or write calls">
        —
      </span>
    );
  }

  if (foregroundOnly(entry)) {
    return (
      <span className="chip" title="Never accounted in the background state at all">
        foreground only
      </span>
    );
  }

  return (
    <div className="uidio__states">
      <span
        className="uidio__bar"
        title={`${formatShare(share)} foreground, ${formatShare(1 - share)} background`}
      >
        <span className="uidio__segment" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="uidio__figures">{formatShare(share)} fg</span>
    </div>
  );
}

function UidRow({ entry }: { entry: UidIoStats }) {
  const io = total(entry);

  return (
    <tr className="uidio__row">
      <td className="uidio__uid">
        <UidName uid={entry.uid} />
      </td>
      <td className="uidio__number">
        <Traffic
          chars={io.rchar}
          block={io.readBytes}
          label="off disk"
          note={`Fetched by the block layer${overRead(io) ? ' — more than this uid asked for' : ''}`}
        />
      </td>
      <td className="uidio__number">
        <Traffic
          chars={io.wchar}
          block={io.writeBytes}
          label="to disk"
          note={`Written back so far, leaving ${formatBytes(notYetWritten(io))} still dirty`}
        />
      </td>
      <td className="uidio__number">
        {io.fsync === 0 ? <span className="muted">—</span> : formatCount(io.fsync)}
      </td>
      <td className="uidio__states-cell">
        <States entry={entry} />
      </td>
    </tr>
  );
}

export function UidIoStatsView({ content }: { content: string }) {
  const info = useMemo(() => parseUidIoStats(content), [content]);
  const ranked = useMemo(() => byTraffic(info), [info]);
  const summary = useMemo(() => summarize(info), [info]);
  const overreading = useMemo(() => overReading(info), [info]);

  if (info.uids.length === 0) {
    return (
      <p className="notice notice--warn">
        No uid in this file. It is written a line at a time as uids do I/O, so an empty one is a
        driver that has accounted nothing yet — switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  return (
    <>
      {overreading.length > 0 && (
        <p className="notice" role="status">
          {overreading.slice(0, 3).map((entry) => {
            const io = total(entry);
            return (
              <span key={entry.uid}>
                {identifyUid(entry.uid).name ?? `uid ${entry.uid}`} read{' '}
                {formatBytes(io.rchar)} and the block layer fetched {formatBytes(io.readBytes)} for
                it.{' '}
              </span>
            );
          })}
          Readahead fetches what a program has not asked for and may never ask for, so the disk
          being read harder than the uid read is ordinary — for a uid opening a little of a lot of
          files, it is the shape to expect.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="uids" value={String(summary.uids)} />
        <Stat label="through read and write" value={formatBytes(summary.chars)} />
        <Stat label="moved by the block layer" value={formatBytes(summary.block)} />
        <Stat label="fsyncs" value={formatCount(summary.fsyncs)} />
        {summary.busiest !== null && (
          <Stat
            label="busiest"
            value={identifyUid(summary.busiest.uid).name ?? `uid ${summary.busiest.uid}`}
          />
        )}
      </section>

      <div className="card mounts">
        <table className="mounts__table uidio__table" aria-label="I/O per uid">
          <thead>
            <tr>
              <th scope="col">uid</th>
              <th scope="col">Read</th>
              <th scope="col">Written</th>
              <th scope="col">fsync</th>
              <th scope="col">Where</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((entry) => (
              <UidRow key={entry.uid} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        Eleven numbers a line, and <strong>they are not two groups of five</strong>: four counters
        for the uid&rsquo;s foreground time, the same four for its background time, and then the
        two <code>fsync</code> counts — one per state — pushed to the end away from the groups they
        belong to. Within a group, <code>rchar</code> and <code>wchar</code> are bytes that went
        through <code>read()</code> and <code>write()</code> whatever was behind them — a disk, the
        page cache, a pipe, a tty — while <code>read_bytes</code> and <code>write_bytes</code> are
        what the block layer actually moved, which is why they come in whole 512-byte sectors and
        are usually the smaller pair. The gap in each direction means something different: bytes
        read without the disk being touched came out of the page cache, and bytes written that the
        disk has not seen are dirty pages waiting on writeback — a write is counted here when it
        reaches the block layer rather than when the program made it. Foreground and background are
        Android&rsquo;s notion rather than the kernel&rsquo;s, set from userspace, so a uid with
        nothing in its background columns has never been accounted there rather than having been
        idle. The file is that driver&rsquo;s: a machine without it has no{' '}
        <code>/proc/uid_io/stats</code> to read.
      </p>
    </>
  );
}
