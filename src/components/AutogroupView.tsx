import { useMemo } from 'react';
import {
  DEFAULT_WEIGHT,
  describeWeight,
  isDefaultGroup,
  isReniced,
  isUnreadable,
  MAX_NICE,
  MIN_NICE,
  parseAutogroup,
  timesDefault,
  weightFor,
} from '../lib/autogroup';

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide === true ? 'stat ag__stat--wide' : 'stat'}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * One line, and the four things that read wrong about it: the number is not a
 * pid, the nice is the group's rather than the process's, an empty file is an
 * answer, and none of it says the scheduler is actually using the group.
 */
export function AutogroupView({ content }: { content: string }) {
  const autogroup = useMemo(() => parseAutogroup(content), [content]);
  const weight = autogroup.nice === null ? null : weightFor(autogroup.nice);
  const share = autogroup.nice === null ? null : describeWeight(autogroup.nice);

  const note = (
    <p className="disks__note muted">
      <code>setsid()</code> puts a task into a scheduling group of its own, and the scheduler
      divides CPU time between <em>groups</em> before dividing it inside one — so a{' '}
      <code>make -j64</code> in one terminal competes as one thing rather than sixty-four, and the
      video player in another terminal keeps its half. Every terminal, every login and every daemon
      that daemonises gets one, because each of those is a <code>setsid()</code>. Three things read
      wrong at first glance.{' '}
      <strong>The number is neither a pid nor a session id</strong>: it is a global counter the
      kernel bumps for each group it makes, never reused, so it only says which group — two
      processes showing the same one are competing with each other rather than with the rest of the
      machine, and that comparison is the whole use of it.{' '}
      <strong>
        <code>nice</code> here is the group&rsquo;s and not the process&rsquo;s
      </strong>{' '}
      — it is set by writing a number to this file, it scales the whole group against other groups,
      and it is unrelated to the process&rsquo;s own nice in field 19 of{' '}
      <code>/proc/&lt;pid&gt;/stat</code>: renicing a process does not touch this, and writing here
      does not touch that. The kernel takes {MIN_NICE} to {MAX_NICE}, wants privilege for a negative
      one, and answers <code>EAGAIN</code> to an unprivileged write more often than ten times a
      second, because the change takes global locks. And <strong>an empty file is an answer</strong>
      : a task that never called <code>setsid()</code> is still in{' '}
      <code>autogroup_default</code>, whose task group is the root one rather than an autogroup, so
      the kernel prints nothing at all for it.
    </p>
  );

  const caveat = (
    <p className="notice notice--warn" role="status" data-testid="caveat">
      <strong>This says which group the task has, never which one is deciding its CPU time.</strong>{' '}
      Nothing here changes when <code>/proc/sys/kernel/sched_autogroup_enabled</code> goes to 0:{' '}
      <code>setsid()</code> still makes the group and this file still prints it, and only{' '}
      <code>autogroup_task_group</code> consults the sysctl. The same goes for a task in a non-root
      CPU cgroup — <code>task_wants_autogroup</code> returns false for one — so on a machine where
      the <code>cpu</code> controller is enabled over the user&rsquo;s slice, the group named here
      is ignored in favour of the cgroup. Both cases look exactly like this page.
    </p>
  );

  if (isDefaultGroup(autogroup)) {
    return (
      <>
        <section className="summary" data-testid="summary">
          <Stat label="autogroup" value="default" />
          <Stat label="group nice" value="—" />
          <Stat label="bytes" value={String(autogroup.bytes)} />
        </section>

        <p className="notice" role="status" data-testid="default-group">
          <strong>
            This task is in <code>autogroup_default</code>, so there is nothing to print.
          </strong>{' '}
          It has never called <code>setsid()</code>, and that is the only thing that puts a task
          into an autogroup — so it sits in the root task group, which is not an autogroup, and{' '}
          <code>proc_sched_autogroup_show_task</code> returns without writing a byte. Kernel threads
          read like this, and so does pid 1: <code>autogroup_init</code> puts the init task in the
          default group at boot and it cannot leave by calling <code>setsid()</code>, because it
          already leads its session. An empty file here is the ordinary answer for those, not a
          fault and not a permission problem.
        </p>

        {note}
      </>
    );
  }

  if (isUnreadable(autogroup)) {
    return (
      <>
        <p className="notice notice--warn" data-testid="unreadable">
          This file does not hold an autogroup line. The kernel writes{' '}
          <code>/autogroup-&lt;n&gt; nice &lt;n&gt;</code> and nothing else, so whatever is here
          came from somewhere else — switch to the raw view to see it.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="autogroup" value={String(autogroup.id)} />
        <Stat label="group nice" value={String(autogroup.nice)} />
        <Stat label="scheduler weight" value={weight === null ? '—' : String(weight)} />
        <Stat label="against a default group" value={share ?? '—'} wide={true} />
      </section>

      <div className="card ag__line" data-testid="line">
        <p className="ag__name">
          <code>{autogroup.name}</code>
        </p>
        <p className="ag__reading muted">
          Everything in this task&rsquo;s session is in group{' '}
          <strong>{autogroup.id}</strong> with it, competing for one share of the machine between
          them. Another process showing <code>{autogroup.name}</code> is in that session; one
          showing any other number is somewhere else and competes with this group rather than
          inside it.
        </p>
      </div>

      {isReniced(autogroup) ? (
        <p className="notice" role="status" data-testid="reniced">
          <strong>Something has written to this file.</strong> A group at nice{' '}
          {autogroup.nice} carries a scheduler weight of {weight}, against {DEFAULT_WEIGHT} for a
          group nobody has touched — {share}. Where this group and a default one are both asking for
          the CPU, that is the ratio their shares are in
          {timesDefault(autogroup.nice!)! < 1
            ? ', which is what pushing a whole build session into the background looks like'
            : ', which is a whole session given priority over the rest of the machine'}
          . Every process in the session moves together: the weight is the group&rsquo;s, so nothing
          inside it changes rank.
        </p>
      ) : (
        <p className="notice" role="status" data-testid="untouched">
          <strong>Nothing has written to this file.</strong> A group starts at nice 0 with a weight
          of {DEFAULT_WEIGHT}, which is what every other untouched group on the machine has, so this
          session gets an equal share against each of them — however many processes it happens to
          hold.
        </p>
      )}

      {!autogroup.terminated && (
        <p className="notice notice--warn" role="status" data-testid="unterminated">
          This file does not end with a newline. <code>proc_sched_autogroup_show_task</code> prints
          one after the line, so something in between has been trimming the answer.
        </p>
      )}

      {caveat}
      {note}
    </>
  );
}
