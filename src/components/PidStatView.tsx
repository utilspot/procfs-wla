import { useMemo, useState } from 'react';
import {
  CLOCK_TICK,
  COMM_MAX,
  describeField,
  describeState,
  formatBytes,
  formatCount,
  formatSeconds,
  formatField,
  isMaintained,
  PAGE_SIZE,
  parsePidStat,
  summarize,
} from '../lib/pid-stat';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function PidStatView({ content }: { content: string }) {
  const stat = useMemo(() => parsePidStat(content), [content]);
  const summary = useMemo(() => summarize(stat), [stat]);
  const [hideDead, setHideDead] = useState(false);

  if (stat.fields.length === 0) {
    return (
      <p className="notice notice--warn" data-testid="unreadable">
        Nothing here reads as this file. It holds one line: a pid, a name in parentheses, and the
        rest of the fields after it. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const state = describeState(summary.state);
  const visible = hideDead ? stat.fields.filter((entry) => isMaintained(entry.name)) : stat.fields;

  return (
    <>
      {summary.state === 'D' && (
        <p className="notice notice--warn" role="status" data-testid="uninterruptible">
          This process is in <strong>uninterruptible sleep</strong>. It is waiting inside the
          kernel with signals turned off, which is nearly always I/O — and it{' '}
          <strong>cannot be killed</strong> while it is there, not even with <code>SIGKILL</code>,
          until whatever it is waiting for returns.{' '}
          {summary.blkioSeconds !== null && summary.blkioSeconds > 0 && (
            <>
              It has spent <strong>{formatSeconds(summary.blkioSeconds)}</strong> waiting on block
              I/O, which is where to look first.
            </>
          )}
        </p>
      )}

      {summary.state === 'Z' && (
        <p className="notice notice--warn" role="status" data-testid="zombie">
          This process has <strong>exited and not been reaped</strong>. Its memory is already gone
          — which is why <code>rss</code> and <code>vsize</code> are zero — and all that is left is
          the accounting its parent will collect when it calls <code>wait()</code>. Until then the
          pid stays taken.
        </p>
      )}

      {summary.commAwkward && (
        <p className="notice" role="status" data-testid="awkward">
          This process is called <code>{summary.comm}</code>, and that name holds{' '}
          {[
            /[()]/.test(summary.comm ?? '') && 'parentheses',
            /\s/.test(summary.comm ?? '') && 'spaces',
          ]
            .filter((held) => held !== false)
            .join(' and ')}
          . The name is printed inside
          parentheses and is the <strong>only free-form field in the line</strong>, so anything
          reading this file by splitting on whitespace reads every field after it wrong — on data
          the process itself chose. The name is what lies between the first <code>(</code> and the{' '}
          <strong>last</strong> <code>)</code>, and nothing else is safe.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="name" value={summary.comm ?? '—'} />
        <Stat label="state" value={state === null ? (summary.state ?? '—') : state.name} />
        <Stat
          label="CPU used"
          value={summary.cpuSeconds === null ? '—' : formatSeconds(summary.cpuSeconds)}
        />
        <Stat
          label="resident"
          value={summary.rssBytes === null ? '—' : formatBytes(summary.rssBytes)}
        />
      </section>

      {state !== null && (
        <p className="pstat__state muted" data-testid="state">
          <code>{summary.state}</code> — {state.note}.
        </p>
      )}

      <p className="models" data-testid="flags">
        <span className="chip chip--model" title="This process, and the one that started it">
          pid <span className="count">{summary.pid}</span> · ppid{' '}
          <span className="count">{summary.ppid}</span>
        </span>
        {summary.threads !== null && (
          <span className="chip chip--model" title="Threads in this process">
            threads <span className="count">{summary.threads}</span>
          </span>
        )}
        {summary.priority !== null && (
          <span
            className="chip chip--model"
            title="The priority field is not the nice value: it is the kernel's own scale, or a real-time priority written backwards"
          >
            {summary.priority}
          </span>
        )}
        {summary.policy !== null && (
          <span
            className={summary.policy.realtime ? 'chip chip--flag' : 'chip chip--model'}
            title="The scheduling policy the task runs under"
          >
            {summary.policy.name}
          </span>
        )}
        {summary.processor !== null && (
          <span
            className="chip chip--model"
            title="The CPU it last ran on — a sample, not an affinity"
          >
            last on cpu <span className="count">{summary.processor}</span>
          </span>
        )}
        {summary.majorFaults !== null && summary.majorFaults > 0 && (
          <span
            className="chip chip--flag"
            title="Faults that had to read from disk, which is what makes a process feel slow"
          >
            major faults <span className="count">{formatCount(summary.majorFaults)}</span>
          </span>
        )}
        {summary.commTruncated && (
          <span
            className="chip chip--flag"
            title={`The kernel keeps only ${COMM_MAX} characters of a thread's name, and this is exactly that long — so the real one may be longer`}
          >
            name may be cut short
          </span>
        )}
      </p>

      <label className="mounts__filter">
        <input
          type="checkbox"
          checked={hideDead}
          onChange={(event) => setHideDead(event.target.checked)}
        />
        Hide the fields nothing maintains ({summary.dead.length} of {summary.count})
      </label>

      <div className="card mounts pstat">
        <table className="mounts__table pstat__table" aria-label="Fields">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Field</th>
              <th scope="col">As printed</th>
              <th scope="col">Which is</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => {
              const info = describeField(entry.name);
              const dead = info.dead !== undefined;

              return (
                <tr
                  key={entry.name}
                  className={dead ? 'pstat__row pstat__row--dead' : 'pstat__row'}
                >
                  <td className="pstat__index">{entry.number}</td>
                  <td className="pstat__field">{entry.name}</td>
                  <td className="pstat__raw">{entry.raw}</td>
                  <td className="pstat__value">
                    {formatField(entry.name, entry.raw) ?? <span className="muted">—</span>}
                  </td>
                  <td className="pstat__note">
                    {info.note}
                    {dead && (
                      <>
                        {' '}
                        <span className="chip" title={info.dead}>
                          not maintained
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>The second field cannot be split on.</strong> <code>comm</code> is printed inside
        parentheses and holds whatever the process called itself — spaces, parentheses and all —
        so the only safe reading is the pid up to the first <code>(</code>, the name up to the{' '}
        <strong>last</strong> <code>)</code>, and the fields after that. It is also the{' '}
        <em>thread</em> name, capped at {COMM_MAX} characters and set with <code>prctl</code>, so
        it is not <code>argv[0]</code>: <code>/proc/&lt;pid&gt;/cmdline</code> is what was actually
        run. Two units go unnamed in the line and are easy to read wrongly:{' '}
        <strong>
          <code>rss</code> is in pages where <code>vsize</code> is in bytes
        </strong>
        , so field 24 read as bytes understates memory {PAGE_SIZE}-fold — and it leaves out
        anything swapped out, which <code>/proc/&lt;pid&gt;/smaps</code> does not. The times are in{' '}
        <strong>clock ticks</strong>, {CLOCK_TICK} to the second on every Linux in practice, though
        the file never says so. And <code>priority</code> is not <code>nice</code>: for an ordinary
        task it is the kernel&rsquo;s own 0–39 scale where 20 means a nice of 0, and for a
        real-time one it is the negated real-time priority minus one. Finally, of the fields here,{' '}
        <strong>{summary.dead.length} are printed and kept by nothing</strong> — some never were,
        some were zeroed for security in 4.9, and the signal masks were superseded by{' '}
        <code>/proc/&lt;pid&gt;/status</code>, which can express real-time signals where these
        cannot.
      </p>
    </>
  );
}
