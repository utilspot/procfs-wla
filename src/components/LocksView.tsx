import { useMemo } from 'react';
import {
  describeKind,
  fileOf,
  isLease,
  isOwnedByProcess,
  isWholeFile,
  lengthOf,
  parseLocks,
  summarize,
  type FileLock,
} from '../lib/locks';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The byte range, written the way it reads rather than as two numbers. */
function Range({ lock }: { lock: FileLock }) {
  const length = lengthOf(lock);

  if (isWholeFile(lock)) {
    return (
      <span className="muted" title="From byte 0 to the end, however the file grows">
        whole file
      </span>
    );
  }

  return (
    <span
      title={
        length === null
          ? `From byte ${lock.start.toLocaleString()} to the end of the file`
          : `${length.toLocaleString()} byte${length === 1 ? '' : 's'}, both ends included`
      }
    >
      {lock.start.toLocaleString()}–{lock.end === null ? 'EOF' : lock.end.toLocaleString()}
    </span>
  );
}

function LockRow({ lock }: { lock: FileLock }) {
  const described = describeKind(lock.kind);
  const file = fileOf(lock);

  return (
    <tr className={lock.waiting ? 'locks__row locks__row--waiting' : 'locks__row'}>
      <td className="locks__id">
        {lock.waiting ? (
          <span title={`Queued behind lock ${lock.id}`}>↳ {lock.id}</span>
        ) : (
          lock.id
        )}
      </td>
      <td className="locks__kind">
        <span className="chip" title={described ?? 'A kind this page has no note for'}>
          {lock.kind}
        </span>
      </td>
      <td className="locks__state">
        {isLease(lock) ? (
          <span className="chip" title="The state of the lease, not an enforcement">
            {lock.enforcement}
          </span>
        ) : (
          <span className="muted">{lock.enforcement}</span>
        )}
      </td>
      <td className="locks__access">{lock.access}</td>
      <td className="locks__range">
        <Range lock={lock} />
      </td>
      <td className="locks__file">
        {file === null ? <span className="muted">—</span> : file}
      </td>
      <td className="locks__pid">
        {isOwnedByProcess(lock) ? (
          lock.pid
        ) : (
          <span className="muted" title="No process owns it: the open file description does">
            none
          </span>
        )}
      </td>
    </tr>
  );
}

export function LocksView({ content }: { content: string }) {
  const info = useMemo(() => parseLocks(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  /**
   * Nothing is locked, which is an ordinary state for a machine rather than a
   * file that failed to say anything.
   */
  if (info.locks.length === 0) {
    return (
      <p className="notice" role="status">
        No files are locked on this machine. That is ordinary — locks live only as long as the
        process holding them, so a freshly booted machine or an idle container often has none at
        all.
      </p>
    );
  }

  return (
    <>
      {summary.waiting.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.waiting.length === 1
            ? '1 process is queued behind a lock'
            : `${summary.waiting.length} processes are queued behind locks`}{' '}
          — the <code>↳</code> rows below. Each is blocked in the kernel until whoever holds the
          lock above it lets go.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="locks held" value={String(summary.held)} />
        <Stat label="for writing" value={String(summary.writes)} />
        <Stat label="processes" value={String(summary.processes)} />
        {summary.waiting.length > 0 && (
          <Stat label="waiting" value={String(summary.waiting.length)} />
        )}
      </section>

      <p className="models" data-testid="kinds">
        {summary.kinds.map(({ kind, count }) => (
          <span
            key={kind}
            className="chip chip--model"
            title={describeKind(kind) ?? 'A kind this page has no note for'}
          >
            {kind} <span className="count">{count}</span>
          </span>
        ))}
      </p>

      <div className="card mounts">
        <table className="mounts__table locks__table" aria-label="File locks">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Kind</th>
              <th scope="col">State</th>
              <th scope="col">Access</th>
              <th scope="col">Range</th>
              <th scope="col">major:minor:inode</th>
              <th scope="col">PID</th>
            </tr>
          </thead>
          <tbody>
            {info.locks.map((lock, index) => (
              <LockRow key={`${lock.id}-${index}`} lock={lock} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        Three fields read differently from how they look. The device numbers are printed in{' '}
        <strong>hex</strong> while the inode beside them is decimal, so <code>fd:00</code> is major
        253 — they are shown decoded above. The byte range is{' '}
        <strong>inclusive at both ends</strong>, so <code>128 128</code> is one byte and{' '}
        <code>0 EOF</code> is the whole file however it grows; <code>flock</code> locks are always
        the whole file, since that call has no ranges. And the second field is only sometimes
        advisory or mandatory — for a lease it is the lease&rsquo;s state instead. Mandatory
        locking was removed in Linux 5.15, so a current kernel prints nothing but{' '}
        <code>ADVISORY</code>. A lock with no PID is an <strong>OFD lock</strong>, owned by the
        open file description rather than by any process, which is what lets it outlive a{' '}
        <code>fork</code> and be held by threads independently.
      </p>
    </>
  );
}
