import { useMemo } from 'react';
import {
  accounted,
  byPages,
  bytes,
  formatBytes,
  formatShare,
  isThread,
  PAGE_SIZE,
  parseGpuMemory,
  share,
  summarize,
  unaccounted,
  type GpuMemoryDevice,
  type GpuMemoryProcess,
} from '../lib/gpu_memory';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** A count of pages, with the size it stands for underneath. */
function Pages({ pages }: { pages: number }) {
  return (
    <>
      {pages.toLocaleString()}
      <span className="gpumem__size" title={`${pages.toLocaleString()} pages of ${PAGE_SIZE} bytes`}>
        {formatBytes(bytes(pages))}
      </span>
    </>
  );
}

function ProcessRow({ entry, device }: { entry: GpuMemoryProcess; device: GpuMemoryDevice }) {
  const held = share(entry, device);

  return (
    <tr className="gpumem__row">
      <td className="gpumem__pid">
        {entry.tgid}
        {isThread(entry) && (
          <span className="chip" title={`Opened by thread ${entry.pid}, not the process’s main one`}>
            tid {entry.pid}
          </span>
        )}
      </td>
      <td className="gpumem__number">
        <Pages pages={entry.pages} />
      </td>
      <td className="gpumem__share-cell">
        {held === null ? (
          <span className="muted" title="The device is holding nothing, so there is no share to take">
            —
          </span>
        ) : (
          <div className="gpumem__share">
            <span
              className="gpumem__bar"
              title={`${formatBytes(bytes(entry.pages))} of ${formatBytes(bytes(device.pages))}`}
            >
              <span className="gpumem__segment" style={{ width: `${held * 100}%` }} />
            </span>
            <span className="gpumem__figures">{formatShare(held)}</span>
          </div>
        )}
      </td>
    </tr>
  );
}

export function GpuMemoryView({ content }: { content: string }) {
  const memory = useMemo(() => parseGpuMemory(content), [content]);
  const ranked = useMemo(() => byPages(memory), [memory]);
  const summary = useMemo(() => summarize(memory), [memory]);

  if (memory.device === null) {
    return (
      <p className="notice notice--warn">
        No device line in this file, so there is nothing here saying which GPU these pages belong
        to. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const device = memory.device;
  const spare = unaccounted(memory) ?? 0;

  return (
    <>
      {spare !== 0 && (
        <p className="notice" role="status">
          The rows account for {formatBytes(bytes(accounted(memory)))} of the{' '}
          {formatBytes(bytes(device.pages))} {device.name} is holding
          {spare > 0 ? (
            <>
              , leaving {formatBytes(bytes(spare))} no process claims — the driver&rsquo;s own
              pages, or a process gone since the counts were taken.
            </>
          ) : (
            <>
              , which is {formatBytes(bytes(-spare))} more than the device says it has: the file
              was read while allocations were moving.
            </>
          )}
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="device" value={device.name} />
        <Stat label="held" value={formatBytes(bytes(device.pages))} />
        <Stat label="processes" value={String(summary.processes)} />
        {summary.largest !== null && (
          <Stat label="largest" value={`pid ${summary.largest.tgid}`} />
        )}
      </section>

      <div className="card gpumem__device">
        <h2 className="gpumem__device-name">{device.name}</h2>
        <dl className="gpumem__device-fields">
          <div>
            <dt>Pages</dt>
            <dd>{device.pages.toLocaleString()}</dd>
          </div>
          <div>
            <dt>At {formatBytes(PAGE_SIZE)} a page</dt>
            <dd>{formatBytes(bytes(device.pages))}</dd>
          </div>
          <div>
            <dt>Claimed by rows</dt>
            <dd>{formatBytes(bytes(accounted(memory)))}</dd>
          </div>
        </dl>
      </div>

      {ranked.length === 0 ? (
        <p className="notice" role="status">
          No process is holding memory on {device.name}: the header is there with nothing under it.
        </p>
      ) : (
        <div className="card mounts">
          <table className="mounts__table gpumem__table" aria-label="GPU memory per process">
            <thead>
              <tr>
                <th scope="col">Process</th>
                <th scope="col">Pages</th>
                <th scope="col">Share of the device</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((entry) => (
                <ProcessRow key={`${entry.tgid}-${entry.pid}`} entry={entry} device={device} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="disks__note muted">
        Every number in this file is a <strong>count of pages</strong>, and the file never says how
        big one is — the sizes here are that count at {formatBytes(PAGE_SIZE)} a page, which is
        what a Mali driver allocates in, and a kernel built with larger pages would make every size
        on this page wrong by that factor while every count stayed right. <code>TGID</code> is the
        process and <code>PID</code> is the <em>thread</em> inside it that opened the device, so a
        row where they differ belongs to a thread rather than to a second process, and two rows
        with the same <code>TGID</code> are one process holding memory through two of them. Unlike{' '}
        <code>/proc/gpu_load</code>, where the device counters and the per-context ones are kept
        separately, here the device line and the rows are the same accounting seen twice — so they
        normally add up, and where they do not the difference is pages the driver holds for itself
        or a process that has gone since. The file is the Mali driver&rsquo;s rather than the
        kernel&rsquo;s: a machine without that driver has no <code>/proc/gpu_memory</code> to read.
      </p>
    </>
  );
}
