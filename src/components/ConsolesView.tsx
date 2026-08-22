import { useMemo } from 'react';
import {
  describeFlag,
  hasFlag,
  isEnabled,
  nameFlag,
  operations,
  parseConsoles,
  summarize,
  type Console,
} from '../lib/consoles';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The three operations, shown as present or missing rather than as a string. */
function Operations({ console: entry }: { console: Console }) {
  const ops = [
    { letter: 'R', on: entry.read, label: 'read' },
    { letter: 'W', on: entry.write, label: 'write' },
    { letter: 'U', on: entry.unblank, label: 'unblank' },
  ];

  return (
    <ul className="chips">
      {ops.map((op) => (
        <li
          key={op.letter}
          className={op.on ? 'chip' : 'chip cons__op--off'}
          title={op.on ? `implements ${op.label}` : `does not implement ${op.label}`}
        >
          {op.on ? op.letter : '—'}
        </li>
      ))}
    </ul>
  );
}

function ConsoleRow({ console: entry }: { console: Console }) {
  const enabled = isEnabled(entry);

  return (
    <tr className={enabled ? 'cons__row' : 'cons__row cons__row--disabled'}>
      <td className="cons__name">
        {entry.name}
        {hasFlag(entry, 'C') && (
          <span className="chip chip--live" title="This is what /dev/console refers to">
            /dev/console
          </span>
        )}
        {!enabled && (
          <span className="chip chip--bug" title="Registered but not enabled, so it receives nothing">
            not enabled
          </span>
        )}
      </td>
      <td className="cons__device">
        {entry.device === null ? (
          <span className="muted" title="This console has no device node">
            —
          </span>
        ) : (
          `${entry.device.major}:${entry.device.minor}`
        )}
      </td>
      <td className="cons__ops" title={`the kernel writes this as ${operations(entry)}`}>
        <Operations console={entry} />
      </td>
      <td className="cons__flags">
        {entry.flags.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <ul className="chips">
            {entry.flags.map((flag) => (
              <li key={flag} className="chip" title={`${flag} — ${describeFlag(flag)}`}>
                {nameFlag(flag)}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

export function ConsolesView({ content }: { content: string }) {
  const consoles = useMemo(() => parseConsoles(content), [content]);
  const summary = useMemo(() => summarize(consoles), [consoles]);

  if (consoles.length === 0) {
    return (
      <p className="notice notice--warn">
        No consoles found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.boot.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.boot.map((entry) => entry.name).join(', ')}{' '}
          {summary.boot.length === 1 ? 'is an early boot console' : 'are early boot consoles'} and
          still registered. The kernel normally hands over to a real driver and unregisters these
          once it is up.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="consoles" value={String(summary.total)} />
        <Stat label="enabled" value={String(summary.enabled)} />
        <Stat label="/dev/console" value={summary.preferred?.name ?? 'none'} />
      </section>

      <div className="card mounts">
        <table className="mounts__table cons__table" aria-label="Registered consoles">
          <thead>
            <tr>
              <th scope="col">Console</th>
              <th scope="col">Device</th>
              <th scope="col">Operations</th>
              <th scope="col">Flags</th>
            </tr>
          </thead>
          <tbody>
            {consoles.map((entry) => (
              <ConsoleRow key={entry.name} console={entry} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>Operations</strong> are the three the driver may implement — read, write and
        unblank; most consoles only write. The console marked{' '}
        <strong>preferred</strong> is what <code>/dev/console</code> refers to, so it is where the
        kernel&rsquo;s own messages go; the rest still receive output but are not it. A console
        with no device number has no node under <code>/dev</code> at all, which is normal for an
        early boot console or netconsole.
      </p>
    </>
  );
}
