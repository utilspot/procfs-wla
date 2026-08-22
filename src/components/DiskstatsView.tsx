import { useMemo, useState } from 'react';
import {
  formatBytes,
  formatDuration,
  isIdle,
  isPartitionOf,
  parseDiskstats,
  summarize,
  type DiskStat,
} from '../lib/diskstats';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function DeviceRow({ stat, partitionOf }: { stat: DiskStat; partitionOf: DiskStat | undefined }) {
  const idle = isIdle(stat);

  return (
    <tr className={idle ? 'disks__row disks__row--idle' : 'disks__row'}>
      <td className={partitionOf === undefined ? 'disks__device' : 'disks__device disks__device--part'}>
        {stat.device}
        <span className="disks__devno">
          {stat.major}:{stat.minor}
        </span>
      </td>
      <td className="disks__number">{stat.reads.completed.toLocaleString()}</td>
      <td className="disks__number">{formatBytes(stat.reads.bytes)}</td>
      <td className="disks__number">{stat.writes.completed.toLocaleString()}</td>
      <td className="disks__number">{formatBytes(stat.writes.bytes)}</td>
      <td className="disks__number">
        {stat.discards === undefined ? (
          <span className="muted" title="Not reported by this kernel">
            —
          </span>
        ) : (
          formatBytes(stat.discards.bytes)
        )}
      </td>
      <td className="disks__number">{stat.inFlight > 0 ? stat.inFlight : ''}</td>
      <td className="disks__number">{formatDuration(stat.ioMs)}</td>
    </tr>
  );
}

export function DiskstatsView({ content }: { content: string }) {
  const stats = useMemo(() => parseDiskstats(content), [content]);
  const summary = useMemo(() => summarize(stats), [stats]);
  const [hideIdle, setHideIdle] = useState(false);

  if (stats.length === 0) {
    return (
      <p className="notice notice--warn">
        No devices found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const idleCount = stats.filter(isIdle).length;
  const visible = hideIdle ? stats.filter((stat) => !isIdle(stat)) : stats;

  return (
    <>
      <section className="summary">
        <Stat label="devices" value={String(summary.devices)} />
        <Stat label="read" value={formatBytes(summary.bytesRead)} />
        <Stat label="written" value={formatBytes(summary.bytesWritten)} />
        {summary.busiest !== undefined && (
          <Stat label="busiest device" value={summary.busiest.device} />
        )}
        {summary.inFlight > 0 && <Stat label="in flight" value={String(summary.inFlight)} />}
      </section>

      <p className="models muted disks__note">
        Counters are cumulative since boot. Totals cover whole disks only, since partitions repeat
        their disk's I/O.
      </p>

      <label className="mounts__filter">
        <input
          type="checkbox"
          checked={hideIdle}
          onChange={(event) => setHideIdle(event.target.checked)}
        />
        Hide devices with no I/O ({idleCount} of {stats.length})
      </label>

      <div className="card mounts">
        <table className="mounts__table disks__table">
          <thead>
            <tr>
              <th scope="col">Device</th>
              <th scope="col">Reads</th>
              <th scope="col">Read</th>
              <th scope="col">Writes</th>
              <th scope="col">Written</th>
              <th scope="col">Discarded</th>
              <th scope="col">In flight</th>
              <th scope="col">I/O time</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((stat) => (
              <DeviceRow
                key={`${stat.major}:${stat.minor}:${stat.device}`}
                stat={stat}
                partitionOf={isPartitionOf(stat, stats)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
