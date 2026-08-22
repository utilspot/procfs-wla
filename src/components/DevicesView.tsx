import { useMemo, useState } from 'react';
import {
  byMajor,
  isLocal,
  parseDevices,
  summarize,
  type Device,
  type MajorGroup,
} from '../lib/devices';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function MajorRow({ group, highlight }: { group: MajorGroup; highlight: Set<string> }) {
  return (
    <tr className="devices__row">
      <td className="devices__major">
        {group.major}
        {isLocal(group.major) && (
          <span className="chip" title="Kernel range for local and experimental use">
            local
          </span>
        )}
      </td>
      <td>
        <ul className="chips">
          {group.names.map((name) => (
            <li
              key={name}
              className={highlight.has(name) ? 'chip chip--type' : 'chip'}
              title={highlight.has(name) ? `${name} holds several majors` : undefined}
            >
              {name}
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

function Section({
  title,
  devices,
  highlight,
}: {
  title: string;
  devices: readonly Device[];
  highlight: Set<string>;
}) {
  const groups = useMemo(() => byMajor(devices), [devices]);

  if (groups.length === 0) {
    return (
      <section className="devices__section">
        <h3>{title}</h3>
        <p className="notice notice--warn">None registered.</p>
      </section>
    );
  }

  return (
    <section className="devices__section">
      <h3>
        {title} <span className="count">{groups.length}</span>
      </h3>

      <div className="card mounts">
        <table className="mounts__table devices__table" aria-label={`${title} by major number`}>
          <thead>
            <tr>
              <th scope="col">Major</th>
              <th scope="col">Registered names</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <MajorRow key={group.major} group={group} highlight={highlight} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DevicesView({ content }: { content: string }) {
  const devices = useMemo(() => parseDevices(content), [content]);
  const summary = useMemo(() => summarize(devices), [devices]);
  const [hideLocal, setHideLocal] = useState(false);

  // Names worth pointing out in the tables: a driver holding several majors.
  const spreadNames = useMemo(
    () => new Set(summary.spread.map((entry) => entry.name)),
    [summary],
  );

  if (summary.total === 0) {
    return (
      <p className="notice notice--warn">
        No devices found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const filter = (list: readonly Device[]): Device[] =>
    hideLocal ? list.filter((device) => !isLocal(device.major)) : [...list];

  return (
    <>
      <section className="summary">
        <Stat label="registered names" value={String(summary.total)} />
        <Stat label="character majors" value={String(summary.characterMajors)} />
        <Stat label="block majors" value={String(summary.blockMajors)} />
        {summary.shared.length > 0 && (
          <Stat label="shared majors" value={String(summary.shared.length)} />
        )}
      </section>

      {summary.spread.length > 0 && (
        <p className="models">
          {summary.spread.map((entry) => (
            <span key={`${entry.kind}:${entry.name}`} className="chip chip--model">
              {entry.name} <span className="count">{entry.majors.length} majors</span>
            </span>
          ))}
        </p>
      )}

      {summary.local.length > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideLocal}
            onChange={(event) => setHideLocal(event.target.checked)}
          />
          Hide the local and experimental ranges ({summary.local.length} of {summary.total})
        </label>
      )}

      <div className="devices">
        <Section title="Character devices" devices={filter(devices.character)} highlight={spreadNames} />
        <Section title="Block devices" devices={filter(devices.block)} highlight={spreadNames} />
      </div>

      <p className="disks__note muted">
        Character and block majors are separate number spaces, so the same number in each section is
        two unrelated drivers. The file lists what is registered, not what exists — a major here
        does not mean a device node is present.
      </p>
    </>
  );
}
