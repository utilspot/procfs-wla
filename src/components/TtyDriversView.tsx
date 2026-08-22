import { useMemo } from 'react';
import {
  describeType,
  isUnnamed,
  minorCount,
  minorRange,
  parseTtyDrivers,
  summarize,
  type TtyDriver,
} from '../lib/tty-drivers';

function DriverRow({ driver }: { driver: TtyDriver }) {
  const minors = minorCount(driver);

  return (
    <tr className={driver.pseudo ? 'tty__row tty__row--pseudo' : 'tty__row'}>
      <td className="tty__name">
        {driver.name}
        {driver.pseudo && (
          <span
            className="chip"
            title="Printed ahead of the list: a node that redirects to whichever terminal is current, not a driver"
          >
            not a driver
          </span>
        )}
        {isUnnamed(driver) && (
          <span className="chip chip--bug" title="Registered without a driver_name, so the kernel printed its placeholder">
            no name
          </span>
        )}
      </td>
      <td className="tty__device">{driver.device}</td>
      <td className="tty__major">{driver.major}</td>
      <td
        className="tty__minors"
        title={minors === 1 ? 'one device number' : `${minors.toLocaleString()} device numbers reserved`}
      >
        {minorRange(driver)}
        {minors > 1 && <span className="muted tty__count"> ({minors.toLocaleString()})</span>}
      </td>
      <td className="tty__type">
        <span
          className={driver.type === 'serial:callout' ? 'chip chip--bug' : 'chip'}
          title={describeType(driver.type)}
        >
          {driver.type}
        </span>
      </td>
    </tr>
  );
}

export function TtyDriversView({ content }: { content: string }) {
  const drivers = useMemo(() => parseTtyDrivers(content), [content]);
  const summary = useMemo(() => summarize(drivers), [drivers]);

  if (drivers.length === 0) {
    return (
      <p className="notice notice--warn">
        No tty drivers found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.callouts.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.callouts.map((driver) => driver.device).join(', ')} is a{' '}
          <strong>callout</strong> device — the second node an old kernel gave a serial line for
          dialling out on. Linux dropped these during 2.6, so a kernel still registering one is
          older than anything in service.
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table tty__table" aria-label="Registered tty drivers">
          <thead>
            <tr>
              <th scope="col">Driver</th>
              <th scope="col">Device</th>
              <th scope="col">Major</th>
              <th scope="col">Minors</th>
              <th scope="col">Type</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((driver) => (
              <DriverRow
                key={`${driver.name} ${driver.device} ${driver.major}:${driver.minors.first}`}
                driver={driver}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        The first four rows are <strong>not drivers</strong>. The kernel prints them ahead of the
        list because each is a node that redirects to whichever terminal is current —{' '}
        <code>/dev/tty</code> is the caller&rsquo;s own controlling terminal, and{' '}
        <code>/dev/ptmx</code> hands out a fresh pseudo-terminal pair every time it is opened. The
        minors are what a driver <strong>reserved</strong>, not what exists: <code>/dev/pts</code>{' '}
        claims a million device numbers on a machine with three terminals open. A driver shown
        as <code>unknown</code> registered without a name, which is the kernel&rsquo;s placeholder
        rather than a missing driver — the virtual terminal driver is one on most machines.
      </p>
    </>
  );
}
