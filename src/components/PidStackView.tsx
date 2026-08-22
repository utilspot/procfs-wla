import { useMemo } from 'react';
import {
  describeFrame,
  formatOffset,
  isEmpty,
  leakedAddresses,
  MAX_DEPTH,
  parsePidStack,
  PLACEHOLDER,
  roleOf,
  summarize,
  waitFrame,
  type Frame,
  type FrameRole,
} from '../lib/pid-stack';

/** What each role is called in the table, and what it is doing there. */
const ROLE: Record<FrameRole, { label: string; title: string }> = {
  scheduler: {
    label: 'scheduler',
    title: 'A __sched function — the frames get_wchan skips over to find the wait worth naming',
  },
  wait: { label: 'the wait', title: 'The frame that says what this task is actually waiting for' },
  syscall: { label: 'system call', title: 'The call the task came in through, by name' },
  entry: { label: 'entry', title: 'Where control crossed into the kernel' },
  kthread: { label: 'kernel thread', title: 'A kernel thread’s own main loop — there is no userspace under this' },
  other: { label: '', title: '' },
};

function FrameRow({ frame, waiting }: { frame: Frame; waiting: Frame | null }) {
  const role = roleOf(frame);
  const info = describeFrame(frame);
  const offset = formatOffset(frame);
  const isWait = waiting !== null && frame.depth === waiting.depth;

  return (
    <tr className={isWait ? 'stack__row stack__row--wait' : 'stack__row'}>
      <td className="stack__depth">{frame.depth}</td>
      <td className="stack__bracket muted">
        <code>[&lt;{frame.bracket}&gt;]</code>
      </td>
      <th scope="row" className="stack__symbol">
        <span className="stack__name">{frame.name}</span>
        {offset !== null && <span className="stack__offset muted">{offset}</span>}
        {frame.module !== null && <span className="chip chip--type">{frame.module}</span>}
      </th>
      <td className="stack__role">
        {role !== 'other' && (
          <span className={`chip stack__chip--${role}`} title={ROLE[role].title}>
            {ROLE[role].label}
          </span>
        )}
        {isWait && (
          <span className="chip chip--flag" title="The frame /proc/<pid>/wchan would name">
            wchan
          </span>
        )}
      </td>
      <td className="stack__what muted">{info?.note ?? ''}</td>
    </tr>
  );
}

/**
 * One task's kernel stack — the fullest of the three answers `/proc` gives to
 * where a process is, and the one whose brackets are famously empty.
 */
export function PidStackView({ content }: { content: string }) {
  const stack = useMemo(() => parsePidStack(content), [content]);
  const summary = useMemo(() => summarize(stack), [stack]);
  const waiting = useMemo(() => waitFrame(stack), [stack]);
  const leaked = useMemo(() => leakedAddresses(stack), [stack]);

  const note = (
    <p className="disks__note muted">
      This is the <strong>fullest of three answers</strong> <code>/proc</code> gives to where a
      process is, and the other two sit beside it: <code>/proc/&lt;pid&gt;/wchan</code> names{' '}
      <em>one</em> frame of this chain, <code>/proc/&lt;pid&gt;/syscall</code> names the call it
      came in through, and all three come off the same unwind. Five things read wrong.{' '}
      <strong>
        <code>[&lt;0&gt;]</code> is a literal zero, not an address
      </strong>{' '}
      — the format string in <code>proc_pid_stack</code> is{' '}
      <code>&quot;[&lt;0&gt;] %pB\n&quot;</code>, with the zero typed into it. Older kernels printed
      the real return address there, which is why the brackets exist at all; printing it defeated
      KASLR, so the value went and the brackets stayed. <strong>Innermost first</strong>: the top
      line is where the task is <em>now</em> and the bottom is how it got into the kernel, so a
      reader taking the first line as the entry point has the chain upside down.{' '}
      <strong>The offsets are already corrected</strong> — <code>%pB</code> is the{' '}
      <em>backtrace</em> spelling of <code>%pS</code>, and it looks each address up after
      subtracting one, because a return address points at the instruction <em>after</em> the call
      and a call in the last byte of a function would otherwise resolve to the next function
      entirely. <strong>It is a racy sample</strong>: the comment above the function says as much —
      unwinding a <em>running</em> task is unsound and can produce frames that were never on the
      stack together, so this is trustworthy for a task that is asleep and not much else. And{' '}
      <strong>reading it from your own process shows you the read</strong>, since the unwinder runs
      in the reader. The file needs <code>CONFIG_STACKTRACE</code>, is mode <strong>0400</strong>,
      and is guarded by <code>lock_trace</code>, which demands{' '}
      <code>PTRACE_MODE_ATTACH_FSCREDS</code> — <strong>stricter</strong> than the{' '}
      <code>PTRACE_MODE_READ</code> behind <code>io</code> and <code>environ</code>. A refusal is{' '}
      <code>EPERM</code>, the 403 this page reports; a task whose kernel stack has already been
      freed is <code>ENOENT</code>, the 404. At most {MAX_DEPTH} frames are ever printed.
    </p>
  );

  if (isEmpty(stack)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="empty">
          There is nothing in this file. An unwind that finds no frames prints nothing rather than
          failing, which happens for a task caught <strong>running on another CPU</strong> — the
          same state <code>/proc/&lt;pid&gt;/syscall</code> prints as <code>running</code> and{' '}
          <code>wchan</code> as <code>0</code>. It is also what the backend returns if it could read
          the file but the kernel had nothing to say.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      {stack.malformed.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="malformed">
          {stack.malformed.length === 1 ? 'A line here is' : `${stack.malformed.length} lines here are`}{' '}
          not a frame. Every line this file holds is a bracket and a symbol, so switch to the raw
          view to see what the server returned.
        </p>
      )}

      {leaked.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="leaked">
          <strong>
            {leaked.length === 1
              ? 'A bracket here holds a kernel address rather than the frozen zero.'
              : `${leaked.length} brackets here hold kernel addresses rather than the frozen zero.`}
          </strong>{' '}
          <code>proc_pid_stack</code> types <code>0</code> into its format string, so a real address
          means an older kernel, or one whose <code>kptr_restrict</code> lets addresses through.
          Either way these are <strong>kernel text addresses on display</strong>, and with KASLR
          that is the offset the whole kernel was loaded at — the one thing the placeholder exists
          to withhold.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="frames" value={String(summary.frames)} />
        <Stat
          label={summary.sleeping ? 'asleep in' : 'innermost frame'}
          value={summary.innermost?.name ?? '—'}
        />
        <Stat
          label="wchan would say"
          value={summary.waiting?.name ?? '0'}
        />
        <Stat label="system call" value={summary.syscall ?? 'none'} />
      </section>

      {summary.readingItself && (
        <p className="notice" role="status" data-testid="reading-itself">
          <strong>This is the read that is asking.</strong> The unwinder runs in whichever task is
          doing the unwinding, so a process reading its own <code>stack</code> gets the{' '}
          <code>proc</code> and VFS frames of that very <code>read()</code> — not a bug, not
          interesting about the process, and the same every time. To see where a process really is,
          read the file from somewhere else.
        </p>
      )}

      {summary.kernelThread && (
        <p className="notice" role="status" data-testid="kernel-thread">
          <strong>This is a kernel thread.</strong> The chain ends at{' '}
          <code>{summary.innermost === null ? 'ret_from_fork' : stack.frames.at(-1)!.name}</code>{' '}
          with <strong>no system call anywhere in it</strong>, because there is no userspace
          underneath to have made one. What looks like an idle process is the thread parked in its
          own main loop waiting for work — which is where a <code>kworker</code> spends nearly all
          of its life.
        </p>
      )}

      {waiting !== null && summary.wait !== null && (
        <p
          className={
            summary.wait.uninterruptible === true ? 'notice notice--warn' : 'notice'
          }
          role="status"
          data-testid="wait"
        >
          <strong>
            Waiting on {summary.wait.kind}, at <code>{waiting.name}</code>.
          </strong>{' '}
          {summary.wait.note}.{' '}
          {summary.wait.uninterruptible === true && (
            <>
              This is the <strong>uninterruptible</strong> kind — <code>D</code> in{' '}
              <code>ps</code>, deaf to signals, and counted in the load average whether or not a CPU
              is busy, which is how a machine doing nothing shows a load of 40.
            </>
          )}
        </p>
      )}

      {summary.sleeping && waiting !== null && (
        <p className="notice" role="status" data-testid="wchan-frame">
          <strong>
            <code>/proc/&lt;pid&gt;/wchan</code> would name <code>{waiting.name}</code> — frame{' '}
            {waiting.depth} of these {summary.frames}.
          </strong>{' '}
          That file gives one symbol and this gives the chain, and the kernel picks that one the
          same way this page does: it skips the <code>__sched</code> frames at the top, which say
          only that the task is asleep, and names the first one that says what it is asleep{' '}
          <em>for</em>.
        </p>
      )}

      {summary.syscall !== null && (
        <p className="notice" role="status" data-testid="syscall">
          <strong>
            This task came in through <code>{summary.syscall}</code>.
          </strong>{' '}
          That is the one thing this file has which{' '}
          <code>/proc/&lt;pid&gt;/syscall</code> does not: <em>a name</em>. That file gives the call
          number, and a number means different calls on different architectures — here the kernel
          has already resolved it, because the wrapper is a symbol like any other.
        </p>
      )}

      <div className="card mounts stack">
        <table className="mounts__table stack__table" aria-label="Kernel stack frames">
          <thead>
            <tr>
              <th scope="col" title="0 is the innermost frame — where the task is now">#</th>
              <th scope="col">Address</th>
              <th scope="col">Symbol</th>
              <th scope="col">Role</th>
              <th scope="col">What that wait is</th>
            </tr>
          </thead>
          <tbody>
            {stack.frames.map((frame) => (
              <FrameRow key={frame.depth} frame={frame} waiting={waiting} />
            ))}
          </tbody>
        </table>
      </div>

      {leaked.length === 0 && (
        <p className="notice" role="status" data-testid="placeholder">
          <strong>
            Every bracket in that column holds <code>{PLACEHOLDER}</code>, and that is not this
            task&rsquo;s addresses being zero.
          </strong>{' '}
          The kernel types the zero into the format string. Older kernels printed the real return
          address, which is what the brackets were for; it defeated KASLR, so the value went and the
          brackets stayed for the sake of anything parsing the shape. The column is furniture — much
          like fields 5 and 7 of <code>/proc/&lt;pid&gt;/statm</code>.
        </p>
      )}

      {summary.truncated && (
        <p className="notice notice--warn" role="status" data-testid="truncated">
          <strong>This trace is {summary.frames} frames, which is the most the kernel prints.</strong>{' '}
          <code>MAX_STACK_TRACE_DEPTH</code> is {MAX_DEPTH} and the unwinder stops there without
          saying so — so the chain probably went further, and the outermost frames, the ones that
          would say how the task got in, are the ones missing.
        </p>
      )}

      {!summary.sleeping && !summary.readingItself && !summary.kernelThread && (
        <p className="notice notice--warn" role="status" data-testid="running">
          <strong>The innermost frame is not the scheduler, so this task was not asleep.</strong>{' '}
          Unwinding a task that is running is exactly the case the kernel&rsquo;s own comment calls
          unsound: the stack is being written while it is read, and frames that were never on it
          together can come back. Read it again — a trace that changes between reads is a task that
          is working, not one that is stuck.
        </p>
      )}

      {note}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat stack__stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
