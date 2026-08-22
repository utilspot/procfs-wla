import { useMemo, useState } from 'react';
import {
  capabilityName,
  CAP_SYS_ADMIN,
  decodeField,
  describeField,
  formatBytes,
  formatCount,
  ID_KINDS,
  parseStatus,
  SECCOMP_MODES,
  signalName,
  summarize,
  type StatusEntry,
} from '../lib/status';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function FieldRow({ entry }: { entry: StatusEntry }) {
  const info = describeField(entry.name);
  const decoded = decodeField(entry.name, entry.value);

  return (
    <tr className={info === null ? 'pstatus__row pstatus__row--unknown' : 'pstatus__row'}>
      <td className="pstatus__field">{entry.name}</td>
      <td className="pstatus__raw">
        {entry.value === '' ? (
          <span className="muted">—</span>
        ) : (
          // The width cap lives on this box rather than on the cell, since a
          // cell's max-width is not honoured under automatic table layout.
          <span className="pstatus__printed">{entry.value}</span>
        )}
      </td>
      <td className="pstatus__value">{decoded ?? <span className="muted">—</span>}</td>
      <td className="pstatus__note">
        {info === null ? (
          <span className="muted">A line this page has no note for</span>
        ) : (
          <>
            {info.note}
            {info.since !== undefined && (
              <>
                {' '}
                <span className="chip chip--type" title={`Not printed by a kernel before ${info.since}`}>
                  since {info.since}
                </span>
              </>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

export function StatusView({ content }: { content: string }) {
  const status = useMemo(() => parseStatus(content), [content]);
  const summary = useMemo(() => summarize(status), [status]);
  const [hideUnknown, setHideUnknown] = useState(false);

  if (status.entries.length === 0) {
    return (
      <p className="notice notice--warn" data-testid="unreadable">
        Nothing here reads as this file. Every line of it is a label, a colon and a value. Switch to
        the raw view to see what the server returned.
      </p>
    );
  }

  const visible = hideUnknown
    ? status.entries.filter((entry) => describeField(entry.name) !== null)
    : status.entries;

  const handlesTerm = summary.caught.includes(15);

  return (
    <>
      {summary.setuid && summary.uid !== null && (
        <p className="notice notice--warn" role="status" data-testid="setuid">
          <strong>
            This process is running as uid {summary.uid.effective}, and was started by uid{' '}
            {summary.uid.real}.
          </strong>{' '}
          That is a setuid binary in flight, and this file is the only place in <code>/proc</code>{' '}
          that says so plainly. The <em>effective</em> id is what every access check uses; the{' '}
          <em>saved set</em> id, {summary.uid.saved} here, is what lets it drop the privilege
          temporarily and pick it back up.
        </p>
      )}

      {summary.tracer !== null && summary.tracer !== 0 && (
        <p className="notice notice--warn" role="status" data-testid="tracer">
          <strong>Process {summary.tracer} is tracing this one.</strong> A <code>ptrace</code>{' '}
          attachment is how a debugger and <code>strace</code> work, and it is also how one process
          reads another&rsquo;s memory — so on a machine where nothing should be debugging anything,
          this line is worth an answer.
        </p>
      )}

      {summary.namespaceInit && (
        <p className="notice" role="status" data-testid="namespace-init">
          <strong>This process is pid 1 inside its own namespace</strong> — {summary.pid} as seen
          from out here. The kernel treats a namespace&rsquo;s pid 1 specially:{' '}
          <strong>a signal it has installed no handler for is discarded</strong> rather than taking
          its default action.{' '}
          {handlesTerm ? (
            <>
              It does handle <code>SIGTERM</code>, so a stop will reach it.
            </>
          ) : (
            <>
              It has <strong>no handler for <code>SIGTERM</code></strong>, so a stop sent to this
              container does nothing at all — and ten seconds later something sends{' '}
              <code>SIGKILL</code>, which is the one signal this rule does not cover.
            </>
          )}
        </p>
      )}

      {summary.state?.letter === 'D' && (
        <p className="notice notice--warn" role="status" data-testid="uninterruptible">
          This process is in <strong>uninterruptible sleep</strong> — waiting inside the kernel
          with signals turned off. It cannot be killed while it is there, not even with{' '}
          <code>SIGKILL</code>. <code>/proc/&lt;pid&gt;/wchan</code> names the function it is
          waiting in.
        </p>
      )}

      {summary.state?.letter === 'Z' && (
        <p className="notice notice--warn" role="status" data-testid="zombie">
          This process has <strong>exited and not been reaped</strong>. Its memory is gone and only
          the accounting is left, waiting for the parent to call <code>wait()</code>.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="name" value={summary.name ?? '—'} />
        <Stat
          label="state"
          value={summary.state === null ? '—' : (summary.state.name || summary.state.letter)}
        />
        <Stat label="threads" value={summary.threads === null ? '—' : formatCount(summary.threads)} />
        <Stat
          label="resident"
          value={summary.rssBytes === null ? '—' : formatBytes(summary.rssBytes)}
        />
      </section>

      <p className="models" data-testid="flags">
        <span className="chip chip--model" title="This process, and the one that started it">
          pid <span className="count">{summary.pid ?? '—'}</span> · ppid{' '}
          <span className="count">{summary.ppid ?? '—'}</span>
        </span>
        {summary.uid !== null && (
          <span
            className={summary.setuid ? 'chip chip--flag' : 'chip chip--model'}
            title={ID_KINDS.map(
              (kind, index) =>
                `${kind} ${[summary.uid!.real, summary.uid!.effective, summary.uid!.saved, summary.uid!.filesystem][index]}`,
            ).join(', ')}
          >
            uid <span className="count">{summary.uid.effective}</span>
            {summary.setuid && <> from {summary.uid.real}</>}
          </span>
        )}
        {summary.fullCapabilities && (
          <span
            className="chip chip--flag"
            title="An unbroken run of every capability the kernel has, which is what a process running as real root holds"
          >
            all capabilities
          </span>
        )}
        {summary.atCeiling && (
          <span
            className="chip chip--type"
            title="Everything its bounding set allows, and the bounding set is not everything — a process holding all the privilege something else decided to leave it"
          >
            at its bounding ceiling
          </span>
        )}
        {!summary.fullCapabilities && summary.sysAdmin && (
          <span
            className="chip chip--flag"
            title={`${capabilityName(CAP_SYS_ADMIN)} is roughly a third of every capability check in the kernel, and much of what it allows leads back to full root`}
          >
            CAP_SYS_ADMIN
          </span>
        )}
        {summary.effective === 0n && (
          <span
            className="chip chip--model"
            title="An empty effective set: whatever uid this runs as, the kernel grants it nothing beyond an ordinary user's rights"
          >
            no capabilities
          </span>
        )}
        {summary.depth > 1 && (
          <span
            className="chip chip--type"
            title="The NS lines carry one entry per namespace the process is nested in, outermost first"
          >
            pid <span className="count">{summary.innerPid}</span> inside its namespace
          </span>
        )}
        {summary.seccomp !== null && summary.seccomp !== 0 && (
          <span className="chip chip--type" title={SECCOMP_MODES[summary.seccomp]}>
            seccomp mode <span className="count">{summary.seccomp}</span>
          </span>
        )}
        {summary.noNewPrivs && (
          <span
            className="chip chip--type"
            title="No execve from here can ever gain privilege — setuid bits are inert for this process and everything it starts, and it can never be unset"
          >
            no_new_privs
          </span>
        )}
        {summary.swapBytes !== null && summary.swapBytes > 0 && (
          <span
            className="chip chip--flag"
            title="Anonymous memory written out to swap. Shared memory swapped out is not counted here"
          >
            swapped <span className="count">{formatBytes(summary.swapBytes)}</span>
          </span>
        )}
        {summary.pendingShared.length > 0 && (
          <span
            className="chip chip--flag"
            title="Pending for the process as a whole — sent, and not yet taken by any thread"
          >
            pending {summary.pendingShared.map(signalName).join(' ')}
          </span>
        )}
      </p>

      {summary.nonvoluntary !== null && summary.voluntary !== null && (
        <p className="disks__note muted" data-testid="switches">
          It has given up a CPU <strong>{formatCount(summary.voluntary)}</strong> times because it
          had something to wait for, and been <strong>taken off one {formatCount(summary.nonvoluntary)}</strong>{' '}
          times while it still wanted it. The second number running with the first is a machine
          short of CPU; the first alone is a process doing what processes do.
        </p>
      )}

      <label className="mounts__filter">
        <input
          type="checkbox"
          checked={hideUnknown}
          onChange={(event) => setHideUnknown(event.target.checked)}
        />
        Hide the lines this page has no note for ({summary.unknown.length} of {summary.count})
      </label>

      <div className="card mounts pstatus">
        <table className="mounts__table pstatus__table" aria-label="Status fields">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">As printed</th>
              <th scope="col">Which is</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <FieldRow key={`${entry.name}-${entry.line}`} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        This is everything <code>/proc/&lt;pid&gt;/stat</code> holds and a good deal it cannot
        express, in a form meant to be read — but five of the most interesting lines are{' '}
        <strong>encodings rather than values</strong>.{' '}
        <strong>
          <code>Uid</code> and <code>Gid</code> are four ids each
        </strong>{' '}
        — real, effective, saved-set and filesystem — and a real that differs from an effective is
        a setuid binary running right now. <strong>The signal fields are 64-bit hex masks where
        bit <em>n</em> stands for signal <em>n+1</em></strong>, which is the off-by-one everything
        reading them gets wrong once; <code>SigPnd</code> is pending for <em>this thread</em> and{' '}
        <code>ShdPnd</code> for <em>the whole process</em>, which is where a signal from{' '}
        <code>kill(2)</code> lands. <strong>The <code>Cap</code> lines are capability bitmaps</strong>,
        and holding uid 0 is not the same as holding them — a daemon that dropped its capabilities
        keeps uid 0 and an empty <code>CapEff</code>, while <code>CapBnd</code> is a ceiling that
        only ever shrinks. <strong>
          <code>FDSize</code> is not the number of open file descriptors
        </strong>{' '}
        but the capacity of the table, rounded to a power of two and never shrunk; counting{' '}
        <code>/proc/&lt;pid&gt;/fd</code> is the only way to the real figure. And{' '}
        <strong>the <code>NS</code> lines are lists</strong>, one entry per namespace the process
        is nested in, outermost first. Two more things to hold on to:{' '}
        <code>VmRSS</code> counts a shared page in full for every process sharing it, so summing it
        across processes overcounts — that is what <code>/proc/&lt;pid&gt;/smaps</code> keeps PSS
        for. And the signal numbers above are the ones nearly every architecture uses; alpha, mips
        and sparc number some of them differently, and this file gives no clue which it is.
      </p>
    </>
  );
}
