import { useMemo } from 'react';
import {
  breakdown,
  formatCount,
  formatUptime,
  parseStat,
  seconds,
  uptime,
  type CpuTimes,
  type CpuUsage,
} from '../lib/stat';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The share of one state, as a segment of a CPU's bar. */
function Segment({ state, percent }: { state: string; percent: number }) {
  return (
    <span
      className={`cpus__segment cpus__segment--${state}`}
      style={{ width: `${percent}%` }}
      title={`${state} ${percent.toFixed(1)}%`}
    />
  );
}

function CpuRow({ usage }: { usage: CpuUsage }) {
  // Idle last, so the busy states read together from the left.
  const ordered = [...usage.states].sort(
    (a, b) => Number(a.state === 'idle') - Number(b.state === 'idle'),
  );

  return (
    <tr className="cpus__row">
      <td className="cpus__name">{usage.index === null ? 'all' : `cpu${usage.index}`}</td>
      <td className="cpus__number">{usage.busyPercent.toFixed(1)}%</td>
      <td className="cpus__bar-cell">
        <span className="cpus__bar">
          {ordered.map((entry) => (
            <Segment key={entry.state} state={entry.state} percent={entry.percent} />
          ))}
        </span>
      </td>
      <td className="cpus__number">{formatUptime(seconds(usage.busy))}</td>
      <td className="cpus__number">{formatUptime(seconds(usage.idle))}</td>
    </tr>
  );
}

/** Absent counters are shown as an em dash rather than a misleading zero. */
function Counter({ label, value }: { label: string; value: number | null }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        {value === null ? (
          <span className="muted" title="Not reported by this kernel">
            —
          </span>
        ) : (
          value.toLocaleString()
        )}
      </td>
    </tr>
  );
}

export function StatView({ content }: { content: string }) {
  const stat = useMemo(() => parseStat(content), [content]);
  const total = useMemo(() => (stat.total === null ? null : breakdown(stat.total)), [stat]);
  const perCpu = useMemo(() => stat.cpus.map((cpu: CpuTimes) => breakdown(cpu)), [stat]);

  if (total === null) {
    return (
      <p className="notice notice--warn">
        No CPU counters found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const up = uptime(stat);
  const booted = stat.btime === null ? null : new Date(stat.btime * 1000);

  return (
    <>
      <section className="summary">
        <Stat label="logical CPUs" value={String(perCpu.length)} />
        <Stat label="busy since boot" value={`${total.busyPercent.toFixed(1)}%`} />
        {up !== null && <Stat label="uptime" value={formatUptime(up)} />}
        <Stat label="running" value={String(stat.procsRunning ?? 0)} />
        {(stat.procsBlocked ?? 0) > 0 && (
          <Stat label="blocked on I/O" value={String(stat.procsBlocked)} />
        )}
      </section>

      <p className="models">
        {total.states.map((entry) => (
          <span key={entry.state} className="chip chip--model">
            {entry.state} <span className="count">{entry.percent.toFixed(1)}%</span>
          </span>
        ))}
      </p>

      <div className="card mounts">
        <table className="mounts__table cpus__table" aria-label="CPU time since boot">
          <thead>
            <tr>
              <th scope="col">CPU</th>
              <th scope="col">Busy</th>
              <th scope="col">Breakdown</th>
              <th scope="col">Busy time</th>
              <th scope="col">Idle time</th>
            </tr>
          </thead>
          <tbody>
            <CpuRow usage={total} />
            {perCpu.map((usage) => (
              <CpuRow key={usage.index} usage={usage} />
            ))}
          </tbody>
        </table>
      </div>

      <section className="card machine">
        <h3>Since boot</h3>
        <table className="cpu-card__fields" aria-label="Counters since boot">
          <tbody>
            {booted !== null && (
              <tr>
                <th scope="row">Booted</th>
                <td>{booted.toLocaleString()}</td>
              </tr>
            )}
            <Counter label="Context switches" value={stat.contextSwitches} />
            <Counter label="Processes created" value={stat.processes} />
            <Counter label="Interrupts" value={stat.interrupts} />
            <Counter label="Soft IRQs" value={stat.softirqs} />
            <Counter label="Running" value={stat.procsRunning} />
            <Counter label="Blocked on I/O" value={stat.procsBlocked} />
          </tbody>
        </table>
      </section>

      <p className="disks__note muted">
        Every counter is cumulative since boot, so the percentages are averages over the whole
        uptime — {stat.interrupts === null ? 'no' : formatCount(stat.interrupts)} interrupts and
        counting, not a live sample.
      </p>
    </>
  );
}
