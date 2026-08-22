import { useMemo, useState } from 'react';
import {
  isAccelerated,
  parseCrypto,
  preferred,
  summarize,
  type CryptoAlgorithm,
} from '../lib/crypto';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The size fields worth a column, whichever of them this type carries. */
function Sizes({ algorithm }: { algorithm: CryptoAlgorithm }) {
  const sizes: string[] = [];

  if (algorithm.digestsize !== null) sizes.push(`digest ${algorithm.digestsize}`);
  if (algorithm.minKeysize !== null && algorithm.maxKeysize !== null) {
    sizes.push(
      algorithm.minKeysize === algorithm.maxKeysize
        ? `key ${algorithm.minKeysize}`
        : `key ${algorithm.minKeysize}–${algorithm.maxKeysize}`,
    );
  }
  if (algorithm.ivsize !== null) sizes.push(`iv ${algorithm.ivsize}`);
  if (algorithm.maxauthsize !== null) sizes.push(`auth ${algorithm.maxauthsize}`);
  if (algorithm.blocksize !== null) sizes.push(`block ${algorithm.blocksize}`);

  if (sizes.length === 0) return <span className="muted">—</span>;

  return (
    <ul className="chips">
      {sizes.map((size) => (
        <li key={size} className="chip">
          {size}
        </li>
      ))}
    </ul>
  );
}

function AlgorithmRow({ algorithm, chosen }: { algorithm: CryptoAlgorithm; chosen: boolean }) {
  const failed = algorithm.selftest === 'failed';

  return (
    <tr className={algorithm.internal ? 'crypto__row crypto__row--internal' : 'crypto__row'}>
      <td className="crypto__name">
        {algorithm.name}
        {algorithm.internal && (
          <span className="chip" title="A building block, not usable on its own">
            internal
          </span>
        )}
      </td>
      <td className="crypto__driver">
        {algorithm.driver}
        {chosen && (
          <span className="chip chip--live" title="Highest priority, so this is the one in use">
            in use
          </span>
        )}
        {isAccelerated(algorithm) && (
          <span className="chip chip--flag" title="Driver name suggests hardware acceleration">
            accel
          </span>
        )}
      </td>
      <td>
        <span className="chip chip--type">{algorithm.type}</span>
      </td>
      <td className="crypto__number">{algorithm.priority}</td>
      <td className="crypto__module">{algorithm.module}</td>
      <td>
        {failed ? (
          <span className="chip chip--bug" title="This driver failed its power-on self-test">
            {algorithm.selftest}
          </span>
        ) : algorithm.selftest === 'passed' ? (
          <span className="muted">passed</span>
        ) : (
          <span className="chip">{algorithm.selftest}</span>
        )}
      </td>
      <td className="crypto__sizes">
        <Sizes algorithm={algorithm} />
      </td>
    </tr>
  );
}

export function CryptoView({ content }: { content: string }) {
  const algorithms = useMemo(() => parseCrypto(content), [content]);
  const summary = useMemo(() => summarize(algorithms), [algorithms]);
  const winners = useMemo(() => preferred(algorithms), [algorithms]);
  // Only worth pointing out which driver wins where there was a choice to make.
  const contested = useMemo(() => {
    const counts = new Map<string, number>();
    for (const algorithm of algorithms) {
      counts.set(algorithm.name, (counts.get(algorithm.name) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [algorithms]);
  const [hideInternal, setHideInternal] = useState(false);

  if (algorithms.length === 0) {
    return (
      <p className="notice notice--warn">
        No algorithms found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const visible = hideInternal
    ? algorithms.filter((algorithm) => !algorithm.internal)
    : algorithms;

  return (
    <>
      {summary.untested.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.untested.length} of {summary.total} implementations did not pass a self-test:{' '}
          {summary.untested.map((algorithm) => algorithm.driver).join(', ')}.
        </p>
      )}

      <section className="summary">
        <Stat label="implementations" value={String(summary.total)} />
        <Stat label="algorithms" value={String(summary.names)} />
        <Stat label="types" value={String(summary.types.length)} />
        {summary.contested > 0 && (
          <Stat label="with a choice of driver" value={String(summary.contested)} />
        )}
        {summary.asynchronous > 0 && (
          <Stat label="asynchronous" value={String(summary.asynchronous)} />
        )}
      </section>

      <p className="models">
        {summary.types.map(({ type, count }) => (
          <span key={type} className="chip chip--model">
            {type} <span className="count">{count}</span>
          </span>
        ))}
      </p>

      {summary.internal > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideInternal}
            onChange={(event) => setHideInternal(event.target.checked)}
          />
          Hide internal building blocks ({summary.internal} of {summary.total})
        </label>
      )}

      <div className="card mounts">
        <table className="mounts__table crypto__table">
          <thead>
            <tr>
              <th scope="col">Algorithm</th>
              <th scope="col">Driver</th>
              <th scope="col">Type</th>
              <th scope="col">Priority</th>
              <th scope="col">Module</th>
              <th scope="col">Self-test</th>
              <th scope="col">Sizes</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((algorithm) => (
              <AlgorithmRow
                key={`${algorithm.name}:${algorithm.driver}`}
                algorithm={algorithm}
                chosen={
                  contested.has(algorithm.name) &&
                  winners.get(algorithm.name)?.driver === algorithm.driver
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        One block per registered implementation, so an algorithm can appear more than once — the
        kernel uses whichever driver has the highest priority. Sizes are in bytes.
      </p>
    </>
  );
}
