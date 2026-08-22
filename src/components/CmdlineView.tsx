import { useMemo, useState } from 'react';
import {
  byModule,
  duplicates,
  find,
  parseCmdline,
  relaxations,
  summarize,
  type Parameter,
} from '../lib/cmdline';

function ParameterRow({
  parameter,
  overridden,
}: {
  parameter: Parameter;
  overridden: boolean;
}) {
  return (
    <tr className={overridden ? 'cmdline__row cmdline__row--overridden' : 'cmdline__row'}>
      <td className="cmdline__key">
        {parameter.module !== null && <span className="cmdline__module">{parameter.module}.</span>}
        {parameter.name}
      </td>
      <td className="cmdline__value">
        {parameter.value === null ? (
          <span className="chip">flag</span>
        ) : parameter.value === '' ? (
          <span className="muted">(empty)</span>
        ) : (
          parameter.value
        )}
        {overridden && (
          <span className="chip" title="Given again later, and the kernel takes the last">
            overridden
          </span>
        )}
      </td>
    </tr>
  );
}

export function CmdlineView({ content }: { content: string }) {
  const cmdline = useMemo(() => parseCmdline(content), [content]);
  const summary = useMemo(() => summarize(cmdline), [cmdline]);
  const repeated = useMemo(() => duplicates(cmdline), [cmdline]);
  const relaxed = useMemo(() => relaxations(cmdline), [cmdline]);
  const modules = useMemo(() => byModule(cmdline), [cmdline]);
  const [hideModules, setHideModules] = useState(false);

  if (cmdline.parameters.length === 0) {
    return (
      <p className="notice notice--warn">
        No kernel parameters found in this file. Switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  // A parameter is overridden when a later one repeats its key.
  const lastIndex = new Map<string, number>();
  cmdline.parameters.forEach((parameter, index) => lastIndex.set(parameter.key, index));

  const moduleParameters = cmdline.parameters.filter(
    (parameter) => parameter.module !== null,
  ).length;

  const visible = cmdline.parameters
    .map((parameter, index) => ({ parameter, index }))
    .filter(({ parameter }) => !hideModules || parameter.module === null);

  return (
    <>
      {relaxed.length > 0 && (
        <p className="notice notice--warn" role="status">
          {relaxed.length === 1 ? 'One parameter relaxes' : `${relaxed.length} parameters relax`} a
          kernel protection: {relaxed.map((entry) => `${entry.parameter.raw} (${entry.note})`).join(', ')}.
        </p>
      )}

      {/*
        No row of counts above the page. Every one of them was a number the page
        already showed: the parameters and the flags are the table below, the
        modules are the chips under this card with a count on each, and the
        arguments for init are the card at the foot listing them. A tile saying
        how many of something is in view is a label rather than a summary, so
        the page opens on what the machine booted with instead.
      */}
      {summary.notable.length > 0 && (
        <section className="card machine cmdline__boot">
          <h3>Booted with</h3>
          <table className="cpu-card__fields" aria-label="Notable boot parameters">
            <tbody>
              {summary.notable.map((entry) => (
                <tr key={entry.label}>
                  <th scope="row">{entry.label}</th>
                  <td>
                    <code>{entry.parameter.value}</code>
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row">Mounted</th>
                <td>{find(cmdline, 'rw') === undefined ? 'read-only (ro)' : 'read-write (rw)'}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {modules.length > 0 && (
        <p className="models">
          {modules.map((group) => (
            <span key={group.module} className="chip chip--model">
              {group.module} <span className="count">{group.parameters.length}</span>
            </span>
          ))}
        </p>
      )}

      {modules.length > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideModules}
            onChange={(event) => setHideModules(event.target.checked)}
          />
          Hide module parameters ({moduleParameters} of {cmdline.parameters.length})
        </label>
      )}

      <div className="card mounts">
        <table className="mounts__table cmdline__table" aria-label="Kernel parameters">
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ parameter, index }) => (
              <ParameterRow
                key={`${parameter.raw}:${index}`}
                parameter={parameter}
                overridden={lastIndex.get(parameter.key) !== index}
              />
            ))}
          </tbody>
        </table>
      </div>

      {cmdline.initArgs.length > 0 && (
        <section className="card machine">
          <h3>Passed to init</h3>
          <p className="muted">Everything after <code>--</code>, which the kernel does not read.</p>
          <ul className="chips">
            {cmdline.initArgs.map((argument) => (
              <li key={argument} className="chip">
                {argument}
              </li>
            ))}
          </ul>
        </section>
      )}

      {repeated.length > 0 && (
        <p className="disks__note muted">
          {repeated.map((entry) => entry.key).join(', ')} given more than once — for most
          parameters the kernel acts on the last, which is the one shown above.
        </p>
      )}
    </>
  );
}
