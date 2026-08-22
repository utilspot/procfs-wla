import { useMemo } from 'react';
import {
  byTime,
  clusterTimes,
  clusterTotal,
  formatDuration,
  formatFrequency,
  formatShare,
  heavyAtTopStep,
  identify,
  isShortRow,
  meanFrequency,
  parseUidTimeInState,
  summarize,
  ticksToSeconds,
  TOP_STEP_HEAVY,
  type Cluster,
  type TopStepUse,
  type UidTimeInState,
  type UidTimes,
} from '../lib/uid_time_in_state';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** What to call a uid: Android's name for it, or the number and nothing more. */
function UidName({ uid }: { uid: number }) {
  const who = identify(uid);

  return (
    <>
      {uid}
      {who.name !== null && (
        <span className="chip" title={`Android calls this uid ${who.name}`}>
          {who.name}
        </span>
      )}
    </>
  );
}

/**
 * Where a step sits in its cluster, in thirds — which is what the bar is
 * coloured by, since the top of a cluster is the expensive part of it and the
 * bottom is the cheap one.
 */
function band(step: number, steps: number): 'low' | 'mid' | 'high' {
  const position = steps < 2 ? 1 : step / (steps - 1);
  if (position <= 1 / 3) return 'low';
  return position <= 2 / 3 ? 'mid' : 'high';
}

/** One frequency's share of a uid's time on one cluster. */
function Step({
  frequency,
  ticks,
  total,
  step,
  steps,
}: {
  frequency: number;
  ticks: number;
  total: number;
  step: number;
  steps: number;
}) {
  const share = ticks / total;

  return (
    <span
      className={`uidtis__step uidtis__step--${band(step, steps)}`}
      style={{ width: `${share * 100}%` }}
      title={`${formatFrequency(frequency)} — ${formatShare(share)} (${formatDuration(ticksToSeconds(ticks))})`}
    />
  );
}

/**
 * A uid's time on one cluster: the steps it was spread over, and the frequency
 * that averages out to.
 *
 * Empty where the row stopped before this cluster, which is time that was never
 * accounted rather than time at zero — see the note at the foot of the page.
 */
function ClusterCell({ uid, cluster }: { uid: UidTimes; cluster: Cluster }) {
  const times = clusterTimes(uid, cluster);
  const total = clusterTotal(uid, cluster);
  const mean = meanFrequency(uid, cluster);

  if (times.length === 0) {
    return (
      <td className="uidtis__cluster-cell">
        <span className="muted" title="The kernel printed no columns for this cluster">
          not accounted
        </span>
      </td>
    );
  }

  if (total === 0) {
    return (
      <td className="uidtis__cluster-cell">
        <span className="muted" title="This uid has never run on this cluster">
          —
        </span>
      </td>
    );
  }

  return (
    <td className="uidtis__cluster-cell">
      <div className="uidtis__cluster">
        <span
          className="uidtis__bar"
          title={`${formatDuration(ticksToSeconds(total))} on this cluster`}
        >
          {times.map((ticks, step) => (
            <Step
              key={cluster.frequencies[step]}
              frequency={cluster.frequencies[step]!}
              ticks={ticks}
              total={total}
              step={step}
              steps={cluster.frequencies.length}
            />
          ))}
        </span>
        <span className="uidtis__figures">
          {formatDuration(ticksToSeconds(total))}
          {mean !== null && <> · {formatFrequency(mean)}</>}
        </span>
      </div>
    </td>
  );
}

function UidRow({ uid, info }: { uid: UidTimes; info: UidTimeInState }) {
  return (
    <tr className="uidtis__row">
      <td className="uidtis__uid">
        <UidName uid={uid.uid} />
      </td>
      <td className="uidtis__number">{formatDuration(ticksToSeconds(uid.total))}</td>
      {info.clusters.map((cluster) => (
        <ClusterCell key={cluster.index} uid={uid} cluster={cluster} />
      ))}
      <td className="uidtis__number">
        {isShortRow(uid, info) ? (
          <span className="chip" title="Fewer counts than the header has frequencies">
            {uid.times.length}/{info.frequencies.length}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  );
}

/** One cluster's steps, named as the chips above the table. */
function ClusterChip({ cluster }: { cluster: Cluster }) {
  const steps = cluster.frequencies;
  const range = `${formatFrequency(steps[0]!)} – ${formatFrequency(steps[steps.length - 1]!)}`;

  return (
    <span className="chip chip--model" title={steps.map(formatFrequency).join(', ')}>
      cluster {cluster.index} <span className="count">{range}</span>
    </span>
  );
}

/**
 * What the warning says about one uid, as one string rather than as a sentence
 * assembled out of elements: it is read as a sentence, so it is one.
 */
function sentence(use: TopStepUse): string {
  const who = identify(use.uid.uid).name ?? `uid ${use.uid.uid}`;
  const top = use.cluster.frequencies[use.cluster.frequencies.length - 1]!;

  return `${who} spends ${formatShare(use.share)} of its cluster ${use.cluster.index} time at ${formatFrequency(top)}.`;
}

export function UidTimeInStateView({ content }: { content: string }) {
  const info = useMemo(() => parseUidTimeInState(content), [content]);
  const ranked = useMemo(() => byTime(info), [info]);
  const summary = useMemo(() => summarize(info), [info]);
  const heavy = useMemo(() => heavyAtTopStep(info), [info]);

  if (info.frequencies.length === 0) {
    return (
      <p className="notice notice--warn">
        No <code>uid:</code> header in this file, so there are no frequencies to read the counts
        against. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const busiest = summary.busiest;

  return (
    <>
      {heavy.length > 0 && (
        <p className="notice notice--warn" role="status">
          {heavy.slice(0, 3).map((use) => (
            <span key={`${use.uid.uid}-${use.cluster.index}`}>{sentence(use)} </span>
          ))}
          Power rises faster than clock does, so the top step is where a uid costs the most for
          what it gets — {formatShare(TOP_STEP_HEAVY)} of a cluster&rsquo;s time up there is worth
          a look.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="uids" value={String(summary.uids)} />
        <Stat label="clusters" value={String(summary.clusters)} />
        <Stat label="CPU time" value={formatDuration(ticksToSeconds(summary.total))} />
        {busiest !== null && (
          <Stat label="most CPU" value={identify(busiest.uid).name ?? `uid ${busiest.uid}`} />
        )}
        {summary.apps > 0 && <Stat label="apps" value={String(summary.apps)} />}
      </section>

      <p className="models">
        {info.clusters.map((cluster) => (
          <ClusterChip key={cluster.index} cluster={cluster} />
        ))}
      </p>

      {ranked.length === 0 ? (
        <p className="notice" role="status">
          The header names {info.frequencies.length} frequencies and no uid has any time against
          them, which is what a table prints after it is reset.
        </p>
      ) : (
        <div className="card mounts">
          <table
            className="mounts__table uidtis__table"
            aria-label="CPU time per uid at each frequency"
          >
            <thead>
              <tr>
                <th scope="col">uid</th>
                <th scope="col">CPU time</th>
                {info.clusters.map((cluster) => (
                  <th key={cluster.index} scope="col">
                    Cluster {cluster.index}
                  </th>
                ))}
                <th scope="col">Columns</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((uid) => (
                <UidRow key={uid.uid} uid={uid} info={info} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="disks__note muted">
        The header is every frequency the machine can run at, in kHz, and each line is one uid with
        a <strong>clock-tick count per frequency</strong> — the same ticks{' '}
        <code>/proc/stat</code> counts in, a hundredth of a second each. Nothing in the file says
        where one cluster ends and the next begins: the header is each cpufreq policy&rsquo;s table
        printed one after another, so a step that does not climb is where the next one starts. That
        is why the mean frequency is per cluster — an average across a little core&rsquo;s steps
        and a big one&rsquo;s would describe neither. A line shorter than the header is a uid whose
        table was allocated before a policy came up, and the missing columns are time that was
        never accounted rather than time at zero. The counts are since boot or since the last
        reset, which is what writing to this file does.
      </p>
    </>
  );
}
