import { useMemo } from 'react';
import {
  describeArea,
  formatKib,
  formatShare,
  freeKib,
  isAutoPriority,
  isZram,
  parseSwaps,
  summarize,
  usedShare,
  type PriorityGroup,
  type SwapArea,
} from '../lib/swaps';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function AreaRow({ area }: { area: SwapArea }) {
  const share = usedShare(area);

  return (
    <tr className={area.usedKib === 0 ? 'swap__row swap__row--untouched' : 'swap__row'}>
      <td className="swap__name" title={describeArea(area)}>
        {area.filename}
        {isZram(area) && (
          <span
            className="chip chip--type"
            title="Swap into compressed RAM rather than onto a disk"
          >
            compressed RAM
          </span>
        )}
      </td>
      <td className="swap__type">{area.type}</td>
      <td
        className="swap__number"
        title={
          isAutoPriority(area)
            ? 'The kernel’s own number, counting down as each area was swapped on'
            : 'Asked for with swapon --priority'
        }
      >
        {area.priority}
        {isAutoPriority(area) && <span className="swap__auto"> auto</span>}
      </td>
      <td className="swap__number" title={`${area.sizeKib.toLocaleString()} KiB`}>
        {formatKib(area.sizeKib)}
      </td>
      <td className="swap__number" title={`${area.usedKib.toLocaleString()} KiB`}>
        {formatKib(area.usedKib)}
      </td>
      <td className="swap__number">{formatKib(freeKib(area))}</td>
      <td className="swap__bar">
        <span
          className="swap__meter"
          role="img"
          aria-label={`${formatShare(share)} of ${area.filename} in use`}
        >
          <span className="swap__fill" style={{ width: `${Math.min(100, share * 100)}%` }} />
        </span>
        <span className="swap__percent">{formatShare(share)}</span>
      </td>
    </tr>
  );
}

/** One rung of the fill order: everything at a priority, used together. */
function Group({ group, position }: { group: PriorityGroup; position: number }) {
  return (
    <span className="chip chip--model" title={`Priority ${group.priority}`}>
      {position === 0 ? 'first' : 'then'}{' '}
      {group.areas.map((area) => area.filename).join(' + ')}
      {group.striped && <span className="count">striped</span>}
    </span>
  );
}

export function SwapsView({ content }: { content: string }) {
  const swaps = useMemo(() => parseSwaps(content), [content]);
  const summary = useMemo(() => summarize(swaps), [swaps]);

  // The header with nothing under it is a machine with no swap; no header at
  // all is not this file.
  if (!swaps.header && swaps.areas.length === 0) {
    return (
      <p className="notice notice--warn">
        No swap areas and no header found in this file. Switch to the raw view to see what the
        server returned.
      </p>
    );
  }

  if (swaps.areas.length === 0) {
    return (
      <p className="notice" role="status">
        Nothing is swapped on. The file has its header and no areas under it, which is what a
        container or a cloud image without a swap file looks like — anonymous memory has nowhere
        to go, so the kernel reclaims page cache instead and the OOM killer is what comes next.
      </p>
    );
  }

  return (
    <>
      {summary.nearlyFull && (
        <p className="notice notice--warn" role="status">
          {formatShare(summary.usedShare)} of swap is spoken for, with{' '}
          {formatKib(summary.freeKib)} left. Swap filling up is not itself the problem — it is
          that there is nowhere for the next burst to go, and the OOM killer is what happens
          instead.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="swap" value={formatKib(summary.totalKib)} />
        <Stat
          label="used"
          value={`${formatKib(summary.usedKib)} · ${formatShare(summary.usedShare)}`}
        />
        <Stat label="free" value={formatKib(summary.freeKib)} />
        <Stat label="areas" value={String(summary.areas)} />
      </section>

      <p className="models" data-testid="fill-order">
        {summary.groups.map((group, index) => (
          <Group key={group.priority} group={group} position={index} />
        ))}
      </p>

      <div className="card mounts swap">
        <table className="mounts__table swap__table" aria-label="Swap areas">
          <thead>
            <tr>
              <th scope="col">Filename</th>
              <th scope="col">Type</th>
              <th scope="col">Priority</th>
              <th scope="col">Size</th>
              <th scope="col">Used</th>
              <th scope="col">Free</th>
              <th scope="col">In use</th>
            </tr>
          </thead>
          <tbody>
            {swaps.areas.map((area) => (
              <AreaRow key={area.filename} area={area} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>Size and Used are KiB</strong>, though the file prints no unit, and both are the
        area&rsquo;s own accounting rather than the file or partition&rsquo;s. Size is a page short
        of what backs it — the first page holds the swap header, which is why an 8 GiB file reports
        8388604 KiB. <strong>Used counts allocated slots, not pages that are only on disk</strong>:
        a page read back in keeps its slot until something frees the entry, so a machine that
        swapped hard an hour ago and has been idle since still reads as using swap.{' '}
        <strong>Priority is used highest first</strong>, and a negative one was the
        kernel&rsquo;s own choice rather than anyone&rsquo;s — it counts downwards as each area is
        swapped on, so the negatives are really the order they were added. Areas that share a
        priority are used round-robin, which is the only way to stripe swap across two devices,
        and near-identical <em>Used</em> figures are what that looks like from here.
      </p>
    </>
  );
}
