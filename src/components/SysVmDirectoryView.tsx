import { useMemo } from 'react';
import { DirectoryView, linkFor } from './DirectoryView';
import { readDirectory, type Entry, type Listing } from '../lib/directory';
import {
  tunableFor,
  tunablesIn,
  UNIT_LABELS,
  VM_GROUPS,
  WRITE_CAPABILITY,
  type VmGroup,
  type VmTunable,
} from '../lib/sys-vm';

/** One row: the file that is there, and what this app knows it to be. */
interface Row {
  tunable: VmTunable;
  entry: Entry;
}

/**
 * The listing of `/proc/sys/vm`, which is the memory manager's control panel:
 * three or four dozen files, every one of them a setting rather than a report.
 *
 * It is the same arrangement {@link SysUserDirectoryView} gives `/proc/sys/user`
 * and a different reason for it. Those twelve are one mechanism and differ in a
 * word; **these are a dozen unrelated mechanisms sharing a directory**, and
 * sorted alphabetically they interleave — `dirty_ratio` lands between
 * `compact_memory` and `drop_caches`, which have nothing to do with it or with
 * each other. So the knobs this app has facts for are shown **grouped by what
 * they are part of**: writeback, overcommit, reclaim, huge pages, the OOM
 * killer, the address space and the faults taken in it, and the counters. A
 * grid of fifty one-word names is a directory; this is a map of it.
 *
 * **The values are not here.** Each name links to its own file the way every
 * entry in a listing does, and that page shows what the file holds. Reading
 * fifty files to put fifty numbers on a page about what the files *are* would
 * be fifty requests for the wrong question.
 *
 * **What this app has no facts for is listed the usual way.** The set under
 * `/proc/sys/vm` differs by kernel version and by architecture, so a page that
 * showed only the names it knew would be describing some other machine — see
 * {@link DirectoryView}, which gets everything the groups did not account for.
 */
export function SysVmDirectoryView({ listing, path }: { listing: Listing; path: string }) {
  const entries = useMemo(() => readDirectory(listing, path).entries, [listing, path]);

  /**
   * What is in this directory that this app has facts for, group by group and
   * within a group in the table's own order — what is *shown* is what the
   * backend listed, since a row is a link to a file and a kernel without that
   * knob has no file to link at.
   */
  const groups = useMemo(() => {
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    return VM_GROUPS.map((group) => ({
      group,
      rows: tunablesIn(group).flatMap((tunable): Row[] => {
        const entry = byName.get(tunable.name);
        return entry === undefined || entry.kind !== 'file' ? [] : [{ tunable, entry }];
      }),
    })).filter(({ rows }) => rows.length > 0);
  }, [entries]);

  return (
    <>
      {groups.length > 0 && (
        <p className="disks__note muted" data-testid="about">
          Everything here is a <strong>setting rather than a report</strong>: it is writable — by a
          reader with <code>{WRITE_CAPABILITY}</code>, and read-only to everyone else — and what it
          holds is what the memory manager has been told to do rather than anything it has done.
          What each one has been set to is on the file&rsquo;s own page; these are what the names
          mean.
        </p>
      )}

      {groups.map(({ group, rows }) => (
        <TunableSection key={group} group={group} rows={rows} />
      ))}

      {/* Everything the groups did not account for, shown the way every other
          directory's entries are. */}
      <DirectoryView listing={listing} path={path} omit={isTunable} />
    </>
  );
}

/** Whether this entry is a tunable named above, and so already shown. */
function isTunable(entry: Entry): boolean {
  return entry.kind === 'file' && tunableFor(entry.name) !== undefined;
}

/**
 * One area of the memory manager: a row per file, what it sets, and what it is
 * set in — the units being the thing most easily got wrong here, since two
 * files a line apart may be a percentage and a count of bytes.
 *
 * The order within a group is the table's own rather than the listing's: a
 * threshold spelled as a ratio comes before the same threshold spelled in
 * bytes, because the pair is one setting and the ratio is the one a machine is
 * usually on.
 */
function TunableSection({ group, rows }: { group: VmGroup; rows: Row[] }) {
  return (
    <section className="explorer" aria-label={group}>
      <h2 className="explorer__title">
        {group}
        <span className="explorer__count muted">{rows.length.toLocaleString('en-US')}</span>
      </h2>

      <div className="card mounts vmtune">
        <table className="mounts__table vmtune__table" aria-label={`${group} tunables`}>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Sets</th>
              <th scope="col">In</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tunable, entry }) => (
              <tr key={tunable.name} className="vmtune__row">
                <td className="vmtune__name">
                  <a className="vmtune__link" href={linkFor(entry)} title={entry.path}>
                    {tunable.name}
                  </a>
                </td>
                <td className="vmtune__sets">{tunable.sets}</td>
                <td className="vmtune__unit">{UNIT_LABELS[tunable.unit]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
