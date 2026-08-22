import { useMemo } from 'react';
import {
  formatPort,
  isLegacy,
  parseIoports,
  PORT_SPACE,
  sizeOf,
  summarize,
  type IoportRange,
} from '../lib/ioports';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** Ports are counted rather than sized: a range here is a handful of them. */
function ports(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'port' : 'ports'}`;
}

function RangeRow({ range, hidden }: { range: IoportRange; hidden: boolean }) {
  return (
    <tr className={!hidden && isLegacy(range) ? 'ioports__row ioports__row--legacy' : 'ioports__row'}>
      {/* Indented the way the file indents it: a nested range is carved out of
          the one above, and the depth is the only thing that says so. */}
      <td className="ioports__range" style={{ paddingLeft: `${0.5 + range.depth}rem` }}>
        {formatPort(range.start)}–{formatPort(range.end)}
      </td>
      <td className="ioports__ports">
        {hidden ? (
          <span className="muted" title="No addresses to count ports between">
            —
          </span>
        ) : (
          ports(sizeOf(range))
        )}
      </td>
      <td className="ioports__name">{range.name}</td>
    </tr>
  );
}

export function IoportsView({ content }: { content: string }) {
  const info = useMemo(() => parseIoports(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  /**
   * An empty file is what an architecture with no I/O port space has — the
   * ports are an x86 arrangement, not something every machine has — and the
   * file cannot say whether that is the reason or whether nothing has claimed
   * anything, so neither is asserted.
   */
  if (info.ranges.length === 0) {
    return (
      <p className="notice" role="status">
        Nothing has claimed an I/O port on this machine. I/O ports are a separate address space
        reached with <code>in</code> and <code>out</code> instructions, which is an x86
        arrangement — on an architecture without one this file is empty for good, and a device is
        reached through memory-mapped registers instead. Those appear in <code>/proc/iomem</code>.
      </p>
    );
  }

  return (
    <>
      {summary.hidden && (
        <p className="notice notice--warn" role="status">
          Every port here is zero, which is what the kernel shows a reader without{' '}
          <code>CAP_SYS_ADMIN</code>: the ranges keep their shape and their names, and the
          addresses are replaced rather than the file refused. Read it as root to see them — and
          read nothing into the counts, which is why they are left out below.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="ranges" value={String(summary.ranges)} />
        {summary.claimed !== null && (
          <Stat
            label="ports claimed"
            value={`${summary.claimed.toLocaleString()} of ${PORT_SPACE.toLocaleString()}`}
          />
        )}
        {summary.free !== null && <Stat label="free" value={summary.free.toLocaleString()} />}
        {!summary.hidden && <Stat label="below 0x400" value={String(summary.legacy.length)} />}
      </section>

      <div className="card mounts">
        <table className="mounts__table ioports__table" aria-label="Claimed I/O port ranges">
          <thead>
            <tr>
              <th scope="col">Range</th>
              <th scope="col">Ports</th>
              <th scope="col">Claimed by</th>
            </tr>
          </thead>
          <tbody>
            {info.ranges.map((range) => (
              <RangeRow
                key={`${range.start}-${range.end}-${range.name}`}
                range={range}
                hidden={summary.hidden}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        I/O ports are a separate address space from memory, reached with <code>in</code> and{' '}
        <code>out</code> rather than by a load or a store, and it is{' '}
        <strong>{PORT_SPACE.toLocaleString()} ports wide and no wider</strong> — which is why what
        is claimed is worth counting here and not in <code>/proc/iomem</code>. That count adds up
        the top-level ranges only: the indentation is structure, and a nested range is carved{' '}
        <strong>out of</strong> the one above it rather than sitting beside it. Both bounds are
        inclusive, so <code>0060-0060</code> is one port. The highlighted rows are the block below{' '}
        <code>0x0400</code> that the original PC laid out — the interrupt controllers, the timer,
        the keyboard, the serial and parallel ports — still where those devices are found.
      </p>
    </>
  );
}
