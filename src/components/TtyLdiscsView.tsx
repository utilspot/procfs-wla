import { useMemo } from 'react';
import {
  constantFor,
  describeLdisc,
  isDefault,
  isUnknown,
  parseLdiscs,
  removed,
  removedIn,
  TOTAL,
  type LineDiscipline,
} from '../lib/tty-ldiscs';

function LdiscRow({ discipline }: { discipline: LineDiscipline }) {
  const constant = constantFor(discipline.number);
  const description = describeLdisc(discipline.number);
  const gone = removedIn(discipline);

  return (
    <tr className={isDefault(discipline) ? 'ldisc__row ldisc__row--default' : 'ldisc__row'}>
      <td className="ldisc__number">{discipline.number}</td>
      <td className="ldisc__name">
        {discipline.name}
        {isDefault(discipline) && (
          <span className="chip chip--live" title="Every tty starts on this one until something calls TIOCSETD">
            default
          </span>
        )}
        {isUnknown(discipline) && (
          <span
            className="chip chip--bug"
            title="No N_* constant is allocated for this number here: an out-of-tree module, or one newer than this page"
          >
            not known here
          </span>
        )}
      </td>
      <td className="ldisc__constant">
        {constant === null ? <span className="muted">—</span> : constant}
      </td>
      <td className="ldisc__what">
        {description ?? <span className="muted">Nothing here knows this number.</span>}
        {gone !== null && (
          <span className="chip chip--bug ldisc__gone" title={`Linux deleted the driver in ${gone}`}>
            gone in {gone}
          </span>
        )}
      </td>
    </tr>
  );
}

export function TtyLdiscsView({ content }: { content: string }) {
  const disciplines = useMemo(() => parseLdiscs(content), [content]);
  const gone = useMemo(() => removed(disciplines), [disciplines]);

  if (disciplines.length === 0) {
    return (
      <p className="notice notice--warn">
        No line disciplines found in this file. Switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  return (
    <>
      {gone.length > 0 && (
        <p className="notice notice--warn" role="status">
          {gone.map((discipline) => discipline.name).join(', ')}{' '}
          {gone.length === 1 ? 'is a discipline' : 'are disciplines'} current Linux no longer has a
          driver for — the last went in{' '}
          {gone.map((discipline) => removedIn(discipline)).sort().at(-1)}. The numbers stay
          allocated whatever happens to the drivers, so this says the kernel is older than that
          rather than that anything is wrong with it.
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table ldisc__table" aria-label="Registered line disciplines">
          <thead>
            <tr>
              <th scope="col">N</th>
              <th scope="col">Name</th>
              <th scope="col">Constant</th>
              <th scope="col">What it does</th>
            </tr>
          </thead>
          <tbody>
            {disciplines.map((discipline) => (
              <LdiscRow key={discipline.number} discipline={discipline} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        A line discipline sits between a tty driver and whatever reads the terminal: it is what
        turns bytes into lines, echoes them, and makes <code>^C</code> a signal.{' '}
        <strong>This file lists what is registered, not what the kernel can do</strong> — a
        discipline appears when its module registers and goes when that module unloads, so an
        ordinary machine shows two of the {TOTAL} numbers the ABI allocates. The number is the{' '}
        <code>N_*</code> constant rather than a position in a list: it is what{' '}
        <code>ioctl(TIOCSETD)</code> takes, so it means the same thing on every kernel and is never
        reused. Gaps between the numbers are the normal case, not something missing. Only{' '}
        <code>n_tty</code> is ever in use unless something set another: attaching a Bluetooth
        adapter to a UART is a program swapping <code>n_hci</code> onto that port, with nothing
        about the driver underneath changing.
      </p>
    </>
  );
}
