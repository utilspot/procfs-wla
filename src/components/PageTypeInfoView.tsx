import { useMemo } from 'react';
import {
  blockShare,
  bytesIn,
  bytesOf,
  describeType,
  formatBytes,
  largestOrder,
  parsePageTypeInfo,
  summarize,
  totalBlocks,
  zones,
  type BlockRow,
  type FreeRow,
  type PageTypeInfo,
  type ZoneRows,
} from '../lib/pagetypeinfo';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function percent(share: number | null): string {
  return share === null ? '—' : `${Math.round(share * 100)}%`;
}

function FreeRowCells({
  row,
  orders,
  pageblockOrder,
}: {
  row: FreeRow;
  orders: number;
  pageblockOrder: number | null;
}) {
  const largest = largestOrder(row);
  const described = describeType(row.type);

  return (
    <tr className="ptype__row">
      <td className="ptype__type" title={described ?? 'This page has no note for this type'}>
        {row.type}
      </td>
      {Array.from({ length: orders }, (_, order) => {
        const count = row.counts[order] ?? 0;
        const whole = pageblockOrder !== null && order >= pageblockOrder;

        return (
          <td
            key={order}
            className={
              count === 0
                ? 'ptype__count ptype__count--none'
                : whole
                  ? 'ptype__count ptype__count--whole'
                  : 'ptype__count'
            }
            title={`${count} free block${count === 1 ? '' : 's'} of ${formatBytes(bytesIn(order))}`}
          >
            {count}
          </td>
        );
      })}
      <td className="ptype__total" title="Weighting each order by what a block there is worth">
        {formatBytes(bytesOf(row))}
      </td>
      <td className="ptype__largest">
        {largest === null ? (
          <span className="muted" title="Nothing free of this type at any order">
            —
          </span>
        ) : (
          <span title={`The largest run this type can satisfy without compaction`}>
            {formatBytes(bytesIn(largest))}
          </span>
        )}
      </td>
    </tr>
  );
}

/** The pageblocks a zone owns, by type — the second table's row. */
function Blocks({ row, types }: { row: BlockRow; types: string[] }) {
  const total = totalBlocks(row);

  return (
    <p className="ptype__blocks">
      <span className="muted">{total.toLocaleString()} pageblocks:</span>
      {types.map((type) => {
        const count = row.blocks[type] ?? 0;
        if (count === 0) return null;

        return (
          <span
            key={type}
            className="chip"
            title={`${describeType(type) ?? type} — ${percent(blockShare(row, type))} of this zone's blocks`}
          >
            {type} <span className="count">{count.toLocaleString()}</span>
          </span>
        );
      })}
    </p>
  );
}

function Zone({ zone, info }: { zone: ZoneRows; info: PageTypeInfo }) {
  const orders = Math.max(...zone.rows.map((row) => row.counts.length));

  return (
    <section className="card ptype">
      <h3 className="ptype__name">
        Node {zone.node}, zone {zone.zone}
      </h3>

      {zone.blocks !== null && <Blocks row={zone.blocks} types={info.types} />}

      <div className="ptype__scroll">
        <table
          className="mounts__table ptype__table"
          aria-label={`Free blocks in node ${zone.node} zone ${zone.zone}`}
        >
          <thead>
            <tr>
              <th scope="col">Type</th>
              {Array.from({ length: orders }, (_, order) => (
                <th key={order} scope="col" title={`Blocks of ${formatBytes(bytesIn(order))}`}>
                  {order}
                </th>
              ))}
              <th scope="col">Free</th>
              <th scope="col">Largest</th>
            </tr>
          </thead>
          <tbody>
            {zone.rows.map((row) => (
              <FreeRowCells
                key={row.type}
                row={row}
                orders={orders}
                pageblockOrder={info.pageblockOrder}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PageTypeInfoView({ content }: { content: string }) {
  const info = useMemo(() => parsePageTypeInfo(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);
  const grouped = useMemo(() => zones(info), [info]);

  if (grouped.length === 0) {
    return (
      <p className="notice notice--warn">
        No zones found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.fragmented.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.fragmented.map((zone) => `node ${zone.node} ${zone.zone}`).join(', ')} has
          nothing free as large as a pageblock, of any type. There may be plenty of memory free —
          it is simply in pieces too small to hand out as one run, and a huge page or a large
          kernel buffer will have to wait for compaction.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="free" value={formatBytes(summary.totalBytes)} />
        <Stat label="zones" value={`${summary.zones} on ${summary.nodes} node${summary.nodes === 1 ? '' : 's'}`} />
        <Stat
          label="pageblock"
          value={
            summary.pageblockBytes === null
              ? '—'
              : `${formatBytes(summary.pageblockBytes)} · order ${summary.pageblockOrder}`
          }
        />
        <Stat label="orders" value={String(summary.orders)} />
      </section>

      <p className="models" data-testid="totals">
        {summary.totals.map(({ type, bytes }) => (
          <span
            key={type}
            className="chip chip--model"
            title={describeType(type) ?? 'This page has no note for this type'}
          >
            {type} <span className="count">{formatBytes(bytes)}</span>
          </span>
        ))}
      </p>

      <div className="md__arrays">
        {grouped.map((zone) => (
          <Zone key={`${zone.node}/${zone.zone}`} zone={zone} info={info} />
        ))}
      </div>

      <p className="disks__note muted">
        This is <code>/proc/buddyinfo</code> split by <strong>migrate type</strong>, so the same
        warning applies to the columns: a block at order N is <strong>2^N pages</strong>, and
        reading a row as a histogram gets free memory backwards — the <em>free</em> column weights
        each order by what a block there is worth. What the split adds is why the kernel sorts free
        memory this way at all. <strong>Movable</strong> memory is user pages it can relocate;{' '}
        <strong>unmovable</strong> is kernel allocations that must stay put. Keeping them in
        separate pageblocks is what stops a machine fragmenting past the point where any large
        allocation can be satisfied — which makes the <strong>pageblock counts</strong> above each
        table the number to watch, since unmovable blocks growing at the expense of movable ones
        does not undo itself. The highlighted columns are orders at or above a pageblock: a zone
        with nothing there cannot hand out a huge page without compacting first.
      </p>
    </>
  );
}
