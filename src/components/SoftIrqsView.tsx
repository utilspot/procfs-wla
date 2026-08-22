import { useMemo } from 'react';
import {
  busiestCpu,
  concentration,
  describeVector,
  formatCount,
  formatShare,
  isIdle,
  parseSoftirqs,
  share,
  summarize,
  total,
  type Softirq,
} from '../lib/softirqs';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function SoftirqRow({
  vector,
  cpus,
  machineTotal,
}: {
  vector: Softirq;
  cpus: readonly string[];
  machineTotal: number;
}) {
  const sum = total(vector);
  const idle = isIdle(vector);
  const busiest = busiestCpu(vector);
  const described = describeVector(vector.name);

  return (
    <tr className={idle ? 'sirq__row sirq__row--idle' : 'sirq__row'}>
      <td className="sirq__name">{vector.name}</td>
      <td className="sirq__what">
        {described ?? <span className="muted">A vector this page has no note for</span>}
      </td>
      <td className="sirq__number" title={`${sum.toLocaleString()} handler runs`}>
        {idle ? (
          <span className="muted" title="This vector has never run on this machine">
            never
          </span>
        ) : (
          formatCount(sum)
        )}
      </td>
      <td className="sirq__number">
        {idle ? <span className="muted">—</span> : formatShare(share(vector, machineTotal))}
      </td>
      {cpus.map((cpu, index) => (
        <td
          key={cpu}
          className={index === busiest ? 'sirq__number sirq__number--top' : 'sirq__number'}
          title={
            index === busiest
              ? `${cpu} ran ${(concentration(vector) * 100).toFixed(0)}% of this vector`
              : undefined
          }
        >
          {vector.counts[index] === 0 || vector.counts[index] === undefined ? (
            <span className="muted">·</span>
          ) : (
            formatCount(vector.counts[index]!)
          )}
        </td>
      ))}
    </tr>
  );
}

export function SoftIrqsView({ content }: { content: string }) {
  const softirqs = useMemo(() => parseSoftirqs(content), [content]);
  const summary = useMemo(() => summarize(softirqs), [softirqs]);

  if (softirqs.vectors.length === 0) {
    return (
      <p className="notice notice--warn">
        No softirq vectors found in this file. Switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  const { cpus } = softirqs;
  const busiestCpuIndex = summary.perCpu.indexOf(Math.max(...summary.perCpu));

  return (
    <>
      {summary.pinned.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.pinned
            .map(
              (vector) =>
                `${vector.name} ran almost entirely on ${cpus[busiestCpu(vector)] ?? 'one CPU'}`,
            )
            .join(', ')}
          . A softirq runs on whichever CPU raised it, so this is where the work arrives rather
          than a scheduling decision — one receive queue, or an interrupt with nowhere else to
          go. That CPU is the ceiling: the rest cannot help with it however idle they are.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="softirqs" value={formatCount(summary.total)} />
        <Stat label="CPUs" value={String(summary.cpus)} />
        {summary.busiest[0] !== undefined && (
          <Stat label="busiest vector" value={summary.busiest[0].name} />
        )}
        <Stat label="vectors raised" value={`${summary.raised} of ${summary.vectors}`} />
      </section>

      <p className="models" data-testid="per-cpu-totals">
        {cpus.map((cpu, index) => (
          <span
            key={cpu}
            className={index === busiestCpuIndex ? 'chip chip--flag' : 'chip chip--model'}
          >
            {cpu} <span className="count">{formatCount(summary.perCpu[index] ?? 0)}</span>
          </span>
        ))}
      </p>

      <div className="card mounts sirq">
        <table className="mounts__table sirq__table" aria-label="Softirqs by vector">
          <thead>
            <tr>
              <th scope="col">Vector</th>
              <th scope="col">Defers</th>
              <th scope="col">Runs</th>
              <th scope="col">Share</th>
              {cpus.map((cpu) => (
                <th key={cpu} scope="col">
                  {cpu}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {softirqs.vectors.map((vector) => (
              <SoftirqRow
                key={vector.name}
                vector={vector}
                cpus={cpus}
                machineTotal={summary.total}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        A softirq is the half of interrupt handling the kernel puts off: the device&rsquo;s own
        handler acknowledges it and returns, and the work happens here, with interrupts enabled
        again — on the same CPU, in the exit path of that interrupt, or in that CPU&rsquo;s{' '}
        <code>ksoftirqd</code> thread once it has been at it too long. The counts are{' '}
        <strong>handler runs, not units of work</strong>: one run of <code>NET_RX</code> can take
        up to <code>netdev_budget</code> packets, 300 by default, so this file says how often the
        kernel came back to the work rather than how much of it there was. The rows are a fixed
        list — the kernel&rsquo;s own enum, in its order — so a zero means the vector never ran,
        not that the machine lacks it. <code>HRTIMER</code> reading zero is ordinary: it went
        unused between 4.2 and 4.15 and now counts only the timers allowed to run late. A kernel
        older than 4.5 prints <code>BLOCK_IOPOLL</code> where <code>IRQ_POLL</code> now is.
      </p>
    </>
  );
}
