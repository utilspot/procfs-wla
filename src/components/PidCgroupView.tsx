import { useMemo } from 'react';
import {
  allAtRoot,
  atRoot,
  describeController,
  disagreeing,
  isEmpty,
  layoutOf,
  parseCgroup,
  unifiedLine,
  unitOf,
  UNIT_KINDS,
  type CgroupLine,
} from '../lib/pid-cgroup';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The path as its steps, so the tree it names reads as one. */
function Path({ path }: { path: string }) {
  const segments = path.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) {
    return (
      <span className="cg2__path">
        <span className="cg2__segment cg2__segment--root">/</span>
      </span>
    );
  }

  return (
    <span className="cg2__path">
      {segments.map((segment, index) => (
        <span key={`${segment}:${index}`}>
          <span className="cg2__separator">/</span>
          <span
            className={
              index === segments.length - 1 ? 'cg2__segment cg2__segment--here' : 'cg2__segment'
            }
          >
            {segment}
          </span>
        </span>
      ))}
    </span>
  );
}

function LineRow({ line }: { line: CgroupLine }) {
  return (
    <tr className={line.unified ? 'cg2__row cg2__row--unified' : 'cg2__row'}>
      <td className="cg2__id">{line.id}</td>
      <td className="cg2__controllers">
        {line.unified ? (
          <span className="chip chip--live" title="No controllers named: this is the unified hierarchy">
            v2
          </span>
        ) : (
          <>
            {line.controllers.map((controller) => (
              <span
                className="chip"
                key={controller}
                title={describeController(controller) ?? 'No entry for this controller here'}
              >
                {controller}
              </span>
            ))}
            {line.name !== null && (
              <span
                className="chip chip--flag"
                title="A named hierarchy with no controller on it — systemd mounts one to track units"
              >
                name={line.name}
              </span>
            )}
          </>
        )}
      </td>
      <td className="cg2__where">
        <Path path={line.path} />
        {atRoot(line) && (
          <span className="muted cg2__note">the root cgroup of this hierarchy</span>
        )}
      </td>
    </tr>
  );
}

/**
 * Where this process sits on every hierarchy the machine has — and the two
 * things that read wrong about it: `0::` is cgroup v2 rather than a hierarchy
 * numbered zero, and the path is written from the *reader's* point of view.
 */
export function PidCgroupView({ content }: { content: string }) {
  const cgroup = useMemo(() => parseCgroup(content), [content]);
  const layout = layoutOf(cgroup);
  const unified = unifiedLine(cgroup);
  const differing = useMemo(() => disagreeing(cgroup), [cgroup]);
  const unit = unified === null ? null : unitOf(unified);

  const note = (
    <p className="disks__note muted">
      One line per hierarchy, each saying where <em>this</em> process sits on it — not{' '}
      <code>/proc/cgroups</code>, which is the machine&rsquo;s table of controllers.{' '}
      <strong>
        <code>0::</code> is cgroup v2, and the empty middle field is what says so
      </strong>
      : the unified hierarchy names no controllers, because on v2 they are not attached to
      hierarchies of their own, and the <code>0</code> follows from that rather than being the mark
      itself. <strong>The path is not a filesystem path</strong> — it is relative to that
      hierarchy&rsquo;s root, so <code>/user.slice/…</code> is under wherever the hierarchy is
      mounted, usually <code>/sys/fs/cgroup</code>, and <code>/</code> means the root cgroup rather
      than the root directory. <strong>And it is written from the reader&rsquo;s point of view</strong>:{' '}
      <code>proc_cgroup_show</code> resolves the path against{' '}
      <code>current-&gt;nsproxy-&gt;cgroup_ns</code>, the <em>reading</em> task&rsquo;s cgroup
      namespace, so a process inside a container with a namespace of its own reads <code>/</code>{' '}
      for itself while the same process read from the host shows the whole path. Neither answer is
      wrong; the file says where something is relative to where you are standing. Two smaller
      notes. A <strong>zombie&rsquo;s v1 lines say <code>/</code></strong>, because that is where
      zombies live on a traditional hierarchy, while its v2 line keeps naming the cgroup it was in
      — one file, two answers, neither stale. And a cgroup may be <strong>named with a colon in
      it</strong>, so the path is everything after the second one rather than whatever a split on{' '}
      <code>:</code> leaves.
    </p>
  );

  if (isEmpty(cgroup)) {
    return (
      <>
        <p className="notice notice--warn" data-testid="empty">
          No hierarchies found in this file. A process on a machine with cgroups always has at least
          one line — switch to the raw view to see what the server returned.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="hierarchies" value={String(cgroup.lines.length)} />
        <Stat label="layout" value={layout === null ? '—' : layout} />
        {unit !== null && <Stat label="cgroup" value={unit.name} />}
      </section>

      {unit !== null && (
        <p className="notice" role="status" data-testid="unit">
          On the unified hierarchy this process is in <code>{unit.name}</code>, which is{' '}
          {UNIT_KINDS[unit.kind]}. Everything else in that cgroup shares whatever limits are set on
          it and on the slices above it.
        </p>
      )}

      {allAtRoot(cgroup) && (
        <p className="notice" role="status" data-testid="at-root">
          <strong>Every line here is the root cgroup, which usually means a namespace.</strong> The
          path is resolved against the reading task&rsquo;s cgroup namespace, so a process inside a
          container that has one of its own cannot see past its own root and reads <code>/</code>{' '}
          however deep it really sits on the host. Read the same process from outside and the path
          is the whole one. The other reading is that this process really is at the top of every
          hierarchy, which is what pid 1 looks like on a machine that is not running anything under
          systemd.
        </p>
      )}

      {differing.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="disagree">
          <strong>
            {differing.length === 1 ? 'One hierarchy puts' : `${differing.length} hierarchies put`}{' '}
            this process somewhere else than the unified one does.
          </strong>{' '}
          {differing.map((line) => `${line.controllers.join(',') || `name=${line.name}`} at ${line.path}`).join('; ')}
          . On a machine where systemd builds the same tree everywhere that means the process was
          moved on one hierarchy and not the others — or it is on its way out:{' '}
          <code>proc_cgroup_show</code> prints the root for an exiting task on a v1 hierarchy, while
          the v2 line goes on naming the cgroup it was in.
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table cg2__table" aria-label="Cgroup hierarchies">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Controllers</th>
              <th scope="col">Cgroup</th>
            </tr>
          </thead>
          <tbody>
            {cgroup.lines.map((line) => (
              <LineRow line={line} key={line.raw} />
            ))}
          </tbody>
        </table>
      </div>

      {unified === null && (
        <p className="notice" role="status" data-testid="no-unified">
          <strong>There is no unified hierarchy here.</strong> Every line names controllers, so this
          machine mounts cgroup v1 alone — each controller group on a hierarchy of its own, and a
          process placed on each of them separately. The line with no controller at all but a{' '}
          <code>name=</code> is systemd&rsquo;s own: a hierarchy it mounts to track its units,
          limiting nothing.
        </p>
      )}

      {cgroup.unread.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unread">
          {cgroup.unread.length} line{cgroup.unread.length === 1 ? '' : 's'} here{' '}
          {cgroup.unread.length === 1 ? 'is' : 'are'} not{' '}
          <code>id:controllers:path</code>. The kernel writes nothing else, so switch to the raw
          view to see what did.
        </p>
      )}

      {note}
    </>
  );
}
