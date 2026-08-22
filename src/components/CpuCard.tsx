import { useState } from 'react';
import { cpuBugs, cpuFlags, cpuModel, type CpuEntry } from '../lib/cpuinfo';

/** Fields already shown in the card header, so not repeated in the table. */
const HEADER_FIELDS = new Set(['processor', 'model name', 'flags', 'features', 'bugs']);

const FLAG_PREVIEW_COUNT = 24;

export function CpuCard({ cpu }: { cpu: CpuEntry }) {
  const [showAllFlags, setShowAllFlags] = useState(false);

  const flags = cpuFlags(cpu);
  const bugs = cpuBugs(cpu);
  const visibleFlags = showAllFlags ? flags : flags.slice(0, FLAG_PREVIEW_COUNT);
  const details = cpu.fields.filter((field) => !HEADER_FIELDS.has(field.key.toLowerCase()));
  const mhz = Number(cpu.get('cpu MHz'));

  return (
    <article className="card cpu-card">
      <header className="cpu-card__header">
        <span className="cpu-card__index">CPU {cpu.index ?? '?'}</span>
        <h3 className="cpu-card__model">{cpuModel(cpu)}</h3>
        {Number.isFinite(mhz) && (
          <span className="cpu-card__clock">{(mhz / 1000).toFixed(2)} GHz</span>
        )}
      </header>

      <table className="cpu-card__fields">
        <tbody>
          {details.map((field) => (
            <tr key={field.key}>
              <th scope="row">{field.key}</th>
              <td>{field.value === '' ? <span className="muted">—</span> : field.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {bugs.length > 0 && (
        <section className="cpu-card__section">
          <h4>
            Known bugs <span className="count">{bugs.length}</span>
          </h4>
          <ul className="chips">
            {bugs.map((bug) => (
              <li key={bug} className="chip chip--bug">
                {bug}
              </li>
            ))}
          </ul>
        </section>
      )}

      {flags.length > 0 && (
        <section className="cpu-card__section">
          <h4>
            Flags <span className="count">{flags.length}</span>
          </h4>
          <ul className="chips">
            {visibleFlags.map((flag) => (
              <li key={flag} className="chip">
                {flag}
              </li>
            ))}
          </ul>
          {flags.length > FLAG_PREVIEW_COUNT && (
            <button
              type="button"
              className="link-button"
              onClick={() => setShowAllFlags((shown) => !shown)}
            >
              {showAllFlags
                ? 'Show fewer'
                : `Show all ${flags.length} flags (+${flags.length - FLAG_PREVIEW_COUNT})`}
            </button>
          )}
        </section>
      )}
    </article>
  );
}
