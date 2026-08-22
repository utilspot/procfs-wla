import { useMemo } from 'react';
import {
  averageWaitNs,
  formatDuration,
  formatNs,
  idleShare,
  localWakeupShare,
  NAMED_VERSION,
  parseSchedStat,
  summarize,
  waitRatio,
  type CpuSchedStat,
} from '../lib/schedstat';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(0)}%`;
}

function CpuRow({ cpu, worst }: { cpu: CpuSchedStat; worst: number }) {
  const wait = averageWaitNs(cpu);
  const ratio = waitRatio(cpu);

  return (
    <tr className="sched__row">
      <td className="sched__name">{cpu.name}</td>
      <td className="sched__number">{wait === null ? '—' : formatNs(wait)}</td>
      <td className="sched__bar-cell">
        <span
          className="sched__bar"
          title={wait === null ? undefined : `${formatNs(wait)} average wait`}
        >
          <span
            className="sched__segment"
            style={{ width: `${worst === 0 ? 0 : ((wait ?? 0) / worst) * 100}%` }}
          />
        </span>
      </td>
      <td className="sched__number">{cpu.runTimeNs === null ? '—' : formatDuration(cpu.runTimeNs)}</td>
      <td className="sched__number">
        {cpu.waitTimeNs === null ? '—' : formatDuration(cpu.waitTimeNs)}
      </td>
      <td className="sched__number">{ratio === null ? '—' : ratio.toFixed(2)}</td>
      <td className="sched__number">{cpu.timeslices?.toLocaleString() ?? '—'}</td>
      <td className="sched__number">{percent(idleShare(cpu))}</td>
      <td className="sched__number">{percent(localWakeupShare(cpu))}</td>
      <td className="sched__domains">
        {cpu.domains.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <ul className="chips">
            {cpu.domains.map((domain) => (
              <li
                key={domain.name}
                className="chip"
                title={`${domain.name}: mask ${domain.mask}, ${domain.cpuCount} CPUs`}
              >
                {domain.mask} <span className="count">{domain.cpuCount}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

export function SchedStatView({ content }: { content: string }) {
  const schedstat = useMemo(() => parseSchedStat(content), [content]);
  const summary = useMemo(() => summarize(schedstat), [schedstat]);

  if (schedstat.cpus.length === 0) {
    return (
      <p className="notice notice--warn">
        No scheduler statistics found in this file. <code>/proc/schedstat</code> only exists when
        the kernel was built with <code>CONFIG_SCHEDSTATS</code>. Switch to the raw view to see
        what the server returned.
      </p>
    );
  }

  const worst = summary.worst === null ? 0 : (averageWaitNs(summary.worst) ?? 0);

  return (
    <>
      {!schedstat.named && (
        <p className="notice notice--warn" role="status">
          This file is version {schedstat.version ?? 'unknown'}, whose field layout differs from
          version {NAMED_VERSION}. The counters are shown as given rather than labelled, since
          naming them would put the right labels on the wrong numbers — the raw view has them in
          full.
        </p>
      )}

      <section className="summary">
        <Stat label="CPUs" value={String(summary.cpus)} />
        <Stat
          label="average wait to run"
          value={summary.averageWaitNs === null ? '—' : formatNs(summary.averageWaitNs)}
        />
        <Stat label="time running" value={formatDuration(summary.runTimeNs)} />
        <Stat label="time queued" value={formatDuration(summary.waitTimeNs)} />
        {summary.domainLevels > 0 && (
          <Stat label="domain levels" value={String(summary.domainLevels)} />
        )}
      </section>

      {summary.worst !== null && summary.cpus > 1 && (
        <p className="models">
          <span className="chip chip--model">
            longest wait <span className="count">{summary.worst.name}</span>
          </span>
          <span className="chip chip--model">
            {formatNs(worst)} <span className="count">average</span>
          </span>
        </p>
      )}

      <div className="card mounts sched">
        <table className="mounts__table sched__table" aria-label="Scheduler statistics per CPU">
          <thead>
            <tr>
              <th scope="col">CPU</th>
              <th scope="col">Avg wait</th>
              <th scope="col">Relative</th>
              <th scope="col">Running</th>
              <th scope="col">Queued</th>
              <th scope="col">Wait/run</th>
              <th scope="col">Timeslices</th>
              <th scope="col">Went idle</th>
              <th scope="col">Local wakeups</th>
              <th scope="col">Domains</th>
            </tr>
          </thead>
          <tbody>
            {schedstat.cpus.map((cpu) => (
              <CpuRow key={cpu.name} cpu={cpu} worst={worst} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>Avg wait</strong> is the time a task spent on the run queue before getting the CPU
        — the total queued divided by the timeslices run, which is what this file exists to report.
        <strong> Domains</strong> are the scheduler&rsquo;s balancing groups, innermost first, shown
        by their CPU mask: <code>03</code> is a pair of SMT siblings, <code>ff</code> a whole
        eight-CPU node. Their 36 load-balancer counters vary by version and are left to the raw
        view. All counters are cumulative since boot
        {schedstat.timestamp !== null && `, taken at jiffy ${schedstat.timestamp.toLocaleString()}`}.
      </p>
    </>
  );
}
