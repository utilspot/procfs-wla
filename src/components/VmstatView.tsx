import { useMemo, useState } from 'react';
import {
  bytesOf,
  describeField,
  FAMILIES,
  familyOf,
  formatBytes,
  formatCount,
  formatShare,
  PAGE_SIZE,
  parseVmstat,
  POOR_EFFICIENCY,
  summarize,
  type VmstatField,
} from '../lib/vmstat';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function FieldRow({ field }: { field: VmstatField }) {
  const bytes = bytesOf(field);
  const described = describeField(field.name);

  return (
    <tr className={field.value === 0 ? 'vs__row vs__row--zero' : 'vs__row'}>
      <td className="vs__name">{field.name}</td>
      <td className="vs__number" title={`${field.value.toLocaleString()} ${field.unit}`}>
        {formatCount(field.value)}
      </td>
      <td className="vs__number">
        {bytes === null ? (
          <span className="muted" title="A count of events, not of memory">
            —
          </span>
        ) : (
          <span
            title={
              field.unit === 'kilobytes'
                ? 'Counted in kilobytes by the kernel, not in pages'
                : `${field.value.toLocaleString()} × ${formatBytes(PAGE_SIZE)} pages`
            }
          >
            {formatBytes(bytes)}
          </span>
        )}
      </td>
      <td className="vs__note">
        {described ?? <span className="muted">A field this page has no note for</span>}
      </td>
    </tr>
  );
}

function FieldTable({ fields, label }: { fields: VmstatField[]; label: string }) {
  return (
    <div className="card mounts vs">
      <table className="mounts__table vs__table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Value</th>
            <th scope="col">Memory</th>
            <th scope="col">What it is</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <FieldRow key={field.name} field={field} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VmstatView({ content }: { content: string }) {
  const fields = useMemo(() => parseVmstat(content), [content]);
  const summary = useMemo(() => summarize(fields), [fields]);
  const [hideZeros, setHideZeros] = useState(false);

  const zeros = useMemo(() => fields.filter((field) => field.value === 0).length, [fields]);
  const shown = useMemo(
    () => (hideZeros ? fields.filter((field) => field.value !== 0) : fields),
    [fields, hideZeros],
  );

  if (fields.length === 0) {
    return (
      <p className="notice notice--warn">
        No fields found in this file. It is a couple of hundred <code>name value</code> lines —
        switch to the raw view to see what the server returned.
      </p>
    );
  }

  const { reclaim, numa } = summary;
  const gauges = shown.filter((field) => field.gauge);
  const poorEfficiency = reclaim.efficiency !== null && reclaim.efficiency < POOR_EFFICIENCY;

  return (
    <>
      {summary.oomKills !== null && summary.oomKills > 0 && (
        <p className="notice notice--warn" role="status" data-testid="oom">
          The out-of-memory killer has killed {summary.oomKills.toLocaleString()}{' '}
          {summary.oomKills === 1 ? 'process' : 'processes'} since boot. That is a counter, not a
          state — it says this happened at some point, not that anything is wrong now.
        </p>
      )}

      {reclaim.scannedDirect > 0 && (
        <p className="notice notice--warn" role="status" data-testid="direct-reclaim">
          {formatShare(reclaim.directShare ?? 0)} of reclaim scanning was{' '}
          <strong>direct reclaim</strong> — a process that wanted memory being made to go and free
          some itself before its allocation could proceed, which is felt as a stall rather than
          seen as load
          {reclaim.stalls > 0 && `, and ${formatCount(reclaim.stalls)} allocations stalled that way`}
          .{' '}
          {poorEfficiency &&
            `The kernel got back ${formatShare(reclaim.efficiency ?? 0)} of what it examined, ` +
              'so it is walking a long way for every page.'}
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat
          label="free"
          value={summary.freeBytes === null ? '—' : formatBytes(summary.freeBytes)}
        />
        <Stat
          label="page cache"
          value={summary.cacheBytes === null ? '—' : formatBytes(summary.cacheBytes)}
        />
        <Stat
          label="anonymous"
          value={summary.anonBytes === null ? '—' : formatBytes(summary.anonBytes)}
        />
        <Stat label="fields" value={String(summary.fields)} />
      </section>

      <p className="models" data-testid="derived">
        <span
          className="chip chip--model"
          title="Pages recovered per page examined — low means it is working hard for them"
        >
          reclaim efficiency{' '}
          <span className="count">
            {reclaim.efficiency === null ? 'never reclaimed' : formatShare(reclaim.efficiency)}
          </span>
        </span>
        <span className="chip chip--model" title="Faults that had to wait for a disk">
          major faults <span className="count">{formatCount(summary.majorFaults ?? 0)}</span>
        </span>
        <span
          className="chip chip--model"
          title="Pages read back from swap and written to it, since boot"
        >
          swap{' '}
          <span className="count">
            {formatCount(summary.swapInPages ?? 0)} in · {formatCount(summary.swapOutPages ?? 0)} out
          </span>
        </span>
        {summary.refaults > 0 && (
          <span
            className="chip chip--flag"
            title="Pages that were evicted and then needed again — what being short of memory costs"
          >
            refaults <span className="count">{formatCount(summary.refaults)}</span>
          </span>
        )}
        {numa !== null && numa.miss > 0 && (
          <span
            className="chip chip--flag"
            title="Allocations that could not be satisfied on the node that asked, and came off another"
          >
            NUMA miss <span className="count">{formatShare(numa.missShare ?? 0)}</span>
          </span>
        )}
      </p>

      <label className="mounts__filter">
        <input
          type="checkbox"
          checked={hideZeros}
          onChange={(event) => setHideZeros(event.target.checked)}
        />
        Hide fields sitting at zero ({zeros} of {fields.length})
      </label>

      <h2 className="vs__heading">
        Levels <span className="muted">— what is true right now, in pages</span>
      </h2>
      <FieldTable fields={gauges} label="Levels" />

      <h2 className="vs__heading">
        Counters <span className="muted">— totals since boot, which only ever go up</span>
      </h2>
      {FAMILIES.map((family) => {
        const inFamily = shown.filter(
          (field) => !field.gauge && familyOf(field.name) === family.id,
        );
        if (inFamily.length === 0) return null;

        return (
          <section key={family.id} className="vs__family">
            <h3 className="vs__familyName">{family.label}</h3>
            <FieldTable fields={inFamily} label={family.label} />
          </section>
        );
      })}

      <p className="disks__note muted">
        Two kinds of number are mixed together in this file, and telling them apart is most of
        reading it: everything named <code>nr_*</code> is a <strong>level</strong> — what is true
        at the moment you read it — and everything else is a <strong>counter since boot</strong>{' '}
        that only ever goes up. Charting one as the other gets the machine backwards, which is why
        they are in separate tables here. <code>workingset_nodes</code> is the one level not named{' '}
        <code>nr_*</code>. The units are not uniform either: most levels are in pages, but{' '}
        <strong>
          <code>pgpgin</code> and <code>pgpgout</code> are in kilobytes
        </strong>{' '}
        — which is why <code>vmstat -s</code> labels them &ldquo;K paged in&rdquo; — and{' '}
        <code>nr_kernel_stack</code> is too, while <code>pswpin</code> and <code>pswpout</code>{' '}
        beside them really are pages. Which fields exist at all depends on the kernel and its
        configuration, so <strong>an absent field is not a zero</strong>: a kernel built without
        transparent hugepages has no <code>thp_*</code> whatsoever. The reclaim figures above are
        summed by prefix for that reason — a 3.x kernel counts scanning per zone, as{' '}
        <code>pgscan_kswapd_normal</code> and the rest, where a modern one has a single{' '}
        <code>pgscan_kswapd</code>.
      </p>
    </>
  );
}
