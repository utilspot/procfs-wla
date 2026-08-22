import { useMemo } from 'react';
import {
  byActive,
  contextActive,
  exceedsDevice,
  formatDuration,
  formatShare,
  hasNoIdle,
  isKernelContext,
  isThread,
  nsToSeconds,
  parseGpuLoad,
  span,
  summarize,
  utilization,
  type GpuContext,
  type GpuDevice,
} from '../lib/gpu_load';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The share of its span something has been active, as a bar and the figure. */
function Load({ entry }: { entry: GpuDevice | GpuContext }) {
  const share = utilization(entry);

  if (share === null) {
    return (
      <span className="muted" title="Neither counter has run, so there is no share to take">
        —
      </span>
    );
  }

  const idle = hasNoIdle(entry);

  return (
    <div className="gpu__load">
      <span
        className="gpu__bar"
        title={`${formatDuration(nsToSeconds(entry.active))} active of ${formatDuration(
          nsToSeconds(span(entry)),
        )}`}
      >
        <span
          className={idle ? 'gpu__segment gpu__segment--unmeasured' : 'gpu__segment'}
          style={{ width: `${share * 100}%` }}
        />
      </span>
      <span className="gpu__figures">
        {formatShare(share)}
        {idle && (
          <span className="chip" title="No inactive time counted against it, so this is not a share of anything">
            no idle
          </span>
        )}
      </span>
    </div>
  );
}

/** Who holds a context: the process, and the thread where that is not the same. */
function Holder({ context }: { context: GpuContext }) {
  if (isKernelContext(context)) {
    return (
      <span className="chip" title="Id, tgid and pid all zero: the driver’s own context">
        driver
      </span>
    );
  }

  return (
    <>
      {context.tgid}
      {isThread(context) && (
        <span className="chip" title={`Opened by thread ${context.pid}, not the process’s main one`}>
          tid {context.pid}
        </span>
      )}
    </>
  );
}

function ContextRow({ context }: { context: GpuContext }) {
  return (
    <tr className="gpu__row">
      <td className="gpu__id">{context.id}</td>
      <td className="gpu__holder">
        <Holder context={context} />
      </td>
      <td className="gpu__number">{formatDuration(nsToSeconds(context.active))}</td>
      <td className="gpu__number">{formatDuration(nsToSeconds(context.inactive))}</td>
      <td className="gpu__load-cell">
        <Load entry={context} />
      </td>
    </tr>
  );
}

export function GpuLoadView({ content }: { content: string }) {
  const load = useMemo(() => parseGpuLoad(content), [content]);
  const ranked = useMemo(() => byActive(load), [load]);
  const summary = useMemo(() => summarize(load), [load]);

  if (load.device === null) {
    return (
      <p className="notice notice--warn">
        No device line in this file, so there is nothing here saying which GPU these durations
        belong to. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const device = load.device;

  return (
    <>
      {exceedsDevice(load) && (
        <p className="notice" role="status">
          The contexts have been active for {formatDuration(nsToSeconds(contextActive(load)))}{' '}
          between them and the device for {formatDuration(nsToSeconds(device.active))}. Neither
          number is wrong: the two counters are kept separately and each starts when the thing it
          belongs to does, so the device line is not the total of the rows.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="device" value={device.name} />
        <Stat
          label="device active"
          value={utilization(device) === null ? '—' : formatShare(utilization(device)!)}
        />
        <Stat label="contexts" value={String(summary.contexts)} />
        <Stat label="processes" value={String(summary.processes)} />
        {summary.busiest !== null && (
          <Stat label="most active" value={`pid ${summary.busiest.tgid}`} />
        )}
      </section>

      <div className="card gpu__device">
        <h2 className="gpu__device-name">{device.name}</h2>
        <dl className="gpu__device-fields">
          <div>
            <dt>Active</dt>
            <dd>{formatDuration(nsToSeconds(device.active))}</dd>
          </div>
          <div>
            <dt>Inactive</dt>
            <dd>{formatDuration(nsToSeconds(device.inactive))}</dd>
          </div>
          <div>
            <dt>Counted over</dt>
            <dd>{formatDuration(nsToSeconds(span(device)))}</dd>
          </div>
        </dl>
        <Load entry={device} />
      </div>

      {ranked.length === 0 ? (
        <p className="notice" role="status">
          Nothing holds a context on {device.name}: the header is there and no process has the
          device open.
        </p>
      ) : (
        <div className="card mounts">
          <table className="mounts__table gpu__table" aria-label="GPU contexts and their load">
            <thead>
              <tr>
                <th scope="col">id</th>
                <th scope="col">Process</th>
                <th scope="col">Active</th>
                <th scope="col">Inactive</th>
                <th scope="col">Share active</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((context) => (
                <ContextRow key={context.id} context={context} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="disks__note muted">
        Every number here is in <strong>nanoseconds</strong>, which the column names say and the
        device line does not — and what they are for is the ratio between them, since active plus
        inactive is the span that counter has been running rather than a wall clock anyone chose.
        A row is one <strong>context</strong>: what a process gets when it opens the device, so a
        process holding two has two rows and the <code>tgid</code> column is what says so. That
        column is the process and <code>pid</code> is the <em>thread</em> inside it that opened
        the device, which is why the two differ on a row rather than being the same number twice.
        The row with all three ids at zero is the driver&rsquo;s own, and it usually has no
        inactive time at all — nothing has been counted against it, so its 100% is not a share of
        anything. The file is the Mali driver&rsquo;s rather than the kernel&rsquo;s: a machine
        without that driver has no <code>/proc/gpu_load</code> to read.
      </p>
    </>
  );
}
