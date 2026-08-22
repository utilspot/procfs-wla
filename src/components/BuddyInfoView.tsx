import { useMemo } from 'react';
import {
  blockBytes,
  distribution,
  formatBytes,
  freeBytes,
  largestBlockBytes,
  largestOrder,
  looksFragmented,
  parseBuddyInfo,
  summarize,
  type Zone,
} from '../lib/buddyinfo';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * The zone's free memory as one bar, a segment per order weighted by bytes
 * rather than by block count — which is the only reading that means anything.
 */
function OrderBar({ zone }: { zone: Zone }) {
  const shares = distribution(zone).filter((share) => share.bytes > 0);

  if (shares.length === 0) return <span className="muted">—</span>;

  return (
    <span className="buddy__bar">
      {shares.map((share) => (
        <span
          key={share.order}
          className={`buddy__segment buddy__segment--${Math.min(share.order, 10)}`}
          style={{ width: `${share.share * 100}%` }}
          title={`order ${share.order}: ${share.count.toLocaleString()} blocks of ${formatBytes(
            blockBytes(share.order),
          )} — ${formatBytes(share.bytes)}, ${(share.share * 100).toFixed(1)}%`}
        />
      ))}
    </span>
  );
}

function ZoneRow({ zone, orders }: { zone: Zone; orders: number }) {
  const largest = largestOrder(zone);
  const fragmented = looksFragmented(zone);

  return (
    <tr className={fragmented ? 'buddy__row buddy__row--fragmented' : 'buddy__row'}>
      <td className="buddy__zone">
        {zone.zone}
        <span className="buddy__node">node {zone.node}</span>
      </td>
      <td className="buddy__number">{formatBytes(freeBytes(zone))}</td>
      <td className="buddy__number">
        {largest === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            {formatBytes(largestBlockBytes(zone)!)}
            <span className="buddy__order">order {largest}</span>
          </>
        )}
        {fragmented && (
          <span className="chip chip--bug" title="Holds memory but cannot satisfy a 64 KiB request">
            fragmented
          </span>
        )}
      </td>
      <td className="buddy__bar-cell">
        <OrderBar zone={zone} />
      </td>
      {Array.from({ length: orders }, (_, order) => (
        <td key={order} className="buddy__number buddy__count">
          {(zone.counts[order] ?? 0) === 0 ? (
            <span className="muted">·</span>
          ) : (
            zone.counts[order]!.toLocaleString()
          )}
        </td>
      ))}
    </tr>
  );
}

export function BuddyInfoView({ content }: { content: string }) {
  const zones = useMemo(() => parseBuddyInfo(content), [content]);
  const summary = useMemo(() => summarize(zones), [zones]);

  if (zones.length === 0) {
    return (
      <p className="notice notice--warn">
        No memory zones found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.fragmented.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.fragmented.length === 1 ? 'One zone holds' : `${summary.fragmented.length} zones hold`}{' '}
          memory but cannot satisfy a 64 KiB contiguous request:{' '}
          {summary.fragmented
            .map((zone) => `${zone.zone} on node ${zone.node} (${formatBytes(freeBytes(zone))} free, nothing above order ${largestOrder(zone) ?? 0})`)
            .join(', ')}
          .
        </p>
      )}

      <section className="summary">
        <Stat label="free memory" value={formatBytes(summary.totalBytes)} />
        <Stat
          label="largest contiguous block"
          value={summary.largestBlockBytes === null ? '—' : formatBytes(summary.largestBlockBytes)}
        />
        <Stat label="zones" value={String(summary.zones)} />
        {summary.nodes > 1 && <Stat label="NUMA nodes" value={String(summary.nodes)} />}
      </section>

      <p className="models">
        {summary.largest.map((zone) => (
          <span key={`${zone.node}-${zone.zone}`} className="chip chip--model">
            {zone.zone} <span className="count">{formatBytes(freeBytes(zone))}</span>
          </span>
        ))}
      </p>

      <div className="card mounts buddy">
        <table className="mounts__table buddy__table" aria-label="Free blocks by order">
          <thead>
            <tr>
              <th scope="col">Zone</th>
              <th scope="col">Free</th>
              <th scope="col">Largest block</th>
              <th scope="col">Where the free memory is</th>
              {Array.from({ length: summary.orders }, (_, order) => (
                <th key={order} scope="col" title={`Blocks of ${formatBytes(blockBytes(order))}`}>
                  {order}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <ZoneRow key={`${zone.node}-${zone.zone}`} zone={zone} orders={summary.orders} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        The numbered columns are free block counts by order, and{' '}
        <strong>a block of order N is 2<sup>N</sup> pages</strong> — one order-10 block is worth
        1024 order-0 pages, so the counts are not comparable across columns. The bar weights each
        order by the memory it actually holds. The largest order still occupied is the biggest
        contiguous allocation a zone can satisfy without compaction, which is why a machine can
        have gigabytes free and still fail a large request. Sizes assume a 4 KiB page — the file
        counts pages and does not say how big one is.
      </p>
    </>
  );
}
