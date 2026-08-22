import { useMemo } from 'react';
import {
  flagsOf,
  formatBytes,
  formatPermissions,
  formatTime,
  hasMemoryColumns,
  isOrphaned,
  isOverflowId,
  isPidVisible,
  isPrivate,
  isUntouched,
  keyHex,
  ownerChanged,
  parseShm,
  permissionsOf,
  sequenceOf,
  slotOf,
  summarize,
  TIMES,
  wasNeverAttached,
  type ShmSegment,
} from '../lib/sysvipc-shm';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** A number of bytes, or the dash a kernel that prints neither column earns. */
function Bytes({ value, title }: { value: number | null; title?: string }) {
  if (value === null) {
    return (
      <span className="muted" title="This kernel does not print rss or swap — see below">
        —
      </span>
    );
  }

  return value === 0 ? (
    <span className="muted" title={title}>
      0
    </span>
  ) : (
    <span title={title ?? `${value.toLocaleString('en-US')} bytes`}>{formatBytes(value)}</span>
  );
}

/**
 * A pid the kernel printed as 0, which is not pid 0: either nothing has
 * attached the segment yet, or the process is in a namespace this reader cannot
 * see into.
 */
function Pid({ pid, label, title }: { pid: number; label: string; title: string }) {
  return isPidVisible(pid) ? (
    <>{pid}</>
  ) : (
    <span className="muted" title={title}>
      {label}
    </span>
  );
}

/** The key, which is a bit pattern the kernel prints as a signed integer. */
function Key({ segment }: { segment: ShmSegment }) {
  if (isPrivate(segment)) {
    return (
      <span
        className="muted"
        title="IPC_PRIVATE: no key at all, so nothing can look it up — only a process inheriting the id can reach it"
      >
        private
      </span>
    );
  }

  return (
    <span
      title={
        segment.key < 0
          ? `Printed as ${segment.key}: key_t is signed, and this key has its top bit set`
          : `Printed as ${segment.key}`
      }
    >
      {keyHex(segment)}
    </span>
  );
}

function SegmentRow({ segment }: { segment: ShmSegment }) {
  const flags = flagsOf(segment);
  const orphaned = isOrphaned(segment);
  const untouched = isUntouched(segment);

  return (
    <tr className={orphaned ? 'shm__row shm__row--orphaned' : 'shm__row'}>
      <td className="shm__key">
        <Key segment={segment} />
      </td>

      <td className="shm__id" title={`Slot ${slotOf(segment)}, sequence ${sequenceOf(segment)}`}>
        {segment.shmid}
      </td>

      <td className="shm__perms">
        <span title={`${permissionsOf(segment).toString(8).padStart(3, '0')} — ${formatPermissions(segment)}`}>
          {segment.mode.toString(8)}
        </span>
        {flags.map((flag) => (
          <span key={flag.name} className="chip" title={flag.description}>
            {flag.name}
          </span>
        ))}
      </td>

      <td className="shm__number">
        <Bytes value={segment.size} title={`${segment.size.toLocaleString('en-US')} bytes asked for`} />
      </td>

      <td className="shm__number">
        <Bytes
          value={segment.rss}
          title={
            untouched === true
              ? 'Not a page of it exists: shared memory is allocated on first touch'
              : undefined
          }
        />
      </td>

      <td className="shm__number">
        <span className={segment.swap !== null && segment.swap > 0 ? 'shm__hit' : undefined}>
          <Bytes value={segment.swap} />
        </span>
      </td>

      <td className="shm__number">
        {segment.nattch === 0 ? (
          <span
            className={orphaned ? 'shm__hit' : 'muted'}
            title={
              orphaned
                ? 'Nothing is attached, and nothing is marked to remove it: it outlives every process that used it'
                : 'Nothing is attached, and it is already marked for destruction — so it is on its way out'
            }
          >
            0
          </span>
        ) : (
          <span title="Attachments, not processes: one process can attach the same segment twice">
            {segment.nattch}
          </span>
        )}
      </td>

      <td className="shm__pid">
        <Pid
          pid={segment.cpid}
          label="hidden"
          title="The creator is not visible in this pid namespace"
        />
      </td>

      <td className="shm__pid">
        {/* Two different silences: nothing has touched it, or whatever did is
            not visible from here. The times are what tell them apart. */}
        {wasNeverAttached(segment) && segment.dtime === 0 ? (
          <Pid pid={segment.lpid} label="never" title="Nothing has ever attached or detached it" />
        ) : (
          <Pid
            pid={segment.lpid}
            label="hidden"
            title="The last process to attach or detach it is not visible in this pid namespace"
          />
        )}
      </td>

      <td className="shm__owner">
        <span
          title={
            ownerChanged(segment)
              ? `Created by ${segment.cuid}:${segment.cgid}, handed on with shmctl(IPC_SET)`
              : 'The creator still owns it'
          }
        >
          {segment.uid}:{segment.gid}
        </span>
        {ownerChanged(segment) && (
          <span className="chip" title="The owner is no longer the creator">
            given away
          </span>
        )}
        {isOverflowId(segment.uid) && (
          <span className="chip" title="The overflow id: this owner has no mapping in the reader's user namespace">
            unmapped
          </span>
        )}
      </td>

      <td className="shm__time">
        <span
          title={[
            `${TIMES.atime}: ${formatTime(segment.atime) ?? 'never'}`,
            `${TIMES.dtime}: ${formatTime(segment.dtime) ?? 'never'}`,
            `${TIMES.ctime}: ${formatTime(segment.ctime) ?? 'never'}`,
          ].join('\n')}
        >
          {formatTime(segment.atime) ?? <span className="muted">never attached</span>}
        </span>
      </td>
    </tr>
  );
}

export function SysvipcShmView({ content }: { content: string }) {
  const info = useMemo(() => parseShm(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);
  const memory = hasMemoryColumns(info);

  /**
   * No shared memory at all, which is the ordinary answer on most machines
   * rather than a file that failed to say anything.
   */
  if (info.segments.length === 0) {
    return (
      <p className="notice" role="status">
        No System V shared memory on this machine — the file is its header and nothing else. That is
        ordinary: a segment exists only because something called <code>shmget</code>, and most of
        what shares memory now does it with <code>memfd_create</code> or a file under{' '}
        <code>/dev/shm</code> instead.
      </p>
    );
  }

  return (
    <>
      {summary.orphaned.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.orphaned.length === 1
            ? '1 segment has nothing attached to it'
            : `${summary.orphaned.length} segments have nothing attached to them`}{' '}
          and nothing marked to remove them
          {summary.orphanedBytes !== null && summary.orphanedBytes > 0 && (
            <>
              , holding <strong>{formatBytes(summary.orphanedBytes)}</strong>
            </>
          )}
          . A segment outlives every process that ever used it, so these last until{' '}
          <code>ipcrm</code>, a matching <code>shmctl(IPC_RMID)</code> or a reboot.
        </p>
      )}

      {summary.destroying.length > 0 && (
        <p className="notice" role="status">
          {summary.destroying.length === 1
            ? '1 segment is marked for destruction'
            : `${summary.destroying.length} segments are marked for destruction`}{' '}
          — the <code>dest</code> rows. Each has been removed already and goes on its last detach,
          which is how a program that means to share memory and not leak it does the job.
        </p>
      )}

      {!memory && (
        <p className="notice" role="status">
          This kernel prints fourteen columns rather than sixteen: <code>rss</code> and{' '}
          <code>swap</code> arrived in Linux 3.2, so what these segments actually hold is not in the
          file at all — which is not the same as their holding nothing.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="segments" value={String(summary.segments)} />
        <Stat
          label="asked for"
          value={formatBytes(summary.size)}
          title={`${summary.size.toLocaleString('en-US')} bytes of shmget requests`}
        />
        {summary.resident !== null && (
          <Stat
            label="resident"
            value={formatBytes(summary.resident)}
            title="What actually exists: pages are allocated on first touch"
          />
        )}
        {summary.swapped !== null && summary.swapped > 0 && (
          <Stat label="swapped" value={formatBytes(summary.swapped)} />
        )}
        <Stat
          label="attachments"
          value={String(summary.attachments)}
          title="Attachments across every segment, which is not a count of processes"
        />
      </section>

      <div className="card mounts">
        <table className="mounts__table shm__table" aria-label="Shared memory segments">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">shmid</th>
              <th scope="col">Perms</th>
              <th scope="col">Size</th>
              <th scope="col">Resident</th>
              <th scope="col">Swapped</th>
              <th scope="col">Attached</th>
              <th scope="col">Creator</th>
              <th scope="col">Last pid</th>
              <th scope="col">Owner</th>
              <th scope="col">Last attached</th>
            </tr>
          </thead>
          <tbody>
            {info.segments.map((segment) => (
              <SegmentRow key={segment.shmid} segment={segment} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        A segment lives until something removes it, not until the last process using it exits — so
        the column worth reading is <strong>Attached</strong>. Several fields read differently from
        how they look. <code>perms</code> is <strong>octal, and not only permissions</strong>: the
        bits above the mode are <code>SHM_*</code> flags, so <code>1600</code> is <code>0600</code>{' '}
        plus <code>SHM_DEST</code> — removed already, waiting for the last detach. The{' '}
        <strong>key is printed signed</strong>, because <code>key_t</code> is an <code>int</code>,
        so one written as a hex constant with its top bit set reads as a negative number; the hex
        above is the same bits. A key of <strong>0 is no key</strong> — <code>IPC_PRIVATE</code>,
        reachable only by inheriting the id. <code>shmid</code> is{' '}
        <strong>a sequence number above a slot</strong>, which is why two segments made back to back
        are 32,768 apart rather than 1, and why a stale id cannot name a new segment. And{' '}
        <strong>size is what was asked for, resident is what exists</strong>: pages arrive on first
        touch, so an 8 GiB segment can hold nothing at all, while 56 bytes still cost a whole page.
        Two smaller notes. A <strong>pid of 0 is not pid 0</strong> — the pids are printed in the
        namespace of whoever mounted this <code>/proc</code>, so a creator it cannot see has 0 where
        its pid goes, as does a segment nothing has attached yet; an owner outside the reader&rsquo;s
        user namespace reads as the overflow id, 65534, in the same way. And a{' '}
        <strong>time of 0 means never</strong> rather than 1970: <code>atime</code> is the last{' '}
        <code>shmat</code>, <code>dtime</code> the last <code>shmdt</code>, and <code>ctime</code>{' '}
        the last change — creation, or an <code>shmctl(IPC_SET)</code> since. The file itself is
        world-readable and scoped to one <strong>IPC namespace</strong>, so it shows the keys, sizes
        and pids of segments the reader has no permission to attach, and shows nothing of a
        namespace next door.
      </p>
    </>
  );
}
