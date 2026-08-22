import { useMemo, useState } from 'react';
import {
  describeField,
  describeFlag,
  field,
  formatKib,
  formatShare,
  isMemoryField,
  isReservation,
  isShared,
  isWritableExecutable,
  KINDS,
  kindOf,
  labelOf,
  parseSmaps,
  sharedShare,
  summarize,
  type Mapping,
} from '../lib/smaps';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** Mappings shown before the rest are folded away. */
const SHOWN = 12;

function MappingCard({ mapping }: { mapping: Mapping }) {
  const [open, setOpen] = useState(false);
  const kind = kindOf(mapping);
  const shared = sharedShare(mapping);
  const rss = field(mapping, 'Rss') ?? 0;

  return (
    <section className="card sm" aria-label={`${mapping.start} ${labelOf(mapping)}`}>
      <h3 className="sm__name">
        <span className="sm__label">{labelOf(mapping)}</span>
        <span className="chip chip--type" title={KINDS[kind]}>
          {kind}
        </span>
        {isWritableExecutable(mapping) && (
          <span
            className="chip chip--ro"
            title="Writable and executable at once — what a JIT needs, and what an exploit needs too"
          >
            w+x
          </span>
        )}
        {isReservation(mapping) && (
          <span
            className="chip chip--type"
            title="Address space claimed with nothing resident in it — room to hand out later"
          >
            reservation
          </span>
        )}
        {isShared(mapping) && (
          <span className="chip chip--type" title="A shared mapping: writes go back to the file">
            shared
          </span>
        )}
      </h3>

      <p className="sm__where muted">
        <code>
          {mapping.start}-{mapping.end}
        </code>{' '}
        <code>{mapping.perms}</code>
        {mapping.path !== '' && mapping.path !== labelOf(mapping) && (
          <span className="sm__path"> {mapping.path}</span>
        )}
      </p>

      <p className="sm__headline">
        <span className="chip chip--model" title="Address space this mapping covers">
          size <span className="count">{formatKib(field(mapping, 'Size') ?? 0)}</span>
        </span>
        <span className="chip chip--model" title="Of it, resident — counted whole">
          rss <span className="count">{formatKib(rss)}</span>
        </span>
        <span
          className="chip chip--flag"
          title="The same pages counted proportionally — the figure that adds up across processes"
        >
          pss <span className="count">{formatKib(field(mapping, 'Pss') ?? 0)}</span>
        </span>
        {shared !== null && shared > 0.01 && (
          <span className="chip chip--model" title="How much of its resident memory it shares">
            shared <span className="count">{formatShare(shared)}</span>
          </span>
        )}
        {(field(mapping, 'Swap') ?? 0) > 0 && (
          <span className="chip chip--flag" title="Pages of it written out to swap">
            swap <span className="count">{formatKib(field(mapping, 'Swap') ?? 0)}</span>
          </span>
        )}
      </p>

      <button type="button" className="link-button" onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Show'} all {mapping.fields.length} fields
      </button>

      {open && (
        <>
          <table
            className="mounts__table sm__table"
            aria-label={`${mapping.start} fields`}
          >
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Value</th>
                <th scope="col">What it is</th>
              </tr>
            </thead>
            <tbody>
              {mapping.fields.map((entry) => (
                <tr key={entry.name} className={entry.value === 0 ? 'sm__row sm__row--zero' : 'sm__row'}>
                  <td className="sm__field">{entry.name}</td>
                  <td className="sm__number">
                    {isMemoryField(entry.name) ? formatKib(entry.value) : entry.value}
                  </td>
                  <td className="sm__note">
                    {describeField(entry.name) ?? (
                      <span className="muted">A field this page has no note for</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {mapping.flags.length > 0 && (
            <p className="sm__flags">
              {mapping.flags.map((flag) => (
                <span key={flag} className="chip" title={describeFlag(flag) ?? undefined}>
                  {flag}
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function SmapsView({ content }: { content: string }) {
  const mappings = useMemo(() => parseSmaps(content), [content]);
  const summary = useMemo(() => summarize(mappings), [mappings]);
  const [showAll, setShowAll] = useState(false);

  if (mappings.length === 0) {
    return (
      <p className="notice notice--warn">
        No mappings found in this file. A process always has some, so an empty answer usually means
        the process is gone or the backend could not read it — switch to the raw view to see what
        the server returned.
      </p>
    );
  }

  const visible = showAll ? summary.largest : summary.largest.slice(0, SHOWN);

  return (
    <>
      {summary.writableExecutable.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="wx">
          {summary.writableExecutable.map((mapping) => labelOf(mapping)).join(', ')}{' '}
          {summary.writableExecutable.length === 1 ? 'is' : 'are'} both{' '}
          <strong>writable and executable</strong>. A runtime that generates code needs exactly
          that, so on a JIT it is expected — but it is also what turns a memory-corruption bug into
          a way to run code, which is why nothing else should have one.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="proportional (Pss)" value={formatKib(summary.pssKib)} />
        <Stat label="resident (Rss)" value={formatKib(summary.rssKib)} />
        <Stat label="address space" value={formatKib(summary.sizeKib)} />
        <Stat label="mappings" value={String(summary.mappings)} />
      </section>

      <p className="models" data-testid="flags">
        {summary.sharedShare !== null && (
          <span
            className="chip chip--model"
            title="Resident memory this process shares with another — the gap between Rss and Pss"
          >
            shared <span className="count">{formatShare(summary.sharedShare)}</span>
          </span>
        )}
        <span
          className="chip chip--model"
          title="Private and written to: what this process alone would have to have swapped out"
        >
          private dirty <span className="count">{formatKib(summary.privateDirtyKib)}</span>
        </span>
        {summary.swapKib > 0 && (
          <span className="chip chip--flag" title="Pages of this process written out to swap">
            swap <span className="count">{formatKib(summary.swapKib)}</span>
          </span>
        )}
        {summary.anonHugeKib > 0 && (
          <span className="chip chip--model" title="Anonymous memory backed by transparent hugepages">
            huge pages <span className="count">{formatKib(summary.anonHugeKib)}</span>
          </span>
        )}
        {summary.reservations.length > 0 && (
          <span
            className="chip chip--flag"
            title="Mappings holding address space with nothing resident in them"
          >
            reservations <span className="count">{summary.reservations.length}</span>
          </span>
        )}
      </p>

      <div className="card mounts sm__kinds">
        <table className="mounts__table sm__table" aria-label="Memory by kind of mapping">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Mappings</th>
              <th scope="col">Address space</th>
              <th scope="col">Resident</th>
              <th scope="col">Proportional</th>
            </tr>
          </thead>
          <tbody>
            {summary.byKind.map((entry) => (
              <tr key={entry.kind} className="sm__row">
                <td className="sm__field" title={KINDS[entry.kind]}>
                  {entry.kind}
                </td>
                <td className="sm__number">{entry.mappings}</td>
                <td className="sm__number">{formatKib(entry.sizeKib)}</td>
                <td className="sm__number">{formatKib(entry.rssKib)}</td>
                <td className="sm__number">{formatKib(entry.pssKib)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted" data-testid="ordering">
        The mappings below are in order of what they proportionally cost, largest first
        {mappings.length > SHOWN && !showAll && ` — the first ${SHOWN} of ${mappings.length}`}.
      </p>

      <div className="md__arrays">
        {visible.map((mapping) => (
          <MappingCard key={`${mapping.start}-${mapping.end}`} mapping={mapping} />
        ))}
      </div>

      {mappings.length > SHOWN && (
        <button type="button" className="link-button" onClick={() => setShowAll(!showAll)}>
          {showAll ? `Show only the largest ${SHOWN}` : `Show all ${mappings.length} mappings`}
        </button>
      )}

      <p className="disks__note muted">
        The number this file exists for is <strong>Pss</strong>, the proportional set size: a page
        mapped by four processes counts as a quarter of a page in each of them. <code>Rss</code>{' '}
        counts it whole in all four, so adding Rss across processes invents memory that is not
        there — which is why a machine&rsquo;s processes appear to want more than it has.{' '}
        <strong><code>Size</code> is address space, not memory</strong>: a mapping can span
        gigabytes and hold nothing, which is what an allocator&rsquo;s <code>---p</code> reservation
        is for. <code>Rss</code> is the sum of the four Shared/Private, Clean/Dirty fields, and{' '}
        <strong><code>Private_Dirty</code> is the part that is really this process&rsquo;s</strong>:
        clean file pages can be dropped and read back, but private dirty ones have to go to swap or
        stay. <code>kB</code> here means KiB, as in <code>/proc/meminfo</code>, and{' '}
        <code>THPeligible</code> and <code>ProtectionKey</code> are not amounts of memory at all.
        Reading this file walks the process&rsquo;s page tables, so it is expensive on a large
        process — <code>smaps_rollup</code> gives these totals without the per-mapping detail.
      </p>
    </>
  );
}
