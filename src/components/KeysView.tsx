import { useMemo } from 'react';
import {
  describe,
  flagsOf,
  formatPermissionByte,
  isExpired,
  isPermanent,
  maybeTruncated,
  parseKeys,
  permissionByte,
  permissionsOf,
  summarize,
  SUBJECTS,
  TYPE_WIDTH,
  type Key,
} from '../lib/keys';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The four bytes of the mask, each written the way `keyctl` writes it. */
function Permissions({ keyEntry }: { keyEntry: Key }) {
  return (
    <ul className="chips">
      {SUBJECTS.map((subject) => {
        const granted = permissionsOf(keyEntry, subject);

        return (
          <li
            key={subject}
            className={granted.length === 0 ? 'chip keys__perm--none' : 'chip'}
            title={`${subject}: ${granted.length === 0 ? 'nothing' : granted.join(', ')}`}
          >
            {formatPermissionByte(permissionByte(keyEntry, subject))}
          </li>
        );
      })}
    </ul>
  );
}

function KeyRow({ keyEntry }: { keyEntry: Key }) {
  const described = describe(keyEntry);
  const flags = flagsOf(keyEntry);
  const expired = isExpired(keyEntry);

  return (
    <tr className={expired ? 'keys__row keys__row--expired' : 'keys__row'}>
      <td className="keys__serial">{keyEntry.serial}</td>
      <td className="keys__type">
        {keyEntry.type}
        {maybeTruncated(keyEntry) && (
          <span
            className="chip"
            title={`The kernel prints the type in ${TYPE_WIDTH} characters, so this name may be cut short`}
          >
            cut?
          </span>
        )}
      </td>
      <td className="keys__description">
        {described.name}
        {described.detail !== null && <span className="count">{described.detail}</span>}
      </td>
      <td className="keys__flags">
        {flags.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <ul className="chips">
            {flags.map((flag) => (
              <li key={flag.letter} className="chip" title={`${flag.letter} — ${flag.description}`}>
                {flag.name}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="keys__timeout">
        {expired ? (
          <span className="chip chip--bug" title="Expired, and listed until it is collected">
            expired
          </span>
        ) : isPermanent(keyEntry) ? (
          <span className="muted" title="Never expires">
            never
          </span>
        ) : (
          <span title="Time left before it expires">{keyEntry.timeout}</span>
        )}
      </td>
      <td className="keys__perms">
        <Permissions keyEntry={keyEntry} />
      </td>
      <td className="keys__owner">
        {keyEntry.uid}:{keyEntry.gid}
      </td>
    </tr>
  );
}

export function KeysView({ content }: { content: string }) {
  const info = useMemo(() => parseKeys(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  /**
   * The file lists what the reader has View permission on, so an empty one is
   * a statement about the reader rather than about the machine.
   */
  if (info.keys.length === 0) {
    return (
      <p className="notice" role="status">
        No keys are visible here. This file lists the keys the reader has <strong>View</strong>{' '}
        permission on, so an empty one means none can be seen — not that the machine holds none.
        Another user, or root, will see a different file.
      </p>
    );
  }

  return (
    <>
      {summary.unusable.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.unusable.length === 1
            ? '1 key can no longer be used'
            : `${summary.unusable.length} keys can no longer be used`}{' '}
          — expired, revoked, invalidated or dead. They stay listed until the kernel collects them,
          so this is ordinary rather than a fault.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="keys" value={String(summary.total)} />
        <Stat label="keyrings" value={String(summary.keyrings)} />
        <Stat label="with an expiry" value={String(summary.expiring.length)} />
        {summary.expired.length > 0 && (
          <Stat label="expired" value={String(summary.expired.length)} />
        )}
      </section>

      <p className="models" data-testid="types">
        {summary.types.map(({ type, count }) => (
          <span key={type} className="chip chip--model">
            {type} <span className="count">{count}</span>
          </span>
        ))}
      </p>

      <div className="card mounts">
        <table className="mounts__table keys__table" aria-label="Keys in the kernel keyring">
          <thead>
            <tr>
              <th scope="col">Serial</th>
              <th scope="col">Type</th>
              <th scope="col">Description</th>
              <th scope="col">Flags</th>
              <th scope="col">Expires</th>
              <th scope="col">Permissions</th>
              <th scope="col">uid:gid</th>
            </tr>
          </thead>
          <tbody>
            {info.keys.map((keyEntry) => (
              <KeyRow key={keyEntry.serial} keyEntry={keyEntry} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        The <strong>permission mask</strong> is four bytes — one each for a{' '}
        <strong>possessor</strong> of the key, the owning user, the owning group and everyone else
        — and each holds six rights: view, read, write, search, link and setattr. They are written
        above the way <code>keyctl</code> writes them, so <code>--alswrv</code> is all six and{' '}
        <code>--------</code> is none; hover for the names. Possession is not ownership: a process
        possesses a key when it is reachable from one of its own keyrings, and that is usually
        where the rights come from. The <strong>flags</strong> are positional in the file — seven
        characters, each either its own letter or <code>-</code> — and are spelled out here. The
        type is printed in {TYPE_WIDTH} characters, so a longer name is cut short, which is all a
        name of exactly {TYPE_WIDTH} can tell you.
      </p>
    </>
  );
}
