import { useMemo, useState } from 'react';
import { isPseudo, parseMounts, summarize, type Mount } from '../lib/mounts';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function MountRow({ mount }: { mount: Mount }) {
  return (
    <tr className={isPseudo(mount) ? 'mounts__row mounts__row--pseudo' : 'mounts__row'}>
      <td className="mounts__point">
        {mount.mountPoint}
        {mount.readOnly && <span className="chip chip--ro">ro</span>}
      </td>
      <td className="mounts__device">{mount.device}</td>
      <td>
        <span className="chip chip--type">{mount.type}</span>
      </td>
      <td className="mounts__options">
        <ul className="chips">
          {mount.options.map((option) => (
            <li key={option} className="chip">
              {option}
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

export function MountsView({ content }: { content: string }) {
  const mounts = useMemo(() => parseMounts(content), [content]);
  const summary = useMemo(() => summarize(mounts), [mounts]);
  const [hidePseudo, setHidePseudo] = useState(false);

  if (mounts.length === 0) {
    return (
      <p className="notice notice--warn">
        No mounts found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const pseudoCount = mounts.filter(isPseudo).length;
  const visible = hidePseudo ? mounts.filter((mount) => !isPseudo(mount)) : mounts;

  return (
    <>
      <section className="summary">
        <Stat label="mounts" value={String(summary.total)} />
        <Stat label="filesystem types" value={String(summary.types.length)} />
        <Stat label="read-only" value={String(summary.readOnly)} />
        {summary.root !== undefined && (
          <Stat label="root filesystem" value={summary.root.type} />
        )}
      </section>

      <p className="models">
        {summary.types.map(({ type, count }) => (
          <span key={type} className="chip chip--model">
            {type} <span className="count">{count}</span>
          </span>
        ))}
      </p>

      <label className="mounts__filter">
        <input
          type="checkbox"
          checked={hidePseudo}
          onChange={(event) => setHidePseudo(event.target.checked)}
        />
        Hide kernel pseudo-filesystems ({pseudoCount} of {mounts.length})
      </label>

      <div className="card mounts">
        <table className="mounts__table">
          <thead>
            <tr>
              <th scope="col">Mount point</th>
              <th scope="col">Device</th>
              <th scope="col">Type</th>
              <th scope="col">Options</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((mount) => (
              <MountRow key={`${mount.mountPoint}-${mount.device}-${mount.type}`} mount={mount} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
