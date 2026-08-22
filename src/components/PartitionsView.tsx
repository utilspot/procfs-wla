import { useMemo, useState } from 'react';
import {
  bytes,
  formatBytes,
  groupByDisk,
  isEmpty,
  parsePartitions,
  shareOfDisk,
  summarize,
  unpartitionedBytes,
  type DiskGroup,
  type Partition,
} from '../lib/partitions';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function Row({
  device,
  share,
  partition,
}: {
  device: Partition;
  share: number | null;
  partition: boolean;
}) {
  const empty = isEmpty(device);

  return (
    <tr className={empty ? 'parts__row parts__row--empty' : 'parts__row'}>
      <td className={partition ? 'parts__name parts__name--part' : 'parts__name'}>
        {device.name}
      </td>
      <td className="parts__devno">
        {device.major}:{device.minor}
      </td>
      <td className="parts__number">{empty ? <span className="muted">—</span> : formatBytes(bytes(device))}</td>
      <td className="parts__number">{device.blocks.toLocaleString()}</td>
      <td className="parts__bar-cell">
        {share === null ? null : (
          <span className="parts__bar" title={`${(share * 100).toFixed(1)}% of its disk`}>
            <span className="parts__segment" style={{ width: `${share * 100}%` }} />
          </span>
        )}
      </td>
    </tr>
  );
}

function DiskRows({ group }: { group: DiskGroup }) {
  const leftover = unpartitionedBytes(group);

  return (
    <>
      <Row device={group.disk} share={null} partition={false} />
      {group.partitions.map((partition) => (
        <Row
          key={partition.name}
          device={partition}
          share={shareOfDisk(partition, group.disk)}
          partition
        />
      ))}
      {leftover !== null && leftover > 0 && (
        <tr className="parts__row parts__row--free">
          <td className="parts__name parts__name--part">
            <span className="muted">unpartitioned</span>
          </td>
          <td />
          <td className="parts__number muted">{formatBytes(leftover)}</td>
          <td />
          <td className="parts__bar-cell">
            <span
              className="parts__bar"
              title={`${((leftover / bytes(group.disk)) * 100).toFixed(1)}% of the disk`}
            >
              <span
                className="parts__segment parts__segment--free"
                style={{ width: `${(leftover / bytes(group.disk)) * 100}%` }}
              />
            </span>
          </td>
        </tr>
      )}
    </>
  );
}

export function PartitionsView({ content }: { content: string }) {
  const all = useMemo(() => parsePartitions(content), [content]);
  const summary = useMemo(() => summarize(all), [all]);
  const groups = useMemo(() => groupByDisk(all), [all]);
  const [hideEmpty, setHideEmpty] = useState(false);

  if (all.length === 0) {
    return (
      <p className="notice notice--warn">
        No block devices found in this file. Switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  const visible = hideEmpty ? groups.filter((group) => !isEmpty(group.disk)) : groups;

  return (
    <>
      <section className="summary">
        <Stat label="block devices" value={String(summary.devices)} />
        <Stat label="whole disks" value={String(summary.disks)} />
        <Stat label="partitions" value={String(summary.partitions)} />
        <Stat label="capacity listed" value={formatBytes(summary.totalBytes)} />
      </section>

      <p className="models">
        {summary.largest.slice(0, 5).map((disk) => (
          <span key={disk.name} className="chip chip--model">
            {disk.name} <span className="count">{formatBytes(bytes(disk))}</span>
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
          Hide devices the kernel lists at zero size ({summary.empty} of {summary.devices})
        </label>
      )}

      <div className="card mounts">
        <table className="mounts__table parts__table" aria-label="Block devices by size">
          <thead>
            <tr>
              <th scope="col">Device</th>
              <th scope="col">major:minor</th>
              <th scope="col">Size</th>
              <th scope="col">Blocks</th>
              <th scope="col">Share of disk</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => (
              <DiskRows key={group.disk.name} group={group} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>Blocks</strong> are 1024 bytes each — not the 512-byte sectors{' '}
        <code>/proc/diskstats</code> counts in. Partitions are indented under their disk and left
        out of the capacity, since their space is part of it. Nothing in this file says which
        device is built on which, so an md array or an LVM volume is listed alongside the disks it
        sits on and counted again in the total.
      </p>
    </>
  );
}
