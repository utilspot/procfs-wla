import { useMemo } from 'react';
import {
  canLowerNice,
  describeLimit,
  find,
  formatValue,
  isEnforced,
  isPerUser,
  isRaisable,
  niceFloor,
  parseLimits,
  summarize,
  unenforcedSince,
  type Limit,
} from '../lib/limits';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The limits worth reading off the top, in the order they are usually asked about. */
const HEADLINE = ['Max open files', 'Max stack size', 'Max core file size', 'Max processes'];

/** What the headline chip calls each of them, since the row names are long. */
const SHORT: Readonly<Record<string, string>> = {
  'Max open files': 'open files',
  'Max stack size': 'stack',
  'Max core file size': 'core dump',
  'Max processes': 'processes',
};

function LimitRow({ limit }: { limit: Limit }) {
  const info = describeLimit(limit.name);
  const enforced = isEnforced(limit.name);
  const floor = niceFloor(limit);

  return (
    <tr className={enforced ? 'lim__row' : 'lim__row lim__row--unenforced'}>
      <td className="lim__name">
        {limit.name}
        {isRaisable(limit) && (
          <span
            className="chip chip--flag"
            title="The soft limit is below the hard one, so this process can raise it itself with setrlimit — no privilege needed"
          >
            raisable
          </span>
        )}
        {isPerUser(limit.name) && (
          <span
            className="chip chip--model"
            title="Counted across every process sharing this one’s real user id, machine-wide — not for this process alone"
          >
            per user
          </span>
        )}
        {!enforced && (
          <span
            className="chip chip--type"
            title={`Printed, and acted on by nothing since ${unenforcedSince(limit.name)}`}
          >
            not enforced
          </span>
        )}
      </td>
      <td className="lim__number">{formatValue(limit, limit.soft)}</td>
      <td className="lim__number">{formatValue(limit, limit.hard)}</td>
      <td className="lim__unit">{limit.unit ?? <span className="muted">—</span>}</td>
      <td className="lim__note">
        {info === null ? (
          <span className="muted">A limit this page has no note for</span>
        ) : (
          <>
            <code className="lim__resource">{info.resource}</code>
            {info.flag !== null && <code className="lim__flag">ulimit {info.flag}</code>}{' '}
            {info.note}
            {floor !== null &&
              (canLowerNice(limit) ? (
                <>
                  {' '}
                  — here that is a floor of <strong>nice {floor}</strong>.
                </>
              ) : (
                <>
                  {' '}
                  — here that is a floor of <strong>nice {floor}</strong>, past the top of the
                  range, so this process cannot raise its priority at all.
                </>
              ))}
          </>
        )}
      </td>
    </tr>
  );
}

export function LimitsView({ content }: { content: string }) {
  const limits = useMemo(() => parseLimits(content), [content]);
  const summary = useMemo(() => summarize(limits), [limits]);

  if (limits.length === 0) {
    return (
      <p className="notice notice--warn">
        No limits found in this file. Every process has them, so an empty answer usually means the
        process is gone or the backend could not read it — switch to the raw view to see what the
        server returned.
      </p>
    );
  }

  const nofile = find(limits, 'Max open files');

  return (
    <>
      {summary.realtimeWithoutTimeout && (
        <p className="notice notice--warn" role="status" data-testid="rttime">
          This process may schedule itself in <strong>real time</strong> with no{' '}
          <code>Max realtime timeout</code> behind it. A <code>SCHED_FIFO</code> thread that stops
          making blocking calls then holds its CPU with nothing able to preempt it, and{' '}
          <code>RLIMIT_RTTIME</code> is the only thing that would have cut it short.
        </p>
      )}

      {nofile !== null && isRaisable(nofile) && (
        <p className="notice" role="status" data-testid="nofile">
          <code>Max open files</code> is enforced at{' '}
          <strong>{formatValue(nofile, nofile.soft)}</strong> against a ceiling of{' '}
          <strong>{formatValue(nofile, nofile.hard)}</strong>. The process can close that gap
          itself — <code>setrlimit</code> up to the hard limit needs no privilege — so an{' '}
          <code>EMFILE</code> here is a line of code away from being fixed, not a machine that has
          to be reconfigured.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="limits" value={String(summary.count)} />
        <Stat label="unlimited" value={String(summary.unlimited)} />
        <Stat label="it can raise" value={String(summary.raisable.length)} />
        <Stat label="at their ceiling" value={String(summary.pinned.length)} />
      </section>

      <p className="models" data-testid="headline">
        {HEADLINE.map((name) => find(limits, name)).map(
          (limit) =>
            limit !== null &&
            // The chip below says this one better when it is zero.
            !(summary.noCoreDumps && limit.name === 'Max core file size') && (
              <span
                key={limit.name}
                className="chip chip--model"
                title={describeLimit(limit.name)?.note}
              >
                {SHORT[limit.name]}{' '}
                <span className="count">{formatValue(limit, limit.soft)}</span>
              </span>
            ),
        )}
        {summary.noCoreDumps && (
          <span
            className="chip chip--flag"
            title="Max core file size is zero, so a crash writes nothing to debug afterwards"
          >
            no core dumps
          </span>
        )}
      </p>

      <div className="card mounts lim">
        <table className="mounts__table lim__table" aria-label="Resource limits">
          <thead>
            <tr>
              <th scope="col">Limit</th>
              <th scope="col">Soft</th>
              <th scope="col">Hard</th>
              <th scope="col">Units</th>
              <th scope="col">What it bounds</th>
            </tr>
          </thead>
          <tbody>
            {limits.map((limit) => (
              <LimitRow key={limit.name} limit={limit} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>The soft limit is what is enforced; the hard limit is the ceiling</strong> the
        process may raise its own soft limit to, with <code>setrlimit</code> and no privilege at
        all — which is why a <code>1024 / 1048576</code> on <code>Max open files</code> is a
        process that has not asked yet rather than a machine that says no. Going the other way is a
        one-way door: without <code>CAP_SYS_RESOURCE</code> a process can lower a hard limit but
        never raise it back, which is how a service is locked down for the rest of its life. Three
        of these rows — <code>Max processes</code>, <code>Max pending signals</code> and{' '}
        <code>Max msgqueue size</code> — are counted across{' '}
        <strong>every process sharing this one&rsquo;s real user id</strong>, machine-wide, so
        something else entirely can exhaust them; <code>Max processes</code> is also not enforced
        for root at all. Two more are printed and acted on by nothing:{' '}
        <code>Max resident set</code> since Linux 2.4.30 and <code>Max file locks</code> since
        2.4.25. And <code>Max nice priority</code> reads backwards — the kernel refuses any nice
        value below 20 minus what is printed here, so the usual <code>0</code> puts the floor at
        20, past the top of the range, and the process cannot raise its priority at all.
        Limits are inherited across <code>fork</code> and survive <code>execve</code>, so what is
        here was in most cases set by something that is no longer running.
      </p>
    </>
  );
}
