import { useMemo } from 'react';
import {
  describeGroupExtent,
  describeGroupId,
  isDelegatedGroup,
  isPassthroughGroup,
  OVERFLOW_GID,
  parseGidMap,
  SETGROUPS_CVE,
  SETGROUPS_DENY,
  SETGROUPS_SINCE,
  setgroupsEvidence,
  SUBGID_BASE,
  type Extent,
} from '../lib/gid_map';
import {
  EXTENTS_MAX,
  EXTENTS_MAX_LEGACY,
  formatCount,
  formatRange,
  OUTSIDE_DEPENDS_ON_READER,
  summarize,
} from '../lib/uid_map';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * A range, in the table `uid_map` uses — the columns are the same three, so the
 * layout is the same layout, and only the words in the last column are groups'.
 */
function ExtentRow({ extent }: { extent: Extent }) {
  const inside = describeGroupId(extent.inside);
  const outside = describeGroupId(extent.outside);

  return (
    <tr className={isPassthroughGroup(extent) ? 'uidmap__row uidmap__row--passthrough' : 'uidmap__row'}>
      <td className="uidmap__index">{extent.line}</td>
      <td className="uidmap__id" title={inside ?? undefined}>
        {formatRange(extent.inside, extent.length)}
      </td>
      <td className="uidmap__id" title={outside ?? undefined}>
        {formatRange(extent.outside, extent.length)}
      </td>
      <td className="uidmap__number">{formatCount(extent.length)}</td>
      <td className="uidmap__note">
        {describeGroupExtent(extent)}
        {isPassthroughGroup(extent) && (
          <span className="chip chip--model" title="The same group on both sides of the boundary">
            unchanged
          </span>
        )}
        {isDelegatedGroup(extent) && (
          <span
            className="chip chip--type"
            title={`Outside ids at or above ${SUBGID_BASE}, which is where /etc/subgid allocations conventionally begin — a guess from the numbers, not something the kernel records`}
          >
            delegated range
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * The group half of a user namespace's mapping. The file is `uid_map`'s file;
 * what this page is for is the rule around writing it, which is not on that one
 * — an unprivileged process has to give up `setgroups()` forever before the
 * kernel will take this.
 */
export function GidMapView({ content }: { content: string }) {
  const map = useMemo(() => parseGidMap(content), [content]);
  const summary = useMemo(() => summarize(map), [map]);
  const setgroups = useMemo(() => setgroupsEvidence(map), [map]);

  const note = (
    <p className="disks__note muted">
      Each line is <strong>first group inside the namespace, first group outside it, how many</strong>{' '}
      — the same three <code>%10u</code> columns as{' '}
      <code>/proc/&lt;pid&gt;/uid_map</code>, and the same rules: the middle column is written from
      the point of view of whichever process <em>opened</em> the file rather than absolutely, the
      map is written <strong>exactly once</strong> in a single <code>write()</code>, overlapping
      ranges are refused at write time, and an empty file is a namespace whose map has not been
      written rather than a missing namespace. What is different is the{' '}
      <strong>rule guarding the write</strong>. Since Linux {SETGROUPS_SINCE} an unprivileged
      process must write <code>{SETGROUPS_DENY}</code> to{' '}
      <code>/proc/&lt;pid&gt;/setgroups</code> before the kernel will accept this file at all, and
      that write turns <code>setgroups()</code> off for the namespace and everything nested inside
      it, permanently. It closed {SETGROUPS_CVE}: before it, a user could make a namespace and{' '}
      <em>drop</em> a supplementary group, which defeats a <strong>negative</strong> group
      permission — a file whose group bits grant less than its other bits, where being in the group
      is exactly what denies you. A writer holding <code>CAP_SETGID</code> in the parent namespace
      is exempt and <code>setgroups</code> stays <code>allow</code>, which is how{' '}
      <code>newgidmap</code> — setuid root, reading <code>/etc/subgid</code> — writes a rootless
      container&rsquo;s several ranges without freezing its groups, where <code>unshare -U</code>{' '}
      alone cannot. The order is fixed and one-way: <code>setgroups</code> has to go first, because
      writing this file is what makes <code>setgroups</code> unwritable. Two things this file is
      not. <strong>The groups a process is actually in are not here</strong> — the{' '}
      <code>Groups:</code> line of <code>/proc/&lt;pid&gt;/status</code> has those; this is only
      what their ids mean on each side. And an unmapped group reads as the overflow gid{' '}
      {OVERFLOW_GID}, <code>nogroup</code>, which is its own sysctl —{' '}
      <code>/proc/sys/kernel/overflowgid</code> — rather than the uid one, though both land on the
      same number.
    </p>
  );

  if (summary.unmapped && summary.malformed.length === 0) {
    return (
      <>
        <p className="notice notice--warn" data-testid="unmapped">
          <strong>No mapping has been written for this namespace.</strong> A user namespace starts
          out with an empty map and it may be written only once, so this is either a namespace
          still being set up or one that will never have groups of its own. Until it is written,{' '}
          <strong>every group in here reads as the overflow gid {OVERFLOW_GID}</strong> —{' '}
          <code>nogroup</code> across the board, this process&rsquo;s own supplementary groups
          included. This is also the one moment when <code>setgroups</code> can still be written
          either way: after this file is written, it cannot.
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
          Two ranges here cover the same group, which the kernel refuses at write time — so this map
          did not come from a running namespace. There is no honest answer to what such a group maps
          to, and this page does not invent one.
        </p>
      )}

      <p className="notice" role="status" data-testid="setgroups">
        <strong>
          {setgroups.value === null
            ? 'What /proc/<pid>/setgroups holds cannot be told from here yet.'
            : setgroups.certain
              ? `/proc/<pid>/setgroups holds ${setgroups.value}.`
              : `/proc/<pid>/setgroups very likely holds ${setgroups.value}.`}
        </strong>{' '}
        This page reads the one path its URL names, and that is another — but the shape of this map
        is evidence about it, because {setgroups.reason}.{' '}
        {setgroups.value === SETGROUPS_DENY ? (
          <>
            If so, <code>setgroups()</code> and <code>initgroups()</code> answer{' '}
            <code>EPERM</code> in this namespace and in everything nested inside it, for as long as
            it exists: the supplementary groups a process in here has are the ones it came with, and
            it can neither drop one nor pick one up.
          </>
        ) : (
          <>
            If so, <code>setgroups()</code> still works in here, and a process with{' '}
            <code>CAP_SETGID</code> in this namespace can change its supplementary groups the
            ordinary way.
          </>
        )}
      </p>

      {summary.identity && (
        <p className="notice" role="status" data-testid="identity">
          Every group stands for itself. This is <strong>the initial user namespace</strong>&rsquo;s
          map, which every ordinary process on a machine has — a process here is not in a user
          namespace of its own, and the <code>root</code> group is the <code>root</code> group. The
          range stops one short of <code>4294967295</code> because that value is{' '}
          <code>(gid_t)-1</code>, the kernel&rsquo;s &ldquo;no id&rdquo; marker rather than a group.
        </p>
      )}

      {summary.rootRemapped && (
        <p className="notice" role="status" data-testid="remapped">
          <strong>Group 0 in this namespace is group {formatCount(summary.root!)} outside it.</strong>{' '}
          A file created by the <code>root</code> group in here belongs to group{' '}
          {formatCount(summary.root!)} on the other side, and a file owned by group 0 out there
          reads as <code>nogroup</code> in here unless some range maps it back.
        </p>
      )}

      {summary.root === null && !summary.identity && (
        <p className="notice notice--warn" role="status" data-testid="no-root">
          <strong>Group 0 is not mapped at all.</strong> Nothing in this namespace belongs to the{' '}
          <code>root</code> group, and anything owned by group 0 outside reads as the overflow gid{' '}
          {OVERFLOW_GID} in here.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="ranges" value={`${summary.extents} of ${EXTENTS_MAX}`} />
        <Stat label="groups mapped" value={formatCount(summary.mapped)} />
        <Stat
          label="group 0 is"
          value={summary.root === null ? 'unmapped' : formatCount(summary.root)}
        />
      </section>

      <p className="models" data-testid="flags">
        {setgroups.value === SETGROUPS_DENY && (
          <span
            className="chip chip--flag"
            title="An unprivileged writer reaches this file only by turning setgroups() off first, and it cannot be turned back on"
          >
            groups frozen
          </span>
        )}
        {summary.identity && (
          <span
            className="chip chip--model"
            title="Every group standing for itself, which is what the initial user namespace has"
          >
            identity map
          </span>
        )}
        {summary.rootRemapped && (
          <span
            className="chip chip--flag"
            title="The root group inside this namespace is an ordinary group outside it"
          >
            group 0 is <span className="count">{formatCount(summary.root!)}</span> outside
          </span>
        )}
        {summary.selfMap && (
          <span
            className="chip chip--model"
            title="One range of one id — all the kernel accepts from a writer without CAP_SETGID in the parent namespace"
          >
            one group, written unprivileged
          </span>
        )}
        {summary.delegated.length > 0 && (
          <span
            className="chip chip--type"
            title="Outside ids at or above 100000, where /etc/subgid allocations conventionally start"
          >
            <span className="count">{summary.delegated.length}</span> delegated{' '}
            {summary.delegated.length === 1 ? 'range' : 'ranges'}
          </span>
        )}
        {summary.passthrough.length > 0 && !summary.identity && !summary.selfMap && (
          <span
            className="chip chip--model"
            title="Groups that are the same on both sides — usually a device group shared in, so the nodes it owns stay usable"
          >
            <span className="count">{summary.passthrough.length}</span> unchanged{' '}
            {summary.passthrough.length === 1 ? 'group' : 'groups'}
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
        <table className="mounts__table uidmap__table" aria-label="Group id mappings">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Inside</th>
              <th scope="col" title={`Read ${OUTSIDE_DEPENDS_ON_READER}`}>
                Outside
              </th>
              <th scope="col">Groups</th>
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

      {summary.passthrough.length > 0 && !summary.identity && (
        <p className="disks__note muted" data-testid="passthrough">
          <strong>
            {summary.passthrough.length === 1
              ? 'One group is held the same on both sides.'
              : `${summary.passthrough.length} groups are held the same on both sides.`}
          </strong>{' '}
          That is the ordinary reason to punch a hole in a <code>gid_map</code>: a device group —{' '}
          <code>audio</code>, <code>video</code>, <code>disk</code> — kept at its host number so the
          nodes it owns are still owned by a group the namespace can name, and a process inside that
          holds it can still open them. Map it to something else and the device node reads as{' '}
          <code>nogroup</code> from inside, whatever its permissions say.
        </p>
      )}

      {!summary.identity && (
        <p className="disks__note muted" data-testid="unmapped-ids">
          <strong>Every group this map does not cover is unmapped</strong>, and an unmapped group
          reads as the overflow gid {OVERFLOW_GID} — <code>nogroup</code> — from whichever side
          cannot see it. So a file owned by a group missing from the middle column shows up in here
          as owned by nobody&rsquo;s group, nothing in this namespace can{' '}
          <code>chgrp</code> it back, and of the four billion ids there are,{' '}
          {formatCount(summary.mapped)} exist as far as this namespace is concerned.
        </p>
      )}

      {note}
    </>
  );
}
