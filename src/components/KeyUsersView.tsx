import { useMemo } from 'react';
import {
  isRoot,
  NEAR_QUOTA,
  nearQuota,
  parseKeyUsers,
  summarize,
  uninstantiated,
  type KeyUser,
} from '../lib/key-users';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function percent(share: number | null): string {
  return share === null ? '—' : `${Math.round(share * 100)}%`;
}

/** One quota: how much of it is used, and the pair the kernel printed. */
function Quota({ used, limit, unit }: { used: number; limit: number; unit: string }) {
  const share = limit === 0 ? null : used / limit;
  const full = share !== null && share >= NEAR_QUOTA;

  return (
    <div className="kusers__quota">
      <span
        className="kusers__bar"
        title={`${used.toLocaleString()} of ${limit.toLocaleString()} ${unit} — ${percent(share)}`}
      >
        <span
          className={full ? 'kusers__segment kusers__segment--full' : 'kusers__segment'}
          style={{ width: `${Math.min(100, (share ?? 0) * 100)}%` }}
        />
      </span>
      <span className="kusers__figures">
        {used.toLocaleString()} / {limit.toLocaleString()}
      </span>
    </div>
  );
}

function UserRow({ user }: { user: KeyUser }) {
  const pending = uninstantiated(user);

  return (
    <tr className={nearQuota(user) ? 'kusers__row kusers__row--near' : 'kusers__row'}>
      <td className="kusers__uid">
        {user.uid}
        {isRoot(user) && (
          <span className="chip" title="root, which the kernel gives its own larger quota">
            root
          </span>
        )}
      </td>
      <td className="kusers__number">{user.keys.toLocaleString()}</td>
      <td className="kusers__number">
        {pending === 0 ? (
          <span className="muted" title="Every key held has a payload">
            —
          </span>
        ) : (
          <span
            className="chip"
            title="Held but not instantiated: still being constructed, or a cached lookup failure"
          >
            {pending}
          </span>
        )}
      </td>
      <td className="kusers__quota-cell">
        <Quota used={user.quotaKeys} limit={user.maxKeys} unit="keys" />
      </td>
      <td className="kusers__quota-cell">
        <Quota used={user.quotaBytes} limit={user.maxBytes} unit="bytes" />
      </td>
      <td className="kusers__number">{user.usage.toLocaleString()}</td>
    </tr>
  );
}

export function KeyUsersView({ content }: { content: string }) {
  const info = useMemo(() => parseKeyUsers(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  if (info.users.length === 0) {
    return (
      <p className="notice notice--warn">
        No users found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.nearQuota.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.nearQuota.map((user) => `uid ${user.uid}`).join(', ')}{' '}
          {summary.nearQuota.length === 1 ? 'is' : 'are'} within{' '}
          {Math.round((1 - NEAR_QUOTA) * 100)}% of a key quota. Adding a key past the limit fails
          with <code>EDQUOT</code> rather than evicting anything, so a program that keeps keys will
          start failing there.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="users" value={String(summary.users)} />
        <Stat label="keys held" value={summary.keys.toLocaleString()} />
        {summary.uninstantiated > 0 && (
          <Stat label="not instantiated" value={String(summary.uninstantiated)} />
        )}
        {summary.closest !== null && (
          <Stat label="closest to a quota" value={`uid ${summary.closest.uid}`} />
        )}
      </section>

      <div className="card mounts">
        <table className="mounts__table kusers__table" aria-label="Key quotas per user">
          <thead>
            <tr>
              <th scope="col">uid</th>
              <th scope="col">Keys</th>
              <th scope="col">Pending</th>
              <th scope="col">Key quota</th>
              <th scope="col">Byte quota</th>
              <th scope="col">Refs</th>
            </tr>
          </thead>
          <tbody>
            {info.users.map((user) => (
              <UserRow key={user.uid} user={user} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        The kernel prints three pairs, and only two of them are quotas. The first —{' '}
        <strong>keys held</strong> against how many are instantiated — describes one set of keys,
        so the gap is keys with no payload yet: under construction, or a lookup that failed and was
        cached. The other two are usage against a limit, for keys and for payload bytes, and only
        keys flagged <code>Q</code> in <code>/proc/keys</code> count towards them. The limit is
        printed per line because <strong>root gets its own</strong>, far larger than an ordinary
        user&rsquo;s — which is why the bars matter more than the raw numbers. Both limits are
        settable through <code>/proc/sys/kernel/keys/</code>, so nothing here assumes the defaults.
      </p>
    </>
  );
}
