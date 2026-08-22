import { useMemo } from 'react';
import {
  formatAddress,
  formatBytes,
  isRam,
  parseIomem,
  sizeOf,
  summarize,
  type IomemRegion,
} from '../lib/iomem';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function RegionRow({ region, hidden }: { region: IomemRegion; hidden: boolean }) {
  const ram = isRam(region);

  return (
    <tr className={ram ? 'iomem__row iomem__row--ram' : 'iomem__row'}>
      {/* Indented the way the file indents it: a nested range is carved out of
          the one above, and the depth is the only thing that says so. */}
      {/* Whole rem per level off a half-rem base, so the sum is exact and the
          rendered value carries no floating-point tail. */}
      <td className="iomem__range" style={{ paddingLeft: `${0.5 + region.depth}rem` }}>
        {formatAddress(region.start)}–{formatAddress(region.end)}
      </td>
      <td className="iomem__size">
        {hidden ? (
          <span className="muted" title="No address to work a size out from">
            —
          </span>
        ) : (
          formatBytes(sizeOf(region))
        )}
      </td>
      <td className="iomem__name">{region.name}</td>
    </tr>
  );
}

export function IomemView({ content }: { content: string }) {
  const info = useMemo(() => parseIomem(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  if (info.regions.length === 0) {
    return (
      <p className="notice notice--warn">
        No regions found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {/*
       * Zeroed addresses are the kernel refusing to show them, not a map that
       * covers nothing — so the sizes are left out rather than computed from
       * zeroes.
       */}
      {summary.hidden && (
        <p className="notice notice--warn" role="status">
          Every address here is zero, which is what the kernel shows a reader without{' '}
          <code>CAP_SYS_ADMIN</code>: the map keeps its shape and its names, and the addresses are
          replaced rather than the file refused. Read it as root to see them — and read nothing
          into the sizes, which is why they are left out below.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="regions" value={String(summary.regions)} />
        {!summary.hidden && <Stat label="System RAM" value={formatBytes(summary.ramBytes)} />}
        {!summary.hidden && summary.topAddress !== null && (
          <Stat label="top of map" value={formatAddress(summary.topAddress)} />
        )}
        <Stat label="top level" value={String(summary.topLevel)} />
      </section>

      {!summary.hidden && summary.ram.length > 0 && (
        <p className="models" data-testid="ram-ranges">
          {summary.ram.map((region) => (
            <span key={region.start} className="chip chip--model">
              {formatAddress(region.start)} <span className="count">{formatBytes(sizeOf(region))}</span>
            </span>
          ))}
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table iomem__table" aria-label="Physical address map">
          <thead>
            <tr>
              <th scope="col">Range</th>
              <th scope="col">Size</th>
              <th scope="col">Region</th>
            </tr>
          </thead>
          <tbody>
            {info.regions.map((region) => (
              <RegionRow
                key={`${region.start}-${region.end}-${region.name}`}
                region={region}
                hidden={summary.hidden}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        Both bounds are <strong>inclusive</strong>, so <code>00000000-00000fff</code> is 4 KiB and
        not 4095 bytes. The indentation is structure: an indented range is carved{' '}
        <strong>out of</strong> the one above it, which is why the kernel image appears inside a{' '}
        <code>System RAM</code> range rather than beside it — and why the memory total above adds
        up the top-level ranges only, since counting the nested ones would count the same bytes
        twice. What is listed is address space rather than memory: most of it is firmware tables,
        a device&rsquo;s registers, or holes, and only <code>System RAM</code> is memory the kernel
        can hand out.
      </p>
    </>
  );
}
