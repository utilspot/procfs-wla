import { useMemo } from 'react';
import {
  formatDuration,
  formatShare,
  idleShare,
  IMPLAUSIBLE_CPUS,
  parseUptime,
  summarize,
} from '../lib/uptime';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function UptimeView({ content }: { content: string }) {
  const uptime = useMemo(() => parseUptime(content), [content]);
  const summary = useMemo(() => (uptime === null ? null : summarize(uptime)), [uptime]);

  if (uptime === null || summary === null) {
    return (
      <p className="notice notice--warn">
        No uptime found in this file. It is one line of two numbers — switch to the raw view to see
        what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.timeNamespace && (
        <p className="notice notice--warn" role="status">
          These two numbers imply at least {summary.minimumCpus?.toLocaleString()} CPUs, which is
          more than almost any machine has. The likelier reading is a{' '}
          <strong>time namespace</strong>: the uptime has been offset to this container&rsquo;s own
          boot, while the idle total is still the host&rsquo;s and counts every CPU on it. The two
          figures are not describing the same machine.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="up" value={formatDuration(summary.seconds)} />
        <Stat
          label="idle across all CPUs"
          value={summary.idleSeconds === null ? '—' : formatDuration(summary.idleSeconds)}
        />
        <Stat
          label="CPUs’ worth of idle"
          value={summary.idlePerSecond === null ? '—' : summary.idlePerSecond.toFixed(2)}
        />
        <Stat
          label="at least"
          value={
            summary.minimumCpus === null ? '—' : `${summary.minimumCpus.toLocaleString()} CPUs`
          }
        />
      </section>

      <p className="models" data-testid="fields">
        {uptime.raw.map((field, index) => (
          <span
            key={field}
            className="chip chip--model"
            title={
              index === 0
                ? 'Seconds since boot, from CLOCK_BOOTTIME — time spent suspended included'
                : 'Idle seconds added up across every CPU, iowait not among them'
            }
          >
            {index === 0 ? 'uptime' : 'idle'} <span className="count">{field}</span>
          </span>
        ))}
      </p>

      {summary.idleBelowUptime && !summary.timeNamespace && (
        <p className="notice" role="status">
          There is less than one CPU-second of idle here per second of uptime. On a machine with
          more than one CPU that is either a genuinely busy one, or a machine that spent the time{' '}
          <strong>suspended</strong> — uptime comes from a clock that counts sleep, and the idle
          total does not advance while the CPUs are switched off.
        </p>
      )}

      {summary.candidates.length > 0 && (
        <div className="card mounts uptime">
          <table className="mounts__table uptime__table" aria-label="Idle share by CPU count">
            <thead>
              <tr>
                <th scope="col">If the machine has</th>
                <th scope="col">Idle</th>
                <th scope="col">Busy</th>
              </tr>
            </thead>
            <tbody>
              {summary.candidates.map((cpus) => {
                const share = idleShare(uptime, cpus);
                const fewest = cpus === summary.minimumCpus;

                return (
                  <tr key={cpus} className={fewest ? 'uptime__row uptime__row--fewest' : 'uptime__row'}>
                    <td className="uptime__cpus">
                      {cpus.toLocaleString()} CPU{cpus === 1 ? '' : 's'}
                      {fewest && (
                        <span
                          className="chip chip--type"
                          title="The fewest that could have produced this much idle"
                        >
                          fewest possible
                        </span>
                      )}
                    </td>
                    <td className="uptime__number">{share === null ? '—' : formatShare(share)}</td>
                    <td className="uptime__number">
                      {share === null ? '—' : formatShare(1 - share)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="disks__note muted">
        The second number is <strong>not how long the machine was idle</strong> — it is idle time
        added up across every CPU, so on an eight-core machine it counts up to eight seconds per
        second and comes out larger than the uptime beside it. That is also what makes it worth
        something: average idle per CPU cannot exceed one second per second, so the ratio of the
        two is a floor on the CPU count. The count itself is not in this file, which is why the
        table above gives a share per candidate rather than one answer. Two more things the kernel
        does here: the uptime comes from <code>CLOCK_BOOTTIME</code>, so time spent{' '}
        <strong>suspended is included</strong> while the idle total stands still through it; and
        the idle sum is <code>CPUTIME_IDLE</code> over every <em>possible</em> CPU, with{' '}
        <strong>iowait left out</strong> — <code>/proc/stat</code> counts that separately, so the
        two files need not agree. Both figures are printed to hundredths, which is the format&rsquo;s
        limit rather than the clock&rsquo;s. An implied count above{' '}
        {IMPLAUSIBLE_CPUS.toLocaleString()} CPUs is read here as a time namespace instead: a
        container&rsquo;s own uptime beside the host&rsquo;s idle total.
      </p>
    </>
  );
}
