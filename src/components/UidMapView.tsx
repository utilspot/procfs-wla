import { useMemo } from 'react';
import {
  describeExtent,
  describeId,
  EXTENTS_MAX,
  EXTENTS_MAX_LEGACY,
  formatCount,
  formatRange,
  isDelegated,
  isPassthrough,
  OUTSIDE_DEPENDS_ON_READER,
  OVERFLOW_UID,
  parseUidMap,
  summarize,
  type Extent,
} from '../lib/uid_map';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function ExtentRow({ extent }: { extent: Extent }) {
  const inside = describeId(extent.inside);
  const outside = describeId(extent.outside);

  return (
    <tr className={isPassthrough(extent) ? 'uidmap__row uidmap__row--passthrough' : 'uidmap__row'}>
      <td className="uidmap__index">{extent.line}</td>
      <td className="uidmap__id" title={inside ?? undefined}>
        {formatRange(extent.inside, extent.length)}
      </td>
      <td className="uidmap__id" title={outside ?? undefined}>
        {formatRange(extent.outside, extent.length)}
      </td>
      <td className="uidmap__number">{formatCount(extent.length)}</td>
      <td className="uidmap__note">
        {describeExtent(extent)}
        {isPassthrough(extent) && (
          <span className="chip chip--model" title="The same id on both sides of the boundary">
            unchanged
          </span>
        )}
        {isDelegated(extent) && (
          <span
            className="chip chip--type"
            title="Outside ids at or above 100000, which is where /etc/subuid allocations conventionally begin — a guess from the numbers, not something the kernel records"
          >
            delegated range
          </span>
        )}
      </td>
    </tr>
  );
}

export function UidMapView({ content }: { content: string }) {
  const map = useMemo(() => parseUidMap(content), [content]);
  const summary = useMemo(() => summarize(map), [map]);

  const note = (
    <p className="disks__note muted">
      Each line is <strong>first id inside the namespace, first id outside it, how many</strong> —
      so <code>0 1000 1</code> says uid 0 in here is uid 1000 out there. Three things about that
      read wrong at first glance. <strong>The middle column is not an absolute number</strong>: it
      is written from the point of view of whichever process opened the file — the parent namespace
      where the reader shares this one&rsquo;s namespace, and the reader&rsquo;s own where it does
      not — so two processes reading the same file can honestly see different numbers, and a
      captured one only means something alongside who read it. <strong>An empty file is not a
      missing namespace</strong> but a namespace whose map has not been written: until it is, every
      id in there reads as the overflow uid {OVERFLOW_UID}, which is where an unexplained{' '}
      <code>nobody</code> comes from. And <strong>the map is written exactly once</strong>, in a
      single <code>write()</code>, after which the namespace&rsquo;s ids are settled for as long as
      it exists — which is why a runtime gets this right at start-up or not at all. Writing it needs{' '}
      <code>CAP_SETUID</code> in the parent namespace; without that the kernel accepts one line
      mapping the caller&rsquo;s own id and nothing more, and{' '}
      <code>newuidmap</code> is the setuid helper that turns an <code>/etc/subuid</code> allocation
      into the larger map a rootless container needs. Being uid 0 in here buys full capability{' '}
      <em>over this namespace&rsquo;s own resources</em> and not one thing more: for everything
      else the kernel checks the id on the outside.{' '}
      <code>/proc/&lt;pid&gt;/gid_map</code> is the same file for groups, with one extra rule —
      since Linux 3.19 an unprivileged process must write <code>deny</code> to{' '}
      <code>/proc/&lt;pid&gt;/setgroups</code> before it may write that one at all.
    </p>
  );

  if (summary.unmapped && summary.malformed.length === 0) {
    return (
      <>
        <p className="notice notice--warn" data-testid="unmapped">
          <strong>No mapping has been written for this namespace.</strong> A user namespace starts
          out with an empty map, and the map may be written only once — so this is either a
          namespace still being set up or one that will never have ids of its own. Until it is
          written, <strong>every id in here reads as the overflow uid {OVERFLOW_UID}</strong>:
          every file owner, every process, <code>nobody</code> across the board. A process in this
          state also cannot change its ids at all, since there is nothing to change them to.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      {summary.malformed.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="malformed">
          {summary.malformed.length === 1 ? 'A line here is' : `${summary.malformed.length} lines here are`}{' '}
          not three numbers, which is the only shape this file has. Switch to the raw view to see
          what the server returned.
        </p>
      )}

      {summary.overlaps.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="overlaps">
          Two ranges here cover the same id, which the kernel refuses at write time — so this map
          did not come from a running namespace. There is no honest answer to what such an id maps
          to, and this page does not invent one.
        </p>
      )}

      {summary.identity && (
        <p className="notice" role="status" data-testid="identity">
          Every id stands for itself. This is <strong>the initial user namespace</strong>&rsquo;s
          map, which every ordinary process on a machine has — a process here is not in a user
          namespace of its own, and root is root. The range stops one short of{' '}
          <code>4294967295</code> because that value is <code>(uid_t)-1</code>, the kernel&rsquo;s
          &ldquo;no id&rdquo; marker rather than a user.
        </p>
      )}

      {summary.rootRemapped && (
        <p className="notice" role="status" data-testid="remapped">
          <strong>Uid 0 in this namespace is uid {formatCount(summary.root!)} outside it.</strong>{' '}
          Root in here is an unprivileged id out there: the kernel grants a process full capability
          over what this namespace owns, and checks the outside id for everything else. So a
          process that is root here writes files owned by {formatCount(summary.root!)} on the other
          side, and cannot touch anything that id could not.
        </p>
      )}

      {summary.root === null && !summary.identity && (
        <p className="notice notice--warn" role="status" data-testid="no-root">
          <strong>Uid 0 is not mapped at all.</strong> Nothing in this namespace can be root in it,
          not even to its own resources, and anything owned by uid 0 outside reads as the overflow
          uid {OVERFLOW_UID} in here.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="ranges" value={`${summary.extents} of ${EXTENTS_MAX}`} />
        <Stat label="ids mapped" value={formatCount(summary.mapped)} />
        <Stat
          label="uid 0 is"
          value={summary.root === null ? 'unmapped' : formatCount(summary.root)}
        />
      </section>

      <p className="models" data-testid="flags">
        {summary.identity && (
          <span
            className="chip chip--model"
            title="Every id standing for itself, which is what the initial user namespace has"
          >
            identity map
          </span>
        )}
        {summary.rootRemapped && (
          <span
            className="chip chip--flag"
            title="Root inside this namespace is an ordinary user outside it"
          >
            root is uid <span className="count">{formatCount(summary.root!)}</span> outside
          </span>
        )}
        {summary.selfMap && (
          <span
            className="chip chip--model"
            title="One range of one id — all the kernel accepts from a writer without CAP_SETUID in the parent namespace"
          >
            one id, written unprivileged
          </span>
        )}
        {summary.delegated.length > 0 && (
          <span
            className="chip chip--type"
            title="Outside ids at or above 100000, where /etc/subuid allocations conventionally start"
          >
            <span className="count">{summary.delegated.length}</span> delegated{' '}
            {summary.delegated.length === 1 ? 'range' : 'ranges'}
          </span>
        )}
        {summary.passthrough.length > 0 && !summary.identity && !summary.selfMap && (
          <span
            className="chip chip--model"
            title="Ids that are the same on both sides — usually a host user shared into the namespace, so its files keep one owner"
          >
            <span className="count">{summary.passthrough.length}</span> unchanged{' '}
            {summary.passthrough.length === 1 ? 'id' : 'ids'}
          </span>
        )}
        {summary.pastLegacyCap && (
          <span
            className="chip chip--flag"
            title={`A kernel before 4.15 took ${EXTENTS_MAX_LEGACY} ranges; this map needs one from 4.15 on, where the cap is ${EXTENTS_MAX}`}
          >
            more than {EXTENTS_MAX_LEGACY} ranges
          </span>
        )}
      </p>

      <div className="card mounts uidmap">
        <table className="mounts__table uidmap__table" aria-label="User id mappings">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Inside</th>
              <th scope="col" title={`Read ${OUTSIDE_DEPENDS_ON_READER}`}>
                Outside
              </th>
              <th scope="col">Ids</th>
              <th scope="col">What it means</th>
            </tr>
          </thead>
          <tbody>
            {map.extents.map((extent) => (
              <ExtentRow key={extent.line} extent={extent} />
            ))}
          </tbody>
        </table>
      </div>

      {!summary.identity && (
        <p className="disks__note muted" data-testid="unmapped-ids">
          <strong>Every id this map does not cover is unmapped</strong>, and an unmapped id reads as the overflow uid {OVERFLOW_UID} — <code>nobody</code> —
          from whichever side cannot see it. So a file owned by an id missing from the middle
          column shows up in here as owned by nobody, and nothing in this namespace can chown it
          back — of the four billion ids there are, {formatCount(summary.mapped)} exist as far as
          this namespace is concerned.
        </p>
      )}

      {note}
    </>
  );
}
