import { useMemo, useState } from 'react';
import {
  concentration,
  formatCount,
  isPerCpu,
  parseInterrupts,
  summarize,
  total,
  type Interrupt,
} from '../lib/interrupts';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** A line is pinned when nearly every interrupt landed on one CPU. */
const PINNED = 0.9;

function InterruptRow({ line, cpus }: { line: Interrupt; cpus: readonly string[] }) {
  const sum = total(line);
  const perCpu = isPerCpu(line, cpus);
  const pinned = perCpu && sum > 0 && cpus.length > 1 && concentration(line) >= PINNED;
  const busiest = perCpu ? line.counts.indexOf(Math.max(...line.counts)) : -1;

  return (
    <tr className={sum === 0 ? 'irq__row irq__row--idle' : 'irq__row'}>
      <td className="irq__label">{line.label}</td>
      <td className="irq__device">
        {line.irq === null ? (
          <span className="muted">{line.description}</span>
        ) : (
          <>
            {line.devices.length === 0 ? <span className="muted">—</span> : null}
            <ul className="chips">
              {line.devices.map((device) => (
                <li key={device} className="chip">
                  {device}
                </li>
              ))}
            </ul>
            {pinned && (
              <span
                className="chip chip--type"
                title={`${(concentration(line) * 100).toFixed(0)}% of these landed on ${cpus[busiest]}`}
              >
                pinned to {cpus[busiest]}
              </span>
            )}
          </>
        )}
      </td>
      <td className="irq__chip">
        {line.chip === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            {line.chip}
            {line.hwirq !== null && (
              <span className="irq__hw">
                {' '}
                {line.hwirq} {line.trigger}
              </span>
            )}
          </>
        )}
      </td>
      <td className="irq__number">{formatCount(sum)}</td>
      {cpus.map((cpu, index) =>
        perCpu ? (
          <td
            key={cpu}
            className={
              index === busiest && sum > 0 ? 'irq__number irq__number--top' : 'irq__number'
            }
          >
            {line.counts[index] === 0 ? <span className="muted">·</span> : formatCount(line.counts[index]!)}
          </td>
        ) : (
          // ERR and MIS have a single machine-wide count, so the per-CPU cells
          // are blank rather than showing it under CPU0.
          <td key={cpu} className="irq__number">
            {index === 0 ? <span className="muted" title="One count for the machine, not per CPU">whole machine</span> : null}
          </td>
        ),
      )}
    </tr>
  );
}

export function InterruptsView({ content }: { content: string }) {
  const interrupts = useMemo(() => parseInterrupts(content), [content]);
  const summary = useMemo(() => summarize(interrupts), [interrupts]);
  const [hideIdle, setHideIdle] = useState(false);

  if (interrupts.lines.length === 0) {
    return (
      <p className="notice notice--warn">
        No interrupt lines found in this file. Switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  const { cpus } = interrupts;
  const visible = hideIdle ? interrupts.lines.filter((line) => total(line) > 0) : interrupts.lines;
  const busiestCpu = summary.perCpu.indexOf(Math.max(...summary.perCpu));

  return (
    <>
      <section className="summary">
        <Stat label="interrupts" value={formatCount(summary.total)} />
        <Stat label="CPUs" value={String(summary.cpus)} />
        <Stat label="hardware IRQs" value={String(summary.hardware)} />
        {summary.busiest[0] !== undefined && (
          <Stat
            label="busiest device"
            value={summary.busiest[0].devices[0] ?? summary.busiest[0].label}
          />
        )}
      </section>

      <p className="models" data-testid="per-cpu-totals">
        {cpus.map((cpu, index) => (
          <span
            key={cpu}
            className={index === busiestCpu ? 'chip chip--flag' : 'chip chip--model'}
          >
            {cpu} <span className="count">{formatCount(summary.perCpu[index] ?? 0)}</span>
          </span>
        ))}
      </p>

      {summary.idle > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideIdle}
            onChange={(event) => setHideIdle(event.target.checked)}
          />
          Hide lines that have never fired ({summary.idle} of {summary.lines})
        </label>
      )}

      <div className="card mounts irq">
        <table className="mounts__table irq__table" aria-label="Interrupts by line">
          <thead>
            <tr>
              <th scope="col">IRQ</th>
              <th scope="col">Device</th>
              <th scope="col">Controller</th>
              <th scope="col">Total</th>
              {cpus.map((cpu) => (
                <th key={cpu} scope="col">
                  {cpu}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => (
              <InterruptRow key={line.label} line={line} cpus={cpus} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        Counts are cumulative since boot. A numbered line is a hardware IRQ, with the controller,
        its hardware number and how it is triggered; the lettered lines are the kernel&rsquo;s own
        counters. <code>ERR</code> and <code>MIS</code> carry one count for the machine rather than
        one per CPU.
      </p>
    </>
  );
}
