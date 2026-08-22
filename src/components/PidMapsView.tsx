import { useMemo } from 'react';
import {
  byKind,
  decodePath,
  deleted,
  describePerms,
  formatBytes,
  gapBefore,
  hasEscape,
  isDeleted,
  isEmpty,
  isFileBacked,
  isReservation,
  isShared,
  isWritableExecutable,
  KINDS,
  kindOf,
  labelOf,
  overlaps,
  parsePidMaps,
  sizeOf,
  summarize,
  writableExecutable,
  type Mapping,
  type ProcessMaps,
} from '../lib/pid-maps';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function MappingRow({ maps, mapping, index }: { maps: ProcessMaps; mapping: Mapping; index: number }) {
  const kind = kindOf(mapping);
  const gap = gapBefore(maps, index);
  const perms = describePerms(mapping);

  return (
    <tr className={isWritableExecutable(mapping) ? 'maps__row maps__row--wx' : 'maps__row'}>
      <td className="maps__range">
        <span className="maps__start">{mapping.start}</span>
        <span className="maps__end muted">{mapping.end}</span>
      </td>
      <td className="maps__size">
        {formatBytes(sizeOf(mapping))}
        {gap > 0 && (
          <span className="maps__gap muted" title="Unmapped address space before this mapping">
            +{formatBytes(gap)} gap
          </span>
        )}
      </td>
      <td className="maps__perms">
        <code title={perms.join('; ')}>{mapping.perms}</code>
        <span className={isShared(mapping) ? 'chip maps__chip--shared' : 'chip muted'}>
          {isShared(mapping) ? 'shared' : 'private'}
        </span>
      </td>
      <td className="maps__kind">
        <span className="chip chip--model" title={KINDS[kind]}>
          {kind}
        </span>
      </td>
      <td className="maps__path">
        <span className="maps__label">{labelOf(mapping)}</span>
        {isFileBacked(mapping) && (
          <span className="maps__file muted">
            {decodePath(mapping)} · {mapping.dev} · inode {mapping.inode}
          </span>
        )}
        {isDeleted(mapping) && (
          <span className="chip chip--warn" title="The file has been unlinked; the mapping lives on">
            deleted
          </span>
        )}
        {isWritableExecutable(mapping) && (
          <span className="chip chip--warn" title="Writable and executable at the same time">
            w+x
          </span>
        )}
        {isReservation(mapping) && (
          <span className="chip muted" title="Mapped and readable by nobody — address space held for later">
            reservation
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Every region of a process's address space — and the page exists to say that
 * none of it is memory, that the fourth permission character is not one, and
 * that `(deleted)` is the kernel talking.
 */
export function PidMapsView({ content }: { content: string }) {
  const maps = useMemo(() => parsePidMaps(content), [content]);
  const summary = useMemo(() => summarize(maps), [maps]);
  const kinds = useMemo(() => byKind(maps), [maps]);
  const gone = useMemo(() => deleted(maps), [maps]);
  const wx = useMemo(() => writableExecutable(maps), [maps]);
  const clashing = useMemo(() => overlaps(maps), [maps]);

  const note = (
    <p className="disks__note muted">
      <code>/proc/&lt;pid&gt;/smaps</code> is <strong>this file with the accounting filled in</strong>
      : a block per mapping, each opening with the very line this one prints. Reading that walks
      every page table entry; reading this walks the list of regions and stops, which is why{' '}
      <code>pmap</code> and every leak-hunting script start here. Five things read wrong.{' '}
      <strong>The fourth character of <code>perms</code> is not a permission</strong> —{' '}
      <code>rwx</code> are, and the one after them is <code>p</code> or <code>s</code>, private or
      shared: the mapping&rsquo;s <em>type</em>, and the most important character in the line.{' '}
      <strong>Nothing here is memory.</strong> Every figure is address space, and a mapping can span
      a gigabyte holding nothing — which is exactly what a <code>---p</code> reservation is for. How
      much is in RAM is <code>smaps</code>, and it is not cheap to ask.{' '}
      <strong><code>(deleted)</code> is the kernel talking, not part of the name</strong>: the file
      behind the mapping has been unlinked — replaced by an upgrade, most often — while the process
      goes on running the copy it mapped. <strong>The path is not always a path</strong>: it may be
      empty for anonymous memory nobody named, a bracketed name the kernel made up, or a real path
      with a byte escaped as <code>\012</code>, since a newline in a filename cannot be printed in a
      line-oriented file. And <strong><code>[stack]</code> marks one stack of many</strong> — the
      main thread&rsquo;s; every other thread&rsquo;s is an ordinary anonymous mapping with nothing
      to mark it, <code>[stack:tid]</code> having gone in Linux 4.5. The gaps between mappings are
      unmapped, and on a 64-bit process they are very nearly all of the address space. The file is
      mode 0444, but opening it takes <code>PTRACE_MODE_READ</code>, so another user&rsquo;s is{' '}
      <code>EPERM</code> — the 403 this page reports — whatever the mode bits suggest.
    </p>
  );

  if (isEmpty(maps)) {
    return (
      <>
        <p className="notice" role="status" data-testid="empty">
          This file is empty, which is not an error: a <strong>kernel thread</strong> has no{' '}
          <code>mm</code> and so no address space to list, and neither has a process that has
          already exited. Which of the two this is cannot be told from here —{' '}
          <code>/proc/&lt;pid&gt;/stat</code> says. Note that{' '}
          <code>/proc/&lt;pid&gt;/statm</code> answers the same question with seven zeroes rather
          than with nothing.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      {maps.malformed.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="malformed">
          {maps.malformed.length === 1 ? 'A line here is' : `${maps.malformed.length} lines here are`}{' '}
          not a mapping. Every line this file holds is a range, a mode, an offset, a device, an
          inode and optionally a name — switch to the raw view to see what the server returned.
        </p>
      )}

      {clashing.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="overlaps" >
          <strong>Two mappings here cover the same address.</strong> One address space cannot hold
          that, and the kernel walks its regions in order, so this file did not come from a running
          process. The rows below are shown as they stand.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="mappings" value={String(summary.mappings)} />
        <Stat label="address space" value={formatBytes(summary.bytes)} />
        <Stat label="files mapped" value={String(summary.files)} />
        <Stat
          label="largest mapping"
          value={summary.largest === null ? '—' : formatBytes(sizeOf(summary.largest))}
        />
      </section>

      <p className="notice" role="status" data-testid="not-memory">
        <strong>None of that is memory.</strong> {formatBytes(summary.bytes)} is how much address
        space this process has <em>mapped</em>, not how much is in RAM — and the two are not close
        on any real process.{' '}
        {summary.reservations > 0 ? (
          <>
            {summary.reservations === 1
              ? 'One mapping here is a '
              : `${summary.reservations} of these mappings are `}
            <code>---p</code> reservation{summary.reservations === 1 ? '' : 's'}, readable by
            nobody: an allocator takes a large range so it can hand out pieces later, and until it
            does the range costs nothing but numbers.{' '}
          </>
        ) : null}
        <code>/proc/&lt;pid&gt;/smaps</code> is where residency is, a mapping at a time, and{' '}
        <code>/proc/&lt;pid&gt;/statm</code> has the totals in one line.
      </p>

      {gone.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="deleted">
          <strong>
            {gone.length === 1
              ? 'One mapped file has been deleted since it was mapped.'
              : `${gone.length} mapped regions are of files deleted since they were mapped.`}
          </strong>{' '}
          The <code>(deleted)</code> is the kernel&rsquo;s, not part of the name: the file was
          unlinked and this process is still running the copy it mapped.{' '}
          {[...new Set(gone.map((mapping) => labelOf(mapping)))].join(', ')} —{' '}
          <strong>a patched library still in use</strong> looks exactly like this, which is what
          makes it worth restarting a service after an upgrade rather than assuming the new code is
          running.
        </p>
      )}

      {wx.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="wx">
          <strong>
            {wx.length === 1 ? 'One mapping is' : `${wx.length} mappings are`} writable and
            executable at once.
          </strong>{' '}
          A page that can be written and then run is what a JIT needs — and what an exploit needs
          too, which is why a loader should never leave one behind.{' '}
          {[...new Set(wx.map((mapping) => labelOf(mapping)))].join(', ')}. A runtime that names its
          JIT region is doing this deliberately; the same permissions on a mapped library would not
          be.
        </p>
      )}

      <div className="card mounts maps">
        <table className="mounts__table maps__table" aria-label="Memory mappings">
          <thead>
            <tr>
              <th scope="col">Range</th>
              <th scope="col">Size</th>
              <th scope="col" title="rwx, then p or s — private or shared, which is not a permission">
                Mode
              </th>
              <th scope="col">Kind</th>
              <th scope="col">What is behind it</th>
            </tr>
          </thead>
          <tbody>
            {maps.mappings.map((mapping, index) => (
              <MappingRow key={mapping.start} maps={maps} mapping={mapping} index={index} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card maps__kinds" data-testid="kinds">
        <h2 className="maps__heading">Address space by kind</h2>
        <ul className="maps__kindlist">
          {kinds.map((total) => (
            <li className="maps__kindrow" key={total.kind}>
              <span className="maps__kindname">{total.kind}</span>
              <span className="maps__kindbytes">{formatBytes(total.bytes)}</span>
              <span className="maps__kindcount muted">
                {total.count} {total.count === 1 ? 'mapping' : 'mappings'}
              </span>
              <span className="maps__kindwhat muted">{KINDS[total.kind]}</span>
            </li>
          ))}
        </ul>
      </div>

      {maps.mappings.some(hasEscape) && (
        <p className="notice" role="status" data-testid="escaped">
          <strong>A path here holds an escaped byte.</strong> <code>seq_file_path</code> writes any
          byte that would break the line as octal — <code>\012</code> is a newline — because this
          file is read a line at a time and a filename may legally hold one. The name above is shown
          decoded; the raw view has it as the kernel wrote it.
        </p>
      )}

      {!summary.ordered && (
        <p className="notice notice--warn" role="status" data-testid="unordered">
          These mappings are not in ascending address order. The kernel walks a process&rsquo;s
          regions in order and prints them as it goes, so a file in another order was assembled by
          something else.
        </p>
      )}

      {note}
    </>
  );
}
