import { useMemo } from 'react';
import {
  CONTENDED,
  DISABLED,
  FIELDS,
  formatCount,
  formatNs,
  formatShare,
  isAllZero,
  isChatty,
  isContended,
  isEmpty,
  isUnreadable,
  parsePidSchedStat,
  SHORT_SLICE_NS,
  summarize,
  SWITCH,
  waitShare,
  wantedNs,
  type TaskSchedStat,
} from '../lib/pid-schedstat';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The value of one column, in the units that column is in. */
function valueOf(stat: TaskSchedStat, column: number): string {
  if (column === 1) return formatNs(stat.runtimeNs);
  if (column === 2) return formatNs(stat.waitNs);
  return formatCount(stat.slices);
}

/** The raw number underneath, since these are counters and the digits matter. */
function rawOf(stat: TaskSchedStat, column: number): string {
  const raw = column === 1 ? stat.runtimeNs : column === 2 ? stat.waitNs : stat.slices;
  return `${formatCount(raw)}${column === 3 ? '' : ' ns'}`;
}

/**
 * Three numbers, of which the second is the one worth reading — and the one
 * nobody looks at.
 */
export function PidSchedStatView({ content }: { content: string }) {
  const stat = useMemo(() => parsePidSchedStat(content), [content]);
  const summary = useMemo(() => summarize(stat), [stat]);
  const share = waitShare(stat);

  const note = (
    <p className="disks__note muted">
      Not <code>/proc/schedstat</code>, the machine&rsquo;s per-CPU counters — this is one task&rsquo;s.{' '}
      <code>proc_pid_schedstat</code> prints <code>sum_exec_runtime</code>,{' '}
      <code>run_delay</code> and <code>pcount</code>: time <strong>on</strong> a CPU, time{' '}
      <strong>runnable and not on one</strong>, and how many times it was <strong>put on</strong>{' '}
      one. Five things read wrong.{' '}
      <strong>The second number is the one worth reading</strong> — it is time this task was ready
      to run and did not get a CPU, not blocked and not asleep but queued behind something else,
      which is the direct measure of whether a machine is oversubscribed and a question the first
      number cannot answer however long you stare at it.{' '}
      <strong>
        <code>{DISABLED}</code> is two different answers
      </strong>
      : the kernel prints that line verbatim when <code>sched_info_on()</code> is false, so it means
      &ldquo;this task never ran&rdquo; <em>or</em> &ldquo;this kernel is not collecting&rdquo; —
      and since Linux 4.6 the collecting is a runtime switch, <code>{SWITCH}</code>, off by default
      on some distributions. <strong>These are nanoseconds, and{' '}
      <code>/proc/&lt;pid&gt;/stat</code> is not</strong>: that file&rsquo;s <code>utime</code> and{' '}
      <code>stime</code> are clock ticks kept by a different mechanism, so the two measure nearly
      the same thing and need not agree exactly.{' '}
      <strong>It is one task, and this file is its main thread</strong> — the counters hang off the
      single <code>task_struct</code> the pid resolves to, so like{' '}
      <code>/proc/&lt;pid&gt;/time_in_state</code> and unlike <code>/proc/&lt;pid&gt;/io</code>,
      this does not sum a process&rsquo;s threads; theirs are under{' '}
      <code>task/&lt;tid&gt;/schedstat</code>. And{' '}
      <strong>the third number is not context switches</strong>: it counts the times this task was
      scheduled <em>onto</em> a CPU, so it says how the runtime was broken up rather than how busy
      the machine was. The file is mode 0444, needs <code>CONFIG_SCHEDSTATS</code>, and every
      counter is cumulative from the task&rsquo;s first instruction.
    </p>
  );

  if (isEmpty(stat)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="empty">
          There is nothing in this file. Every task on a kernel with{' '}
          <code>CONFIG_SCHEDSTATS</code> has three numbers here — <code>{DISABLED}</code> at the
          least — so an empty file means the backend could not read it. Switch to the raw view to
          see what the server returned.
        </p>
        {note}
      </>
    );
  }

  if (isUnreadable(stat)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="unreadable">
          This file does not hold a line of numbers. <code>proc_pid_schedstat</code> prints three
          unsigned counters separated by spaces and nothing else, so whatever is here came from
          somewhere else — switch to the raw view to see it.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      {isAllZero(stat) && (
        <p className="notice notice--warn" role="status" data-testid="all-zero">
          <strong>
            <code>{DISABLED}</code> is two answers, and this file cannot tell you which.
          </strong>{' '}
          <code>proc_pid_schedstat</code> prints that line <em>verbatim</em> when{' '}
          <code>sched_info_on()</code> is false, so either this task has genuinely never been on a
          CPU, or <strong>the kernel is not collecting any of this</strong> — a runtime switch,{' '}
          <code>{SWITCH}</code>, which some distributions leave off. The tell is another process:
          read any busy one&rsquo;s <code>schedstat</code>, and if it is zeroes too then it is the
          switch rather than the task. <code>/proc/schedstat</code> beside it is the other half of
          the answer, its per-CPU counters being zero for the same reason.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="on a CPU" value={formatNs(stat.runtimeNs)} />
        <Stat label="waiting for one" value={formatNs(stat.waitNs)} />
        <Stat
          label="of wanted CPU time, spent waiting"
          value={share === null ? '—' : formatShare(share)}
        />
        <Stat label="turns on a CPU" value={formatCount(stat.slices)} />
      </section>

      <div className="card mounts sched">
        <table className="mounts__table sched__table" aria-label="Scheduler counters">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Value</th>
              <th scope="col">What it counts</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((field) => (
              <tr
                className={field.column === 2 ? 'sched__row sched__row--key' : 'sched__row'}
                key={field.name}
              >
                <th scope="row" className="sched__name">
                  <span className="sched__col">{field.column}</span>
                  <span className="sched__key">{field.name}</span>
                  <span className="sched__label muted">{field.label}</span>
                </th>
                <td className="sched__value">
                  {valueOf(stat, field.column)}
                  <span className="sched__raw muted">{rawOf(stat, field.column)}</span>
                </td>
                <td className="sched__what muted">{field.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isAllZero(stat) && share !== null && (
        <p
          className={isContended(stat) ? 'notice notice--warn' : 'notice'}
          role="status"
          data-testid="wait-share"
        >
          <strong>
            {formatShare(share)} of the time this task wanted a CPU, it spent queued for one.
          </strong>{' '}
          It wanted {formatNs(wantedNs(stat))} altogether and got {formatNs(stat.runtimeNs)} of it.{' '}
          {isContended(stat) ? (
            <>
              Past {formatShare(CONTENDED)} the queue is the answer to why something is slow rather
              than background noise: this task is not waiting on a disk or a lock — those are
              elsewhere — it is <strong>ready to run and there is no CPU free</strong>. Nothing
              fails at any level, and there is no kernel threshold here to have crossed.
            </>
          ) : (
            <>
              That is the scheduler doing its job: some waiting is unavoidable on any machine with
              more runnable tasks than CPUs, and at this share the queue is not what is slowing this
              task down.
            </>
          )}
        </p>
      )}

      {summary.averageSliceNs !== null && (
        <p className="notice" role="status" data-testid="averages">
          <strong>
            {formatNs(summary.averageSliceNs)} on a CPU each turn, after{' '}
            {formatNs(summary.averageWaitNs!)} of waiting for it.
          </strong>{' '}
          That second figure is the one to hold against <code>/proc/schedstat</code>, which reports
          exactly the same thing per CPU — a task waiting far longer per turn than the CPUs it runs
          on average is a task the scheduler is treating differently from its neighbours, whether by
          priority, by cgroup weight or by affinity.
        </p>
      )}

      {isChatty(stat) && (
        <p className="notice" role="status" data-testid="chatty">
          <strong>
            Turns this short mean the scheduling costs more than the work.
          </strong>{' '}
          {formatCount(stat.slices)} turns of {formatNs(summary.averageSliceNs!)} each — under{' '}
          {formatNs(SHORT_SLICE_NS)} — is a task that wakes, does almost nothing and blocks again:
          an interrupt handler thread, a chatty event loop, something polling a descriptor that is
          rarely ready. The runtime is small because there is little work, not because it is being
          starved, and the third column is where that shows.
        </p>
      )}

      {!stat.complete && (
        <p className="notice notice--warn" role="status" data-testid="short">
          <strong>This line has {stat.value.split(/\s+/).length} of the three counters.</strong>{' '}
          The kernel writes all three every time, so something between here and it truncated the
          line. Anything missing is counted as zero above.
        </p>
      )}

      {stat.extra.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="extra">
          <strong>
            This line has {stat.extra.length} more{' '}
            {stat.extra.length === 1 ? 'number' : 'numbers'} than the three this file holds.
          </strong>{' '}
          <code>proc_pid_schedstat</code> prints three and stops, so the extra is not a newer
          kernel&rsquo;s field. It is shown in the raw view and counted nowhere above.
        </p>
      )}

      {!stat.terminated && (
        <p className="notice notice--warn" role="status" data-testid="unterminated">
          This file does not end with a newline. <code>proc_pid_schedstat</code> writes one after
          the third counter, so something in between has been trimming the answer.
        </p>
      )}

      {note}
    </>
  );
}
