import { useMemo } from 'react';
import {
  averageUs,
  BACKTRACE_DEPTH,
  byTotal,
  formatMicros,
  maybeTruncated,
  parseLatencyStats,
  siteOf,
  summarize,
  type LatencyRecord,
} from '../lib/latency_stats';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function RecordRow({ record, worst }: { record: LatencyRecord; worst: number }) {
  const average = averageUs(record);
  const [site, ...rest] = record.backtrace;

  return (
    <tr className="lat__row">
      <td className="lat__site">
        {site}
        {maybeTruncated(record) && (
          <span
            className="chip"
            title={`The kernel keeps ${BACKTRACE_DEPTH} frames per record, so this path may go further`}
          >
            cut?
          </span>
        )}
      </td>
      <td className="lat__number">{record.count.toLocaleString()}</td>
      <td className="lat__bar-cell">
        <span
          className="lat__bar"
          title={`${formatMicros(record.totalUs)} of ${formatMicros(worst)}, the worst here`}
        >
          <span
            className="lat__segment"
            style={{ width: `${worst === 0 ? 0 : (record.totalUs / worst) * 100}%` }}
          />
        </span>
      </td>
      <td className="lat__number">{formatMicros(record.totalUs)}</td>
      <td className="lat__number">{average === null ? '—' : formatMicros(average)}</td>
      <td className="lat__number">{formatMicros(record.maxUs)}</td>
      <td className="lat__path">
        {rest.length === 0 ? (
          <span className="muted" title="The record holds no frame above this one">
            —
          </span>
        ) : (
          <ul className="chips">
            {rest.map((frame, index) => (
              <li key={`${frame}-${index}`} className="chip">
                {frame}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

export function LatencyStatsView({ content }: { content: string }) {
  const info = useMemo(() => parseLatencyStats(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);
  const ranked = useMemo(() => byTotal(info), [info]);

  /**
   * The header is printed whether or not anything was recorded, so an empty
   * list is not an empty file — and it cannot say which of the two reasons
   * applies.
   */
  if (info.records.length === 0) {
    return (
      <p className="notice" role="status">
        No latencies have been recorded
        {info.version === null ? '' : `, though the file has its ${info.version} header`}. Either{' '}
        <code>kernel.latencytop</code> is off — it is off by default — or nothing has waited since
        the statistics were last reset. Writing to this file is what resets them, and the file
        cannot say which of the two happened.
      </p>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="records" value={String(summary.records)} />
        <Stat label="waits" value={summary.events.toLocaleString()} />
        <Stat label="time waited" value={formatMicros(summary.totalUs)} />
        {summary.worstMax !== null && (
          <Stat label="longest single wait" value={formatMicros(summary.worstMax.maxUs)} />
        )}
      </section>

      {summary.worstTotal !== null && (
        <p className="models" data-testid="worst">
          <span className="chip chip--model">
            {siteOf(summary.worstTotal)}{' '}
            <span className="count">{formatMicros(summary.worstTotal.totalUs)} in total</span>
          </span>
          {summary.worstMax !== null && summary.worstMax !== summary.worstTotal && (
            <span className="chip chip--model">
              {siteOf(summary.worstMax)}{' '}
              <span className="count">{formatMicros(summary.worstMax.maxUs)} at worst</span>
            </span>
          )}
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table lat__table" aria-label="Recorded latencies">
          <thead>
            <tr>
              <th scope="col">Waited in</th>
              <th scope="col">Waits</th>
              <th scope="col">Share</th>
              <th scope="col">Total</th>
              <th scope="col">Average</th>
              <th scope="col">Worst</th>
              <th scope="col">Called from</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((record) => (
              <RecordRow
                key={record.backtrace.join('>')}
                record={record}
                worst={summary.worstTotal?.totalUs ?? 0}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        Each record folds together every wait with the same call path: a count, the{' '}
        <strong>total</strong> time across all of them and the <strong>longest single</strong> one,
        both in microseconds. The average is the total over the count, and it is the division that
        tells the two kinds of problem apart — a small average beside a large worst case is an
        occasional stall, where both being large is a machine that waits all the time. The first
        symbol is where the sleep happened and the rest is the path that got there, innermost
        first; the kernel keeps {BACKTRACE_DEPTH} frames, so a path of exactly that many may go
        further than it says. The rows are ordered by total time here — the file&rsquo;s own order
        is its internal table&rsquo;s and means nothing. Writing to the file resets every record.
      </p>
    </>
  );
}
