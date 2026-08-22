import { useMemo, useState } from 'react';
import {
  cachedPages,
  describePageKey,
  describeTailKey,
  formatPages,
  holePages,
  isEmpty,
  pageValue,
  parseZoneInfo,
  reservedPages,
  summarize,
  WATERMARK_STATES,
  watermarkState,
  type NodeStats,
  type Zone,
} from '../lib/zoneinfo';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** Short labels for the state chip, keyed the same as the descriptions. */
const STATE_LABELS = {
  empty: 'empty',
  'above-high': 'above high',
  'below-high': 'kswapd finishing',
  'below-low': 'kswapd woken',
  'below-min': 'below min',
} as const;

/** Where free sits against min, low and high, drawn to scale against high. */
function Watermarks({ zone }: { zone: Zone }) {
  const free = pageValue(zone, 'free') ?? 0;
  const min = pageValue(zone, 'min') ?? 0;
  const low = pageValue(zone, 'low') ?? 0;
  const high = pageValue(zone, 'high') ?? 0;

  // Beyond the high watermark the exact figure stops mattering, so the bar is
  // scaled to high and simply fills once free is past it.
  const scale = Math.max(high, 1);
  const mark = (value: number) => `${Math.min(100, (value / scale) * 100)}%`;

  return (
    <div className="zi__marks">
      <span
        className="zi__bar"
        role="img"
        aria-label={`${free} free, min ${min}, low ${low}, high ${high}`}
      >
        <span className="zi__fill" style={{ width: mark(free) }} />
        <span className="zi__mark zi__mark--min" style={{ left: mark(min) }} title="min" />
        <span className="zi__mark zi__mark--low" style={{ left: mark(low) }} title="low" />
        <span className="zi__mark zi__mark--high" style={{ left: mark(high) }} title="high" />
      </span>
      <span className="zi__legend muted">
        free {formatPages(free)} · min {formatPages(min)} · low {formatPages(low)} · high{' '}
        {formatPages(high)}
      </span>
    </div>
  );
}

function ZoneCard({ zone }: { zone: Zone }) {
  const state = watermarkState(zone);
  const holes = holePages(zone);
  const reserved = reservedPages(zone);
  const cached = cachedPages(zone);
  const empty = isEmpty(zone);

  return (
    <section className="card zi" aria-label={`Node ${zone.node}, zone ${zone.name}`}>
      <h3 className="zi__name">
        Node {zone.node}, zone {zone.name}
        <span
          className={state === 'below-min' ? 'chip chip--ro' : 'chip chip--type'}
          title={WATERMARK_STATES[state]}
        >
          {STATE_LABELS[state]}
        </span>
      </h3>

      {!empty && <Watermarks zone={zone} />}

      <table
        className="mounts__table zi__table"
        aria-label={`Node ${zone.node} zone ${zone.name} pages`}
      >
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Pages</th>
            <th scope="col">Memory</th>
            <th scope="col">What it is</th>
          </tr>
        </thead>
        <tbody>
          {zone.pages.map((entry) => (
            <tr key={entry.name} className="zi__row">
              <td className="zi__key">{entry.name}</td>
              <td className="zi__number">{entry.value.toLocaleString()}</td>
              <td className="zi__number">{formatPages(entry.value)}</td>
              <td className="zi__note">
                {describePageKey(entry.name) ?? (
                  <span className="muted">A key this page has no note for</span>
                )}
              </td>
            </tr>
          ))}
          {holes !== null && holes > 0 && (
            <tr className="zi__row zi__row--derived">
              <td className="zi__key">holes</td>
              <td className="zi__number">{holes.toLocaleString()}</td>
              <td className="zi__number">{formatPages(holes)}</td>
              <td className="zi__note">
                Spanned less present: page frames the zone covers with nothing behind them
              </td>
            </tr>
          )}
          {reserved !== null && reserved > 0 && (
            <tr className="zi__row zi__row--derived">
              <td className="zi__key">reserved</td>
              <td className="zi__number">{reserved.toLocaleString()}</td>
              <td className="zi__number">{formatPages(reserved)}</td>
              <td className="zi__note">
                Present less managed: memory that is there and the allocator never got — firmware
                reservations and the memory map itself
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {zone.protection.length > 0 && (
        <p className="zi__protection">
          <span
            className="muted"
            title="Pages of this zone withheld from an allocation that could have used another"
          >
            protection:
          </span>
          {zone.protection.map((value, index) => (
            <span
              key={index}
              className="chip"
              title={`Withheld from an allocation that could have used zone ${index}`}
            >
              {value.toLocaleString()}
            </span>
          ))}
        </p>
      )}

      {zone.pagesets.length > 0 && (
        <p className="zi__pagesets muted">
          {zone.pagesets.length} per-CPU {zone.pagesets.length === 1 ? 'list' : 'lists'} holding{' '}
          {cached.toLocaleString()} pages ({formatPages(cached)}) off the buddy allocator.
        </p>
      )}

      {zone.tail.length > 0 && (
        <p className="zi__tail">
          {zone.tail.map((entry) => (
            <span
              key={entry.name}
              className={
                entry.value === 1 && entry.name.endsWith('unreclaimable')
                  ? 'chip chip--ro'
                  : 'chip chip--model'
              }
              title={describeTailKey(entry.name) ?? undefined}
            >
              {entry.name} <span className="count">{entry.value.toLocaleString()}</span>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function NodeCard({ node }: { node: NodeStats }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="card zi" aria-label={`Node ${node.node} statistics`}>
      <h3 className="zi__name">Node {node.node} statistics</h3>
      <p className="zi__printedUnder muted">
        Printed under <code>zone {node.printedUnder}</code>, and belonging to the node rather than
        to that zone — since 4.8 the reclaim lists live on the node, so these {node.stats.length}{' '}
        figures cover every zone on it.
      </p>

      <button type="button" className="link-button" onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Show'} the node’s {node.stats.length} counters
      </button>

      {open && (
        <table className="mounts__table zi__table" aria-label={`Node ${node.node} counters`}>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {node.stats.map((entry) => (
              <tr key={entry.name} className="zi__row">
                <td className="zi__key">{entry.name}</td>
                <td className="zi__number">{entry.value.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ZoneInfoView({ content }: { content: string }) {
  const info = useMemo(() => parseZoneInfo(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);
  const [hideEmpty, setHideEmpty] = useState(false);

  if (info.zones.length === 0) {
    return (
      <p className="notice notice--warn">
        No zones found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  const visible = hideEmpty ? info.zones.filter((zone) => !isEmpty(zone)) : info.zones;

  return (
    <>
      {summary.stalling.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="stalling">
          {summary.stalling.map((zone) => `node ${zone.node} ${zone.name}`).join(', ')}{' '}
          {summary.stalling.length === 1 ? 'is' : 'are'} below the min watermark. An ordinary
          allocation from there cannot simply take a page: it has to stop and reclaim one first,
          which is felt as a stall rather than seen as load.
          {summary.unreclaimable.length > 0 &&
            ` Node ${summary.unreclaimable.join(', ')} has been marked unreclaimable, ` +
              'meaning a scan found nothing left to take.'}
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="managed" value={formatPages(summary.managedPages)} />
        <Stat label="free" value={formatPages(summary.freePages)} />
        <Stat
          label="zones"
          value={`${summary.zones} on ${summary.nodes.length} node${
            summary.nodes.length === 1 ? '' : 's'
          }`}
        />
        <Stat label="reserved" value={formatPages(summary.reservedPages)} />
      </section>

      <p className="models" data-testid="flags">
        {summary.reclaiming.length > 0 && (
          <span
            className="chip chip--flag"
            title="Free has fallen far enough that kswapd is at work on these"
          >
            reclaiming{' '}
            <span className="count">
              {summary.reclaiming.map((zone) => zone.name).join(', ')}
            </span>
          </span>
        )}
        {summary.holePages > 0 && (
          <span
            className="chip chip--model"
            title="Page frames the zones cover with nothing behind them"
          >
            holes <span className="count">{formatPages(summary.holePages)}</span>
          </span>
        )}
        {summary.cachedPages > 0 && (
          <span
            className="chip chip--model"
            title="Pages held on per-CPU lists rather than on the buddy allocator’s"
          >
            per-CPU cached <span className="count">{formatPages(summary.cachedPages)}</span>
          </span>
        )}
        {summary.empty > 0 && (
          <span className="chip chip--model" title="Zones that exist but have no memory in them">
            empty zones <span className="count">{summary.empty}</span>
          </span>
        )}
        {summary.perZoneLru && (
          <span
            className="chip chip--flag"
            title="No per-node block at all — a kernel from before the reclaim lists moved off the zones"
          >
            per-zone LRU
          </span>
        )}
      </p>

      {info.nodes.map((node) => (
        <NodeCard key={node.node} node={node} />
      ))}

      {summary.empty > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(event) => setHideEmpty(event.target.checked)}
          />
          Hide zones with no memory in them ({summary.empty} of {summary.zones})
        </label>
      )}

      <div className="md__arrays">
        {visible.map((zone) => (
          <ZoneCard key={`${zone.node}/${zone.name}`} zone={zone} />
        ))}
      </div>

      <p className="disks__note muted">
        The <strong>per-node block belongs to the node, not to the zone it is printed under</strong>
        . Since 4.8 the reclaim lists live on the node, so those figures are printed once — beneath
        whichever zone comes first, which on most machines is the tiny <code>DMA</code> one — and
        reading <code>nr_active_anon</code> there as that zone&rsquo;s is out by orders of
        magnitude. <strong>Spanned, present and managed are three different numbers</strong>:
        spanned is the whole range of page frames including holes, present is what is physically
        there, and managed is what the allocator was left with once firmware reservations and the
        memory map itself came out — which is where the RAM a machine seems to be missing actually
        went. <strong>Free against min, low and high is the state of the zone</strong>: kswapd is
        woken when free falls below <code>low</code> and reclaims until <code>high</code>, and
        below <code>min</code> an ordinary allocation has to stop and reclaim before it can
        proceed. And <code>protection:</code> is the lowmem_reserve array rather than a total —
        entry <em>i</em> is how many pages this zone will refuse to an allocation that could have
        come from zone <em>i</em> instead, which is why a zone with free pages can still turn one
        down.
      </p>
    </>
  );
}
