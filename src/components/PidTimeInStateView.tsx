import { useMemo } from 'react';
import {
  ascends,
  busiestStep,
  canScale,
  CLOCK_TICK,
  formatDuration,
  formatFrequency,
  formatShare,
  heavyAtTopStep,
  isEmpty,
  meanFrequency,
  neverRan,
  parsePidTimeInState,
  policyShare,
  policyTotal,
  ranOn,
  summarize,
  ticksToSeconds,
  topStepShare,
  TOP_STEP_HEAVY,
  totalTicks,
  type Policy,
  type TimeInState,
} from '../lib/pid-time_in_state';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * One policy, with a bar per step. The bar is against the policy's own busiest
 * step rather than against the file's, since two clusters' times are not a
 * comparison worth drawing.
 */
function PolicyCard({ info, policy }: { info: TimeInState; policy: Policy }) {
  const total = policyTotal(policy);
  const busiest = busiestStep(policy);
  const mean = meanFrequency(policy);
  const share = policyShare(info, policy);
  const top = topStepShare(policy);

  return (
    <div className="card tis" data-testid={`policy-cpu${policy.cpu}`}>
      <div className="tis__head">
        <h2 className="tis__name">
          <code>cpu{policy.cpu}</code>
          <span className="tis__what muted">
            {policy.steps.length === 1
              ? 'one operating point, so this policy never changes speed'
              : `${policy.steps.length} operating points — and every core sharing this policy, not core ${policy.cpu} alone`}
          </span>
        </h2>
        <div className="tis__totals">
          <span className="tis__time">{formatDuration(ticksToSeconds(total))}</span>
          {share !== null && <span className="muted">{formatShare(share)} of this task&rsquo;s time</span>}
        </div>
      </div>

      {!ranOn(policy) ? (
        <p className="notice" role="status" data-testid={`unused-cpu${policy.cpu}`}>
          <strong>This task has never run on this policy.</strong> Every step of it is zero — which
          the driver also prints for a step this task&rsquo;s array is too short to cover, so
          &ldquo;never ran here&rdquo; and &ldquo;never accounted here&rdquo; look the same and this
          file cannot separate them.
        </p>
      ) : (
        <table className="mounts__table tis__table" aria-label={`Time at each frequency on cpu${policy.cpu}`}>
          <thead>
            <tr>
              <th scope="col">Frequency</th>
              <th scope="col">Time</th>
              <th scope="col">Share</th>
              <th scope="col">Ticks</th>
            </tr>
          </thead>
          <tbody>
            {policy.steps.map((step) => {
              const stepShare = total === 0 ? 0 : step.ticks / total;

              return (
                <tr
                  className={step === busiest ? 'tis__row tis__row--busiest' : 'tis__row'}
                  key={step.khz}
                >
                  <th scope="row" className="tis__freq">
                    {formatFrequency(step.khz)}
                    <span className="tis__khz muted">{step.khz} kHz</span>
                  </th>
                  <td className="tis__value">
                    {step.ticks === 0 ? <span className="muted">none</span> : formatDuration(ticksToSeconds(step.ticks))}
                  </td>
                  <td className="tis__share">
                    <span
                      className="tis__bar"
                      style={{ width: `${Math.round(stepShare * 100)}%` }}
                      aria-hidden="true"
                    />
                    <span className="tis__pct">{formatShare(stepShare)}</span>
                  </td>
                  <td className="tis__ticks muted">{step.ticks}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {mean !== null && canScale(policy) && (
        <p className="tis__mean muted" data-testid={`mean-cpu${policy.cpu}`}>
          Averaged <strong>{formatFrequency(mean)}</strong> here, weighted by the time at each step
          — a mean of this policy&rsquo;s steps only, since averaging across two clusters gives a
          number that describes neither.
          {top !== null && ` ${formatShare(top)} of it went at the top step.`}
        </p>
      )}

      {heavyAtTopStep(policy) && (
        <p className="notice notice--warn" role="status" data-testid={`top-step-cpu${policy.cpu}`}>
          <strong>
            {formatShare(topStepShare(policy)!)} of this task&rsquo;s time on{' '}
            <code>cpu{policy.cpu}</code> went at {formatFrequency(policy.steps.at(-1)!.khz)}, its
            top step.
          </strong>{' '}
          That is the step that costs the most for what it delivers — power climbs faster than clock
          does — so it is the figure a battery question is asking this file for. Anything past{' '}
          {formatShare(TOP_STEP_HEAVY)} is worth a look; nothing here is a limit, and nothing fails
          at any level.
        </p>
      )}

      {!ascends(policy) && (
        <p className="notice notice--warn" role="status" data-testid={`unsorted-cpu${policy.cpu}`}>
          The steps of this policy do not climb. A cpufreq table is built in ascending order and
          printed in it, so something reassembled this file — the times above are read as they
          stand.
        </p>
      )}
    </div>
  );
}

/**
 * How long one task has run at each clock frequency — the per-task half of the
 * pair whose other half is `/proc/uid_time_in_state`, and the half whose layout
 * names the policy boundaries rather than leaving them to be inferred.
 */
export function PidTimeInStateView({ content }: { content: string }) {
  const info = useMemo(() => parsePidTimeInState(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  const note = (
    <p className="disks__note muted">
      This file comes from <code>drivers/cpufreq/cpufreq_times.c</code> and exists only where{' '}
      <code>CONFIG_CPU_FREQ_TIMES</code> is on — <strong>an Android kernel, in practice</strong>,
      since the per-app battery accounting above it is what wanted it. A machine without it has no
      file here at all rather than an empty one. Each <code>cpuN</code> line opens a{' '}
      <strong>frequency policy</strong>, and a frequency in kHz and a count follow for every step in
      it. Four things read wrong. <strong><code>cpu0</code> is a policy, not a core</strong>: the
      driver walks every possible CPU and prints a header the first time it meets a policy, skipping
      the CPUs that share one, so a four-plus-four machine prints <code>cpu0</code> and{' '}
      <code>cpu4</code> and the cores between them are never named — time under a header is time on
      any core of that cluster. <strong>It is one task, and this file is its main thread</strong>:
      the driver prints the array hanging off the one <code>task_struct</code> it was handed, which
      for <code>/proc/&lt;pid&gt;/</code> is the group leader — so unlike{' '}
      <code>/proc/&lt;pid&gt;/io</code> beside it, which sums the thread group,{' '}
      <strong>this does not add a process&rsquo;s threads together</strong>, and a heavily threaded
      app reads far idler here than it is. Its threads are under{' '}
      <code>/proc/&lt;pid&gt;/task/&lt;tid&gt;/time_in_state</code>, one file each.{' '}
      <strong>A zero is two answers</strong> — a step this task never ran at, and a step its array
      is too short to cover — and the driver prints the same <code>0</code> for both, where{' '}
      <code>/proc/uid_time_in_state</code> leaves an unaccounted column off the row instead. That is
      the one place the uid file is the more honest of the two; everywhere else this one is, because
      it <strong>names the policy boundaries</strong> that the uid file runs together into a single
      header with nothing marking the join. And <strong>the counts are clock ticks</strong>,{' '}
      <code>nsec_to_clock_t</code>, so hundredths of a second at the usual{' '}
      <code>{CLOCK_TICK} Hz</code> — the units of <code>/proc/stat</code>, not milliseconds. The
      file is mode 0444, and unlike the uid table it cannot be reset: a task&rsquo;s counts run from
      its first instruction to its last.
    </p>
  );

  if (isEmpty(info)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="empty">
          There is nothing in this file. A kernel with <code>CONFIG_CPU_FREQ_TIMES</code> always
          prints at least one <code>cpuN</code> header and its policy&rsquo;s steps, even where
          every count is zero — so an empty file means the backend could not read it. Switch to the
          raw view to see what the server returned.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      {info.malformed.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="malformed">
          {info.malformed.length === 1 ? 'A line here is' : `${info.malformed.length} lines here are`}{' '}
          neither a <code>cpuN</code> header nor a frequency and a count, which are the only two
          shapes this file has. Switch to the raw view to see what the server returned.
        </p>
      )}

      {info.orphans.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="orphans">
          {info.orphans.length === 1 ? 'A frequency line' : `${info.orphans.length} frequency lines`}{' '}
          came before any <code>cpuN</code> header, and the driver never writes one — every step it
          prints belongs to a policy it has just named. Whatever produced this file was not{' '}
          <code>cpufreq_times.c</code>.
        </p>
      )}

      {neverRan(info) && (
        <p className="notice" role="status" data-testid="never-ran">
          <strong>This task has not been accounted a single tick anywhere.</strong> That is two
          answers the file cannot separate: a task that genuinely has had no CPU — one that has just
          been forked, or has sat blocked its whole life — and one whose accounting array was never
          allocated or is too short to cover these steps, which the driver also prints as zeroes.{' '}
          <code>/proc/&lt;pid&gt;/stat</code> beside it says how much CPU the task has really had,
          which is what settles it.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="time on CPU" value={formatDuration(summary.seconds)} />
        <Stat label="clock ticks" value={String(summary.ticks)} />
        <Stat
          label={summary.policies === 1 ? 'frequency policy' : 'frequency policies'}
          value={summary.policies === 1 ? '1' : `${summary.used} of ${summary.policies} used`}
        />
        <Stat
          label="busiest policy"
          value={summary.busiest === null ? '—' : `cpu${summary.busiest.cpu}`}
        />
      </section>

      {info.policies.length > 1 && (
        <p className="notice" role="status" data-testid="policies">
          <strong>
            This machine has {info.policies.length} frequency policies, and the file names each one.
          </strong>{' '}
          A header opens a policy rather than a core: <code>cpu{info.policies[0]!.cpu}</code> is
          every core of that cluster, and the cores between it and{' '}
          <code>cpu{info.policies[1]!.cpu}</code> are not named at all.{' '}
          <code>/proc/uid_time_in_state</code> prints these same tables concatenated into one row
          with nothing marking the join, so a reader there has to infer the boundary from the
          frequencies dropping. Here it is stated.
        </p>
      )}

      {info.policies.map((policy) => (
        <PolicyCard key={`${policy.cpu}-${policy.index}`} info={info} policy={policy} />
      ))}

      {summary.used === 1 && info.policies.length > 1 && !neverRan(info) && (
        <p className="notice" role="status" data-testid="one-policy">
          <strong>
            Every tick this task has run went on <code>cpu{summary.busiest!.cpu}</code>.
          </strong>{' '}
          It has never been scheduled on the other{' '}
          {info.policies.length === 2 ? 'cluster' : 'clusters'} at all — the ordinary shape for
          something the scheduler keeps off the big cores, a background service or anything the
          governor has never found urgent. It is also what a task confined by its affinity or its
          cpuset looks like, and this file cannot tell you which.
        </p>
      )}

      {!neverRan(info) && (
        <p className="disks__note muted" data-testid="totals">
          <strong>{totalTicks(info)} ticks</strong> across every policy, which is{' '}
          {formatDuration(summary.seconds)} of CPU at {CLOCK_TICK} ticks to the second. That is this{' '}
          <em>task&rsquo;s</em> time and not its process&rsquo;s: threads are accounted separately
          and each has its own file under <code>task/</code>, so this figure is a floor for a
          multi-threaded process rather than its total.
        </p>
      )}

      {note}
    </>
  );
}
