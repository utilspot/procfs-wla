import { useMemo, useState } from 'react';
import {
  dependencies,
  describeTaint,
  formatBytes,
  isRemovable,
  parseModules,
  summarize,
  type Module,
} from '../lib/modules';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function Names({ names }: { names: readonly string[] }) {
  if (names.length === 0) return <span className="muted">—</span>;

  return (
    <ul className="chips">
      {names.map((name) => (
        <li key={name} className="chip">
          {name}
        </li>
      ))}
    </ul>
  );
}

function ModuleRow({ module, needs }: { module: Module; needs: readonly string[] }) {
  const removable = isRemovable(module);

  return (
    <tr className={removable ? 'modules__row modules__row--removable' : 'modules__row'}>
      <td className="modules__name">
        {module.name}
        {module.state !== 'Live' && (
          <span className="chip chip--bug" title={`This module is ${module.state.toLowerCase()}`}>
            {module.state}
          </span>
        )}
        {module.taints.map((letter) => (
          <span key={letter} className="chip chip--flag" title={describeTaint(letter)}>
            {letter}
          </span>
        ))}
      </td>
      <td className="modules__number">{formatBytes(module.size)}</td>
      <td className="modules__number">
        {module.useCount === 0 ? <span className="muted">0</span> : module.useCount}
      </td>
      <td className="modules__deps">
        <Names names={module.usedBy} />
      </td>
      <td className="modules__deps">
        <Names names={needs} />
      </td>
    </tr>
  );
}

export function ModulesView({ content }: { content: string }) {
  const modules = useMemo(() => parseModules(content), [content]);
  const summary = useMemo(() => summarize(modules), [modules]);
  const needs = useMemo(() => dependencies(modules), [modules]);
  const [hideRemovable, setHideRemovable] = useState(false);

  if (modules.length === 0) {
    return (
      <p className="notice notice--warn">
        No modules found in this file. A kernel with everything built in has none to list. Switch to
        the raw view to see what the server returned.
      </p>
    );
  }

  const visible = hideRemovable
    ? summary.largest.filter((module) => !isRemovable(module))
    : summary.largest;

  return (
    <>
      {summary.tainted.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.tainted.length} of {summary.count} modules taint the kernel:{' '}
          {summary.tainted.map((module) => module.name).join(', ')}.
        </p>
      )}

      {summary.unsettled.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.unsettled
            .map((module) => `${module.name} is ${module.state.toLowerCase()}`)
            .join(', ')}
          , so this table is a snapshot of a kernel mid-change.
        </p>
      )}

      <section className="summary">
        <Stat label="modules" value={String(summary.count)} />
        <Stat label="memory" value={formatBytes(summary.totalBytes)} />
        <Stat label="nothing depends on" value={String(summary.removable)} />
        {summary.tainted.length > 0 && (
          <Stat label="tainting" value={String(summary.tainted.length)} />
        )}
      </section>

      {summary.taints.length > 0 && (
        <p className="models">
          {summary.taints.map(({ letter, count }) => (
            <span key={letter} className="chip chip--model" title={describeTaint(letter)}>
              {letter} — {describeTaint(letter)} <span className="count">{count}</span>
            </span>
          ))}
        </p>
      )}

      {summary.removable > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideRemovable}
            onChange={(event) => setHideRemovable(event.target.checked)}
          />
          Hide modules nothing holds a reference to ({summary.removable} of {summary.count})
        </label>
      )}

      <div className="card mounts">
        <table className="mounts__table modules__table" aria-label="Loaded modules by size">
          <thead>
            <tr>
              <th scope="col">Module</th>
              <th scope="col">Size</th>
              <th scope="col">Uses</th>
              <th scope="col">Used by</th>
              <th scope="col">Depends on</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((module) => (
              <ModuleRow key={module.name} module={module} needs={needs.get(module.name) ?? []} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>Used by</strong> is the kernel&rsquo;s own field: the modules that depend on this
        one. <strong>Depends on</strong> is that relationship inverted, which the file does not
        state directly. A use count higher than the &ldquo;used by&rdquo; list means something that
        is not a module holds a reference — an open device node, or a mounted filesystem.
        {modules.every((module) => module.address === null) &&
          ' Load addresses are hidden, as kptr_restrict does for an unprivileged reader.'}
      </p>
    </>
  );
}
