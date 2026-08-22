import { useMemo } from 'react';
import {
  formatLoad,
  notRunnable,
  parseLoadAvg,
  summarize,
  type Trend,
} from '../lib/loadavg';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** How each direction reads, and what it is read from. */
const TRENDS: Record<Trend, { label: string; title: string }> = {
  rising: {
    label: 'rising',
    title: 'The one-minute average is above the fifteen-minute one',
  },
  falling: {
    label: 'falling',
    title: 'The one-minute average is below the fifteen-minute one, so the busy spell is passing',
  },
  steady: {
    label: 'steady',
    title: 'The one and fifteen minute averages are close enough to read nothing into',
  },
};

/** One load figure, with the window it covers. */
function Load({ value, window: over }: { value: number; window: string }) {
  return (
    <div className="load__figure">
      <span className="load__value">{formatLoad(value)}</span>
      <span className="load__window">{over}</span>
    </div>
  );
}

export function LoadAvgView({ content }: { content: string }) {
  const info = useMemo(() => parseLoadAvg(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  if (summary === null) {
    return (
      <p className="notice notice--warn">
        No load average found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const { load, trend, excess } = summary;
  const asleep = notRunnable(load);

  return (
    <>
      <div className="card load">
        <Load value={load.one} window="1 minute" />
        <Load value={load.five} window="5 minutes" />
        <Load value={load.fifteen} window="15 minutes" />
        <span className={`chip load__trend load__trend--${trend}`} title={TRENDS[trend].title}>
          {TRENDS[trend].label}
        </span>
      </div>

      <section className="summary" data-testid="summary">
        <Stat label="runnable now" value={load.runnable.toLocaleString()} />
        <Stat label="threads" value={load.threads.toLocaleString()} />
        <Stat label="not runnable" value={asleep.toLocaleString()} />
        <Stat label="last PID" value={load.lastPid.toLocaleString()} />
      </section>

      {/*
       * The load counts uninterruptible sleepers as well as runnable tasks, so
       * a load well above the runnable count is the sign of that — carefully,
       * since one number is an average and the other an instant.
       */}
      {excess > 1 && (
        <p className="notice" role="status">
          The one-minute average is <strong>{formatLoad(excess)}</strong> above the{' '}
          {load.runnable.toLocaleString()} thread{load.runnable === 1 ? '' : 's'} runnable at the
          moment this was read. On Linux the load counts tasks in uninterruptible sleep too, so
          that gap is usually something blocked on disk or on a network filesystem rather than
          anything wanting the CPU. Take it as a hint: an average over a minute is being compared
          with a count taken at one instant, and a load that has just fallen away looks the same.
        </p>
      )}

      <p className="disks__note muted">
        The load average on Linux counts tasks in <strong>uninterruptible sleep</strong> as well as
        those competing for the processor, which is not what it means on other Unixes: a load of 8
        may be eight things wanting a CPU, or one running and seven waiting on a slow disk. The
        three figures are <strong>exponentially damped</strong> — the one-minute figure has most of
        a minute in it but never entirely forgets what came before — so comparing them is how a
        direction is read, and it is what the chip above does. What the file does not say is how
        many CPUs there are, which is the other half of whether a load is high at all; that is in{' '}
        <code>/proc/cpuinfo</code>, so nothing here calls this load high or low. The last PID is
        simply the most recent one allocated, and it wraps.
      </p>
    </>
  );
}
