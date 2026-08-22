import { useMemo } from 'react';
import { NOTHING, parseWchan, summarize } from '../lib/wchan';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function WchanView({ content }: { content: string }) {
  const wchan = useMemo(() => parseWchan(content), [content]);
  const summary = useMemo(() => summarize(wchan), [wchan]);

  const note = (
    <p className="disks__note muted">
      This is the kernel function the process is asleep in, printed with{' '}
      <code>%ps</code> — the address unwound off its kernel stack, resolved against{' '}
      <code>kallsyms</code>. It is what <code>ps</code> shows in its <code>WCHAN</code> column, and
      what turns &ldquo;the process is stuck&rdquo; into &ldquo;the process is waiting for a page to
      come back off a disk&rdquo;. Four things about it read wrong at first glance.{' '}
      <strong>There is no trailing newline</strong>: the kernel writes the symbol and stops, where{' '}
      <code>/proc/&lt;pid&gt;/comm</code> writes one after the name — so code that reads the two
      files the same way gets one of them wrong. <strong>
        <code>{NOTHING}</code> is three answers wearing one hat
      </strong>
      : the task is on a CPU, or it is not blocked anywhere worth naming, or{' '}
      <em>the reader is not allowed to look</em> — since Linux 4.0 this file needs the same access{' '}
      <code>ptrace</code> does, and a refusal is printed as <code>{NOTHING}</code> rather than
      raised as an error, which makes another user&rsquo;s process indistinguishable from a busy
      one. <strong>A running task has no answer at all</strong>, and since Linux 5.16 the kernel
      does not even try to unwind one, so a column that named something on an older kernel often
      does not on a new one. And <strong>the symbol is a sample rather than a fact</strong> — one
      frame, picked at the moment of the read, off a stack the task may already have left. Read it
      twice before believing it, and read <code>/proc/&lt;pid&gt;/stack</code> if the frame below
      matters. Each thread has its own:{' '}
      <code>/proc/&lt;pid&gt;/task/&lt;tid&gt;/wchan</code> is where a threaded process keeps the
      interesting answers, and this file is only the main thread&rsquo;s.{' '}
      <code>/proc/&lt;pid&gt;/stat</code> field 35 is the same thing as a raw address, zeroed since
      Linux 4.9 for a reader who may not ptrace the process — this is the file to read instead.
    </p>
  );

  if (summary.empty) {
    return (
      <>
        <p className="notice notice--warn" data-testid="empty">
          There is nothing in this file. A live process always has an answer here, even if that
          answer is <code>{NOTHING}</code> — so an empty one means the process is gone or the
          backend could not read it. Switch to the raw view to see what the server returned.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      {summary.uninterruptible && (
        <p className="notice notice--warn" role="status" data-testid="uninterruptible">
          This is the <strong>sleep that cannot be interrupted</strong> — <code>D</code> in{' '}
          <code>ps</code>. The process will not answer a signal, <code>SIGKILL</code> included,
          until whatever it is waiting for comes back, and it is <strong>counted in the load
          average</strong> while it waits. That is how a machine with idle CPUs shows a load of
          forty: the number counts tasks that are runnable <em>or</em> stuck here, and everything
          queued behind one slow device lands in this column together.
        </p>
      )}

      {summary.zero && (
        <p className="notice" role="status" data-testid="zero">
          <strong>
            The kernel has nothing to name, and <code>{NOTHING}</code> does not say which of three
            reasons it is.
          </strong>{' '}
          The task may be <strong>on a CPU right now</strong> — since Linux 5.16 the kernel does
          not attempt to unwind a task that is not blocked, and a process reading its own{' '}
          <code>wchan</code> is by definition running, so <code>/proc/self/wchan</code> is always
          this. It may be blocked somewhere with no frame worth naming. Or{' '}
          <strong>the read was refused</strong>: this file needs the same access{' '}
          <code>ptrace</code> does, and a reader without it gets <code>{NOTHING}</code> rather than
          an error — so another user&rsquo;s process looks exactly like a busy one from here.
        </p>
      )}

      {summary.unresolved && (
        <p className="notice notice--warn" role="status" data-testid="unresolved">
          This is an <strong>address rather than a symbol</strong>, which is what <code>%ps</code>{' '}
          prints when nothing resolves it: a kernel built without <code>CONFIG_KALLSYMS</code>, or
          a module whose symbols are not in the table. Before Linux 4.0 this file was{' '}
          <em>always</em> a number and <code>ps</code> did the lookup itself against{' '}
          <code>System.map</code>; since then the kernel does it, and a number here means the
          kernel could not.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="waiting in" value={summary.name} />
        <Stat
          label="which is"
          value={
            summary.zero
              ? 'nothing named'
              : summary.unresolved
                ? 'an unresolved address'
                : (summary.info?.kind ?? 'a wait this page has no note for')
          }
        />
        {!summary.zero && !summary.unresolved && (
          <Stat
            label="the sleep is"
            value={summary.uninterruptible ? 'uninterruptible' : 'interruptible'}
          />
        )}
      </section>

      <p className="models" data-testid="flags">
        {summary.uninterruptible && (
          <span
            className="chip chip--flag"
            title="D in ps: deaf to signals until the wait ends, and counted in the load average throughout"
          >
            D state
          </span>
        )}
        {summary.info?.idle === true && (
          <span
            className="chip chip--model"
            title="A kernel thread parked in its own main loop, which is where one rests rather than a sign of trouble"
          >
            idle kernel thread
          </span>
        )}
        {summary.module !== null && (
          <span
            className="chip chip--type"
            title="The symbol came out of a loadable module rather than the kernel itself, which is why %ps printed the module beside it"
          >
            in module <span className="count">{summary.module}</span>
          </span>
        )}
        {!summary.zero && !summary.unresolved && summary.info === null && (
          <span
            className="chip chip--model"
            title="One of the thousands of kernel functions this page keeps no note for — the name is the kernel's own, and /proc/kallsyms says where it lives"
          >
            no note for this symbol
          </span>
        )}
        {summary.terminated && (
          <span
            className="chip chip--flag"
            title="The kernel writes no newline after the symbol, so something between this page and the file has added one"
          >
            has a trailing newline
          </span>
        )}
      </p>

      {summary.info !== null && (
        <p className="notice" role="status" data-testid="waiting-on">
          Waiting on <strong>{summary.info.kind}</strong>. {summary.info.note}.
        </p>
      )}

      {!summary.zero && !summary.unresolved && !summary.uninterruptible && (
        <p className="disks__note muted" data-testid="inferred">
          The sleep is called interruptible here because of the family the symbol belongs to, which
          is an inference and not something this file records. Field 3 of{' '}
          <code>/proc/&lt;pid&gt;/stat</code> is where the state itself is —{' '}
          <code>S</code> against <code>D</code> — and it is the one to trust where the two
          disagree.
        </p>
      )}

      {note}
    </>
  );
}
