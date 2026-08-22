import { useMemo } from 'react';
import { parseCpuInfo, summarize } from '../lib/cpuinfo';
import { CpuCard } from './CpuCard';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function CpuInfoView({ content }: { content: string }) {
  const info = useMemo(() => parseCpuInfo(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  if (info.cpus.length === 0) {
    return (
      <p className="notice notice--warn">
        No processor entries found in this file. Switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  const clocks = summary.clocksMHz;
  const maxClock = clocks.length > 0 ? Math.max(...clocks) : null;

  return (
    <>
      <section className="summary">
        <Stat label="logical CPUs" value={String(summary.logicalCount)} />
        {summary.physicalCores !== null && (
          <Stat label="physical cores" value={String(summary.physicalCores)} />
        )}
        {summary.sockets !== null && <Stat label="sockets" value={String(summary.sockets)} />}
        {maxClock !== null && <Stat label="peak clock" value={`${(maxClock / 1000).toFixed(2)} GHz`} />}
      </section>

      <p className="models">
        {summary.models.map((model) => (
          <span key={model} className="chip chip--model">
            {model}
          </span>
        ))}
      </p>

      {info.machine.length > 0 && (
        <section className="card machine">
          <h3>Machine</h3>
          <table className="cpu-card__fields">
            <tbody>
              {info.machine.map((field) => (
                <tr key={field.key}>
                  <th scope="row">{field.key}</th>
                  <td>{field.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="cpu-grid">
        {info.cpus.map((cpu, position) => (
          <CpuCard key={cpu.index ?? `cpu-${position}`} cpu={cpu} />
        ))}
      </section>
    </>
  );
}
