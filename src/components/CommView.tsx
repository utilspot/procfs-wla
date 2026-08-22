import { useMemo } from 'react';
import { COMM_MAX, parseComm, summarize } from '../lib/comm';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function CommView({ content }: { content: string }) {
  const thread = useMemo(() => parseComm(content), [content]);
  const summary = useMemo(() => summarize(thread), [thread]);

  if (summary.empty) {
    return (
      <p className="notice notice--warn" data-testid="empty">
        There is no name in this file. Every thread has one — it is set from the program&rsquo;s
        own name before it ever runs — so an empty answer means the thread is gone or the backend
        could not read it. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.control && (
        <p className="notice notice--error" role="alert" data-testid="control">
          This name holds a character a terminal will not print. <code>prctl</code> accepts
          anything but a NUL and a newline, so a name can carry escape sequences — which is worth
          knowing before pasting it into a shell or trusting it in a log.
        </p>
      )}

      {summary.kernel !== null && (
        <p className="notice" role="status" data-testid="kernel">
          This is a <strong>kernel thread</strong> — a {summary.kernel.kind}.{' '}
          {summary.kernel.note}. It has a name here and{' '}
          <strong>no <code>/proc/&lt;pid&gt;/cmdline</code> at all</strong>, which is how the two
          kinds of task are told apart: a kernel thread was never given arguments, because it was
          never <code>execve</code>d.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="name" value={summary.name} />
        <Stat
          label="characters"
          value={summary.synthesised ? String(summary.length) : `${summary.length} of ${COMM_MAX}`}
        />
        <Stat label="is" value={summary.kernel === null ? 'a thread name' : summary.kernel.kind} />
      </section>

      <p className="models" data-testid="flags">
        {summary.truncated && (
          <span
            className="chip chip--flag"
            title={`The kernel keeps ${COMM_MAX} characters of a name and no flag saying it cut one, so a name of exactly that length may be the front of a longer one`}
          >
            at the {COMM_MAX}-character cap
          </span>
        )}
        {summary.synthesised && (
          <span
            className="chip chip--model"
            title={`Longer than the ${COMM_MAX} characters a task can store, so the kernel built this name when the file was read rather than returning the stored one`}
          >
            built at read time
          </span>
        )}
        {summary.kernel?.detail !== undefined && (
          <span className="chip chip--model" title="What this thread’s name encodes">
            {summary.kernel.detail}
          </span>
        )}
        {summary.spaces && (
          <span className="chip chip--model" title="Allowed, and more common than it looks">
            holds spaces
          </span>
        )}
        {summary.parentheses && (
          <span
            className="chip chip--model"
            title="Allowed here, and the reason reading this same name out of /proc/<pid>/stat takes care — that file wraps it in these"
          >
            holds parentheses
          </span>
        )}
        {!summary.terminated && (
          <span
            className="chip chip--flag"
            title="No newline after the name, where the kernel always writes one"
          >
            no trailing newline
          </span>
        )}
      </p>

      {summary.truncated && (
        <p className="notice notice--warn" role="status" data-testid="truncated">
          This name is <strong>exactly {COMM_MAX} characters</strong>, which is the cap on a name
          a task stores. The kernel keeps no flag saying it cut one, so there is no telling from
          here whether this is the whole name or the front of a longer one —{' '}
          <code>pool-2-thread-1</code> from a Java thread pool and <code>Isolated Web Co</code>{' '}
          from a browser are both the second kind. <code>/proc/&lt;pid&gt;/cmdline</code> is where
          the untruncated program name is.
        </p>
      )}

      <p className="disks__note muted">
        This is the same string as field 2 of <code>/proc/&lt;pid&gt;/stat</code>, and{' '}
        <strong>this is the file to read it from</strong>: <code>stat</code> wraps the name in
        parentheses, which the name itself may contain, so getting it back out of that line takes
        care that getting it out of this one does not. Three things about it are easy to get wrong.{' '}
        <strong>A stored name is capped at {COMM_MAX} characters</strong> with nothing to say when
        one was cut — though a <em>longer</em> name here is not a contradiction: for a workqueue
        worker, and on a 6.x kernel for any kernel thread, the kernel assembles this string when
        the file is read instead of returning the 16 bytes the task stores, which is how a name
        like <code>kworker/u29:2-events_freezable_pwr_efficient</code> comes out of a field 16
        bytes wide. <strong>It belongs to a thread, not a process</strong> —{' '}
        <code>/proc/&lt;pid&gt;/comm</code> is the main thread&rsquo;s, and{' '}
        <code>/proc/&lt;pid&gt;/task/&lt;tid&gt;/comm</code> is each other one&rsquo;s, which is why{' '}
        <code>top -H</code> shows names the process never had. And{' '}
        <strong>it is writable</strong>, one of very few files under <code>/proc/&lt;pid&gt;</code>{' '}
        that are: <code>echo something &gt; /proc/self/comm</code> renames the thread. So this is
        what a process <em>calls itself</em> rather than what it is —{' '}
        <code>/proc/&lt;pid&gt;/cmdline</code> can be rewritten too, and{' '}
        <code>/proc/&lt;pid&gt;/exe</code> is the one answer here that cannot. The trailing newline
        is the kernel&rsquo;s and not part of the name, which is the bug this file is famous for.
      </p>
    </>
  );
}
