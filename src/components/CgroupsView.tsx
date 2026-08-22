import { useMemo } from 'react';
import {
  coMounted,
  hierarchies,
  parseCgroups,
  summarize,
  type Controller,
} from '../lib/cgroups';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function ControllerRow({
  controller,
  all,
  busiest,
}: {
  controller: Controller;
  all: readonly Controller[];
  busiest: number;
}) {
  const together = coMounted(controller, all);

  return (
    <tr className={controller.enabled ? 'cg__row' : 'cg__row cg__row--disabled'}>
      <td className="cg__name">
        {controller.name}
        {!controller.enabled && (
          <span
            className="chip chip--bug"
            title="Compiled in but switched off, usually by cgroup_disable="
          >
            disabled
          </span>
        )}
      </td>
      <td className="cg__number">
        {controller.hierarchy === 0 ? (
          <span className="muted" title="On the unified v2 hierarchy, or not mounted">
            unified
          </span>
        ) : (
          controller.hierarchy
        )}
      </td>
      <td className="cg__mounted">
        {together.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <ul className="chips">
            {together.map((other) => (
              <li key={other.name} className="chip">
                {other.name}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="cg__number">{controller.cgroups.toLocaleString()}</td>
      <td className="cg__bar-cell">
        <span className="cg__bar">
          <span
            className="cg__segment"
            style={{ width: `${busiest === 0 ? 0 : (controller.cgroups / busiest) * 100}%` }}
          />
        </span>
      </td>
    </tr>
  );
}

export function CgroupsView({ content }: { content: string }) {
  const controllers = useMemo(() => parseCgroups(content), [content]);
  const summary = useMemo(() => summarize(controllers), [controllers]);
  const groups = useMemo(() => hierarchies(controllers), [controllers]);

  if (controllers.length === 0) {
    return (
      <p className="notice notice--warn">
        No cgroup controllers found in this file. Switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  return (
    <>
      {summary.disabled.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.disabled.length === 1
            ? 'One controller is compiled in but switched off'
            : `${summary.disabled.length} controllers are compiled in but switched off`}
          : {summary.disabled.map((controller) => controller.name).join(', ')}. Usually{' '}
          <code>cgroup_disable=</code> on the kernel command line.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="controllers" value={String(summary.controllers)} />
        <Stat label="enabled" value={String(summary.enabled)} />
        <Stat label="cgroups" value={summary.cgroups.toLocaleString()} />
        {summary.hierarchies > 0 && (
          <Stat label="v1 hierarchies" value={String(summary.hierarchies)} />
        )}
      </section>

      <p className="models">
        <span className="chip chip--flag" title="Decided from where the enabled controllers sit">
          {summary.layout}
        </span>
      </p>

      <div className="card mounts">
        <table className="mounts__table cg__table" aria-label="Cgroup controllers">
          <thead>
            <tr>
              <th scope="col">Controller</th>
              <th scope="col">Hierarchy</th>
              <th scope="col">Mounted with</th>
              <th scope="col">Cgroups</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {controllers.map((controller) => (
              <ControllerRow
                key={controller.name}
                controller={controller}
                all={controllers}
                busiest={summary.cgroups}
              />
            ))}
          </tbody>
        </table>
      </div>

      {groups.length > 0 && (
        <section className="card machine">
          <h3>v1 hierarchies</h3>
          <table className="cpu-card__fields" aria-label="Controllers per v1 hierarchy">
            <tbody>
              {groups.map((hierarchy) => (
                <tr key={hierarchy.id}>
                  <th scope="row">{hierarchy.id}</th>
                  <td>
                    <ul className="chips">
                      {hierarchy.controllers.map((controller) => (
                        <li key={controller.name} className="chip">
                          {controller.name}
                        </li>
                      ))}
                    </ul>
                    <span className="muted"> {hierarchy.cgroups.toLocaleString()} cgroups</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="disks__note muted">
        A non-zero hierarchy is the id of a cgroup <strong>v1</strong> mount, and controllers
        sharing a number are mounted together — <code>cpu</code> with <code>cpuacct</code> is the
        usual pairing. Zero does not mean unused: under <strong>v2</strong> every controller lives
        on the single unified hierarchy, which has no number here, so a v2 machine shows zero for
        all of them. The layout above is read from the <em>enabled</em> controllers only, since a
        disabled one sits on zero whatever the machine is doing.
      </p>
    </>
  );
}
