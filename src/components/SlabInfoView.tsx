import { useMemo, useState } from 'react';
import {
  bytes,
  formatBytes,
  isUnderused,
  parseSlabInfo,
  summarize,
  utilization,
  type Slab,
} from '../lib/slabinfo';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function SlabRow({ slab, share }: { slab: Slab; share: number }) {
  const used = utilization(slab);
  const empty = slab.numObjs === 0;

  return (
    <tr className={empty ? 'slabs__row slabs__row--empty' : 'slabs__row'}>
      <td className="slabs__name">
        {slab.name}
        {isUnderused(slab) && (
          <span className="chip chip--bug" title="Holds memory with most of its objects free">
            underused
          </span>
        )}
      </td>
      <td className="slabs__number">{formatBytes(bytes(slab))}</td>
      <td className="slabs__bar-cell">
        <span className="slabs__bar" title={`${(share * 100).toFixed(1)}% of all slab memory`}>
          <span className="slabs__segment" style={{ width: `${share * 100}%` }} />
        </span>
      </td>
      <td className="slabs__number">
        {empty ? (
          <span className="muted">—</span>
        ) : (
          `${(used * 100).toFixed(used < 10 ? 1 : 0)}%`
        )}
      </td>
      <td className="slabs__number">{slab.activeObjs.toLocaleString()}</td>
      <td className="slabs__number">{slab.numObjs.toLocaleString()}</td>
      <td className="slabs__number">{slab.objSize.toLocaleString()}</td>
      <td className="slabs__number">{(slab.slabData?.numSlabs ?? 0).toLocaleString()}</td>
    </tr>
  );
}

export function SlabInfoView({ content }: { content: string }) {
  const info = useMemo(() => parseSlabInfo(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);
  const [hideEmpty, setHideEmpty] = useState(false);

  if (info.slabs.length === 0) {
    return (
      <p className="notice notice--warn">
        No slab caches found in this file. On a modern kernel <code>/proc/slabinfo</code> is
        readable by root only, so an unprivileged backend may see it empty. Switch to the raw view
        to see what the server returned.
      </p>
    );
  }

  const underused = info.slabs.filter(isUnderused);
  const visible = hideEmpty
    ? summary.largest.filter((slab) => slab.numObjs > 0)
    : summary.largest;
  const biggest = bytes(summary.largest[0]!) || 1;

  return (
    <>
      {underused.length > 0 && (
        <p className="notice notice--warn" role="status">
          {underused.length} {underused.length === 1 ? 'cache holds' : 'caches hold'} memory with
          most of their objects free:{' '}
          {underused
            .map((slab) => `${slab.name} (${formatBytes(bytes(slab))} at ${(utilization(slab) * 100).toFixed(0)}%)`)
            .join(', ')}
          .
        </p>
      )}

      <section className="summary">
        <Stat label="slab memory" value={formatBytes(summary.totalBytes)} />
        <Stat label="in objects in use" value={formatBytes(summary.activeBytes)} />
        <Stat label="caches" value={String(summary.caches)} />
        <Stat
          label="objects in use"
          value={`${summary.activeObjs.toLocaleString()} / ${summary.numObjs.toLocaleString()}`}
        />
      </section>

      <p className="models">
        {summary.largest.slice(0, 5).map((slab) => (
          <span key={slab.name} className="chip chip--model">
            {slab.name} <span className="count">{formatBytes(bytes(slab))}</span>
          </span>
        ))}
      </p>

      {summary.empty > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(event) => setHideEmpty(event.target.checked)}
          />
          Hide caches holding nothing ({summary.empty} of {summary.caches})
        </label>
      )}

      <div className="card mounts">
        <table className="mounts__table slabs__table" aria-label="Slab caches by memory held">
          <thead>
            <tr>
              <th scope="col">Cache</th>
              <th scope="col">Memory</th>
              <th scope="col">Share</th>
              <th scope="col">Used</th>
              <th scope="col">Active</th>
              <th scope="col">Total</th>
              <th scope="col">Object</th>
              <th scope="col">Slabs</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((slab) => (
              <SlabRow key={slab.name} slab={slab} share={bytes(slab) / biggest} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        Memory is the pages the allocator holds ({'num_slabs × pagesperslab'}), assuming a 4 KiB
        page — the file reports pages, not bytes. Objects in use account for{' '}
        {formatBytes(summary.activeBytes)} of the{' '}
        {formatBytes(summary.totalBytes)}; the rest is the allocator keeping pages it has not
        handed back. Object sizes are in bytes.
      </p>
    </>
  );
}
