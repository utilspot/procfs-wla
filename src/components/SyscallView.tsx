import { useMemo } from 'react';
import {
  ARG_REGISTERS,
  COMMON_FROM,
  decimal,
  isAddress,
  paramsAt,
  parseSyscall,
  summarize,
} from '../lib/syscall';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** What the file is worth, said once at the bottom of every state. */
function Footnote() {
  return (
    <p className="disks__note muted">
      This is <strong>a sample, not a trace</strong>: one line describing where the process was at
      the moment it was read, and by now it may be somewhere else entirely. <code>strace</code> is
      the tool for a sequence. What this is good for is a process that is <em>stuck</em> — read it
      twice, get the same answer, and that answer is the reason. Two things about the line read
      wrong at first glance. The kernel always prints{' '}
      <strong>{ARG_REGISTERS} argument registers</strong> whatever the call takes, so the ones past
      the end of the call&rsquo;s own arguments hold whatever happened to be left in them. And{' '}
      <strong>the number means nothing without the architecture</strong>, which this file does not
      say: 202 is <code>futex</code> on x86-64 and <code>accept</code> on arm64. Only from{' '}
      {COMMON_FROM} up do they agree, because every syscall added since{' '}
      <code>pidfd_send_signal</code> has been given the same number everywhere. The file is mode{' '}
      <code>0400</code> and gated by <code>ptrace</code> access on top of that, so another
      user&rsquo;s process is not readable at all — and on a kernel built without{' '}
      <code>CONFIG_HAVE_ARCH_TRACEHOOK</code> it does not exist.
    </p>
  );
}

export function SyscallView({ content }: { content: string }) {
  const sample = useMemo(() => parseSyscall(content), [content]);
  const summary = useMemo(() => summarize(sample), [sample]);

  if (sample.state === 'unreadable') {
    return (
      <p className="notice notice--warn" data-testid="unreadable">
        Nothing here reads as this file. It holds one line — <code>running</code>, a{' '}
        <code>-1</code> and two pointers, or a call number with eight values after it — and this is
        none of them. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  if (sample.state === 'running') {
    return (
      <>
        <p className="notice" role="status" data-testid="running">
          <strong>This process is on a CPU right now.</strong> That is what <code>running</code>{' '}
          means here, and it is an answer rather than a failure: a task that is executing cannot
          have its registers read consistently, so the kernel declines instead of returning
          something that was never true. A process that keeps saying this is{' '}
          <strong>busy, not blocked</strong> — which is itself the diagnosis, and the point at
          which a profiler rather than this file is the next thing to reach for.
        </p>
        <Footnote />
      </>
    );
  }

  if (sample.state === 'not-in-syscall') {
    return (
      <>
        <p className="notice" role="status" data-testid="userspace">
          <strong>This process is in userspace, with no system call in progress.</strong> That is
          the <code>-1</code>: there is no call number to give, so the kernel prints only where the
          process is — three fields rather than nine. It was sampled between calls, or is doing
          work that needs none.
        </p>

        <section className="summary" data-testid="summary">
          <Stat label="state" value="userspace" />
          <Stat label="instruction pointer" value={sample.ip ?? '—'} />
          <Stat label="stack pointer" value={sample.sp ?? '—'} />
        </section>

        <Footnote />
      </>
    );
  }

  return (
    <>
      {summary.ambiguous && (
        <p className="notice notice--warn" role="status" data-testid="ambiguous">
          Call number <strong>{summary.nr}</strong> is not one call: it is{' '}
          {summary.calls
            .map((call) => `${call.name ?? 'nothing this page knows'} on ${call.label}`)
            .join(', and ')}
          . The file does not say which architecture it was written on, so both are given below
          and neither is picked for you. Numbers only agree from {COMMON_FROM} up.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="call number" value={String(summary.nr)} />
        <Stat
          label="which is"
          value={
            summary.ambiguous
              ? 'architecture-dependent'
              : (summary.calls.find((call) => call.name !== null)?.name ?? '—')
          }
        />
        <Stat label="instruction pointer" value={sample.ip ?? '—'} />
      </section>

      <p className="models" data-testid="flags">
        {summary.common && (
          <span
            className="chip chip--model"
            title={`Every syscall from ${COMMON_FROM} on has the same number on every architecture`}
          >
            same number everywhere
          </span>
        )}
        {summary.arity !== null && (
          <span
            className="chip chip--model"
            title={`This call takes ${summary.arity} of the ${ARG_REGISTERS} registers the kernel prints`}
          >
            arguments <span className="count">{summary.arity}</span> of {ARG_REGISTERS}
          </span>
        )}
        <span className="chip chip--flag" title="Where the process would resume in userspace">
          sp <span className="count">{sample.sp}</span>
        </span>
      </p>

      <div className="card mounts sysc">
        <table className="mounts__table sysc__table" aria-label="What the number is called">
          <thead>
            <tr>
              <th scope="col">Architecture</th>
              <th scope="col">Call {summary.nr}</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            {summary.calls.map((call) => (
              <tr key={call.abi} className="sysc__row">
                <td className="sysc__abi">{call.label}</td>
                <td className="sysc__name">
                  {call.name ?? <span className="muted">not in this page&rsquo;s table</span>}
                </td>
                <td className="sysc__note">
                  {call.info?.note ?? (
                    <span className="muted">
                      {call.name === null
                        ? 'No name, so nothing to say about it'
                        : 'A call this page has no note for'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card mounts sysc">
        <table className="mounts__table sysc__table" aria-label="Argument registers">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Register</th>
              <th scope="col">As a number</th>
              <th scope="col">Is</th>
            </tr>
          </thead>
          <tbody>
            {(sample.args ?? []).map((value, index) => {
              // Past the arity of every candidate call these hold whatever was
              // left in the register, so they are shown and marked, not hidden.
              const leftover = summary.arity !== null && index >= summary.arity;
              // Two names where the architectures read the number differently,
              // since the register genuinely means both.
              const params = paramsAt(summary, index);

              return (
                <tr
                  key={index}
                  className={leftover ? 'sysc__row sysc__row--leftover' : 'sysc__row'}
                >
                  <td className="sysc__index">{index}</td>
                  <td className="sysc__value">{value}</td>
                  <td className="sysc__number">
                    {decimal(value) ?? <span className="muted">—</span>}
                  </td>
                  <td className="sysc__notes">
                    {params.map((param) => (
                      <span
                        key={param.abi}
                        className="chip chip--type"
                        title={`What ${
                          summary.calls.find((call) => call.abi === param.abi)?.name ?? 'this call'
                        } calls this argument on ${param.label}`}
                      >
                        {param.name}
                        {summary.ambiguous && <span className="muted"> · {param.label}</span>}
                      </span>
                    ))}
                    {leftover && (
                      <span
                        className="chip"
                        title="Past the end of this call's arguments: whatever was left in the register, not something the process passed"
                      >
                        leftover
                      </span>
                    )}
                    {summary.arity === null && (
                      <span
                        className="chip"
                        title="This page does not know how many arguments this call takes, so all six are shown as they were printed"
                      >
                        unknown
                      </span>
                    )}
                    {isAddress(value) && (
                      <span className="chip chip--model" title="Too large to be a count or a descriptor">
                        address
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Footnote />
    </>
  );
}
