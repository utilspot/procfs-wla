import { useMemo } from 'react';
import {
  describeField,
  formatBytes,
  isCount,
  parseMeminfo,
  summarize,
  type MemField,
  type MemoryTotals,
} from '../lib/meminfo';

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

/**
 * Memory laid out the way `free` lays it out: what programs hold, what the
 * cache holds, and what is untouched — the three adding up to the total.
 */
function MemoryBar({ totals }: { totals: MemoryTotals }) {
  const { total, used, buffersAndCache, free } = totals;
  if (total === null || total === 0) return null;

  const parts = [
    { key: 'used', label: 'used', bytes: used, title: 'Held by programs and by the kernel' },
    {
      key: 'cache',
      label: 'buffers & cache',
      bytes: buffersAndCache,
      title: 'The page cache and reclaimable slab — given back when something needs the memory',
    },
    { key: 'free', label: 'free', bytes: free, title: 'Holding nothing at all' },
  ];

  return (
    <div className="card mem">
      <div className="mem__bar">
        {parts.map((part) => (
          <span
            key={part.key}
            className={`mem__segment mem__segment--${part.key}`}
            style={{ width: `${((part.bytes ?? 0) / total) * 100}%` }}
            title={`${part.label}: ${part.bytes === null ? 'unknown' : formatBytes(part.bytes)}`}
          />
        ))}
      </div>
      <ul className="mem__legend">
        {parts.map((part) => (
          <li key={part.key} className="mem__key" title={part.title}>
            <span className={`mem__swatch mem__swatch--${part.key}`} />
            {part.label}
            <span className="count">{part.bytes === null ? '—' : formatBytes(part.bytes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FieldRow({ field }: { field: MemField }) {
  const described = describeField(field.name);
  const count = isCount(field);

  return (
    <tr className="mem__row">
      <td className="mem__field" title={described ?? 'This page has no note for this field'}>
        {field.name}
      </td>
      <td className="mem__value">
        {/* A count of pages is not an amount of memory, so it is not turned
            into one — the unit the kernel left off is the whole reason. */}
        {count ? field.value.toLocaleString() : formatBytes(field.value * 1024)}
      </td>
      <td className="mem__unit">
        {count ? (
          <span className="chip" title="A count of pages, not an amount of memory">
            count
          </span>
        ) : (
          <span className="muted" title="Printed as kB, which is KiB — 1024 bytes">
            {field.value.toLocaleString()} kB
          </span>
        )}
      </td>
    </tr>
  );
}

export function MeminfoView({ content }: { content: string }) {
  const info = useMemo(() => parseMeminfo(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  if (info.fields.length === 0) {
    return (
      <p className="notice notice--warn">
        No fields found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const { totals } = summary;

  return (
    <>
      <MemoryBar totals={totals} />

      <section className="summary" data-testid="summary">
        <Stat label="total" value={totals.total === null ? '—' : formatBytes(totals.total)} />
        <Stat
          label="available"
          value={totals.available === null ? '—' : formatBytes(totals.available)}
        />
        <Stat label="in use" value={percent(summary.usedShare)} />
        {totals.swapTotal !== null && totals.swapTotal > 0 && (
          <Stat
            label="swap used"
            value={`${formatBytes(totals.swapUsed ?? 0)} · ${percent(summary.swapShare)}`}
          />
        )}
      </section>

      {/*
       * MemAvailable is the kernel's own estimate rather than a sum of other
       * fields, which is worth saying where the two sit side by side.
       */}
      {totals.available === null ? (
        <p className="notice" role="status">
          This kernel prints no <code>MemAvailable</code>, which arrived in Linux 3.14. Without it
          there is no estimate of what a new program could get, and free memory plus cache is the
          nearest thing — an overestimate, since not all of the cache can actually be given back.
        </p>
      ) : (
        <p className="disks__note muted">
          <strong>{formatBytes(totals.available)}</strong> is the kernel&rsquo;s estimate of what a
          new program could take without swapping — not free memory, and not free plus cache
          either, since some of the cache cannot be given back. Free memory alone is{' '}
          {totals.free === null ? 'unknown' : formatBytes(totals.free)}; a machine with very little
          of that and plenty available is doing exactly what it should.
        </p>
      )}

      {summary.hugePages !== null && (
        <p className="models" data-testid="hugepages">
          <span className="chip chip--model" title="Huge pages reserved — a count, not a size">
            {summary.hugePages.total.toLocaleString()} huge pages
          </span>
          {summary.hugePages.pageBytes !== null && (
            <span className="chip chip--model">
              {formatBytes(summary.hugePages.pageBytes)} each{' '}
              <span className="count">
                {summary.hugePages.poolBytes === null
                  ? ''
                  : `${formatBytes(summary.hugePages.poolBytes)} reserved`}
              </span>
            </span>
          )}
          {summary.hugePages.free !== null && (
            <span className="chip chip--model" title="Reserved, and not yet in use">
              {summary.hugePages.free.toLocaleString()} free
            </span>
          )}
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table mem__table" aria-label="Memory fields">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Value</th>
              <th scope="col">As printed</th>
            </tr>
          </thead>
          <tbody>
            {info.fields.map((field) => (
              <FieldRow key={field.name} field={field} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        The unit the kernel writes as <code>kB</code> is <strong>KiB</strong> — 1024 bytes, not
        1000 — so every size here is shown converted, with the line as printed beside it. The{' '}
        <code>HugePages_*</code> fields carry <strong>no unit at all</strong>: they are counts of
        pages, and only multiplied by <code>Hugepagesize</code> do they mean an amount of memory.
        Which fields appear depends on the kernel and its configuration, so anything this page has
        no note for is still listed. Two that mislead: <code>Cached</code> includes tmpfs, which
        cannot be reclaimed by dropping caches, and <code>Committed_AS</code> may exceed{' '}
        <code>CommitLimit</code> without anything being wrong — the limit binds only when strict
        overcommit accounting is turned on.
      </p>
    </>
  );
}
