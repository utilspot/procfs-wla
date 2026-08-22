import { useMemo, useState } from 'react';
import { isPseudo } from '../lib/mounts';
import {
  byId,
  depthOf,
  hasDevice,
  parseMountinfo,
  peerGroup,
  propagationOf,
  summarize,
  type Mountinfo,
} from '../lib/mountinfo';

/**
 * `/proc/<pid>/mountinfo` laid out as what it is: a **tree**, not a list.
 *
 * The mount points are indented by how deep they sit — see `depthOf` — because
 * that is the fact this file has and `/proc/mounts` does not. Two mounts can
 * share a path prefix without one being under the other, and only the ids say
 * which.
 *
 * The rest of the row is what a mount is *doing*: whether it is a bind of a
 * subtree, whether it is read-only and which of the two kinds, and how it
 * propagates. A pseudo-filesystem the kernel provides is dimmed rather than
 * hidden — with a filter for whoever wants them gone, since on a desktop they
 * are most of the file.
 */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The mount's own type, for the pseudo-filesystem check `/proc/mounts` uses. */
function pseudo(mount: Mountinfo): boolean {
  return isPseudo({
    device: mount.source,
    mountPoint: mount.mountPoint,
    type: mount.type,
    options: mount.options,
    dump: 0,
    pass: 0,
    readOnly: mount.readOnly,
  });
}

function Propagation({ mount }: { mount: Mountinfo }) {
  const kind = propagationOf(mount);
  if (kind === 'private') return <span className="muted">private</span>;

  const shared = peerGroup(mount, 'shared');
  const master = peerGroup(mount, 'master');

  return (
    <ul className="chips">
      {shared !== null && (
        <li className="chip chip--shared" title="Mounts made under this one appear under every peer in this group">
          shared <span className="count">{shared}</span>
        </li>
      )}
      {master !== null && (
        <li className="chip chip--slave" title="Receives mounts from this peer group without sending any back">
          slave of <span className="count">{master}</span>
        </li>
      )}
      {kind === 'unbindable' && (
        <li className="chip chip--unbindable" title="Cannot be bound anywhere or propagated into another namespace">
          unbindable
        </li>
      )}
    </ul>
  );
}

function MountRow({ mount, depth }: { mount: Mountinfo; depth: number }) {
  return (
    <tr className={pseudo(mount) ? 'minfo__row minfo__row--pseudo' : 'minfo__row'}>
      <td>
        <span
          className="minfo__point"
          // The tree is the point of this file, so the depth is shown rather
          // than left to be worked out from the paths — which cannot say it.
          style={{ paddingLeft: `${Math.min(depth, 8) * 0.85}rem` }}
        >
          {mount.mountPoint}
        </span>
        <span className="minfo__flags">
          {mount.readOnly && (
            <span className="chip chip--ro" title="This mount is read-only, whatever the filesystem underneath allows">
              ro
            </span>
          )}
          {mount.superReadOnly && (
            <span className="chip chip--ro-super" title="The filesystem itself is read-only, so every mount of it is">
              ro fs
            </span>
          )}
          {mount.bind && (
            <span className="chip chip--bind" title={`A bind of ${mount.root} rather than the whole filesystem`}>
              bind
            </span>
          )}
        </span>
      </td>
      <td className="minfo__source">
        {mount.source}
        {mount.bind && <span className="minfo__root">{mount.root}</span>}
      </td>
      <td>
        <span className="chip chip--type">{mount.type}</span>
      </td>
      <td className="minfo__devno" title={hasDevice(mount) ? 'Device behind this filesystem' : 'No device: an anonymous minor the kernel handed out'}>
        {mount.major}:{mount.minor}
      </td>
      <td className="minfo__propagation">
        <Propagation mount={mount} />
      </td>
      <td className="minfo__options">
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

export function MountinfoView({ content }: { content: string }) {
  const mounts = useMemo(() => parseMountinfo(content), [content]);
  const summary = useMemo(() => summarize(mounts), [mounts]);
  const depths = useMemo(() => {
    const index = byId(mounts);
    return new Map(mounts.map((mount) => [mount.id, depthOf(mount, index)]));
  }, [mounts]);
  const [hidePseudo, setHidePseudo] = useState(false);

  if (mounts.length === 0) {
    return (
      <p className="notice notice--warn" data-testid="empty">
        No mounts were listed in this file. Switch to the raw view to see what the server returned —
        a line here needs the <code>-</code> that separates its two halves, and one without it is
        not a line this parser will guess at.
      </p>
    );
  }

  const pseudoCount = mounts.filter(pseudo).length;
  const visible = hidePseudo ? mounts.filter((mount) => !pseudo(mount)) : mounts;

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="mounts" value={String(summary.total)} />
        <Stat label="filesystem types" value={String(summary.types.length)} />
        <Stat label="bind mounts" value={String(summary.binds)} />
        <Stat label="read-only" value={String(summary.readOnly)} />
        {summary.root !== undefined && <Stat label="root filesystem" value={summary.root.type} />}
      </section>

      <p className="models" data-testid="propagation">
        {summary.propagation.map(({ kind, count }) => (
          <span key={kind} className="chip chip--model">
            {kind} <span className="count">{count}</span>
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

      <div className="card minfo">
        <table className="minfo__table">
          <thead>
            <tr>
              <th scope="col">Mount point</th>
              <th scope="col">Source</th>
              <th scope="col">Type</th>
              <th scope="col">Device</th>
              <th scope="col">Propagation</th>
              <th scope="col">Options</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((mount) => (
              <MountRow key={mount.id} mount={mount} depth={depths.get(mount.id) ?? 0} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
