import { useMemo } from 'react';
import { DirectoryView, linkFor } from './DirectoryView';
import { readDirectory, type Entry, type Listing } from '../lib/directory';
import { limitFor, LIMITS, WRITE_CAPABILITY, type UcountLimit } from '../lib/sys-user-ucount';

/**
 * The listing of `/proc/sys/user`, which is the one directory here whose
 * entries are worth naming as a **set** rather than as a dozen names in a grid.
 *
 * The twelve `ucount` limits are one mechanism — one parser, one view, one page
 * — so this page gives them a section of their own and says what each of them
 * bounds and what fails when it is reached. That is the whole difference from
 * the listing page every other directory gets: a reader arriving here is
 * looking at twelve names that differ by one word each, and the word is not the
 * interesting part.
 *
 * **Anything else in the directory is listed the usual way.** A name this app
 * has no facts for goes into `Directories` or `Files` exactly as
 * {@link DirectoryView} would show it — a thirteenth limit a later kernel adds
 * is a file here like any other, and it links at its own name to the raw page,
 * because nothing about being in this directory makes this app know what it is.
 *
 * The limits are in the kernel's own order — the one `user_table` declares them
 * in, which {@link LIMITS} carries — rather than in the alphabetical one the
 * listing sorts by, so the eight namespace limits stay together and the four
 * that are not namespaces stay after them. What is *shown* is what the backend
 * listed: a limit this kernel does not have is not a row, because the row would
 * be a link to a file that is not there.
 */
export function SysUserDirectoryView({ listing, path }: { listing: Listing; path: string }) {
  const entries = useMemo(() => readDirectory(listing, path).entries, [listing, path]);

  /** The limits this directory actually holds, in the kernel's declared order. */
  const limits = useMemo(() => {
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    return LIMITS.flatMap((limit) => {
      const entry = byName.get(limit.name);
      return entry === undefined || entry.kind !== 'file' ? [] : [{ limit, entry }];
    });
  }, [entries]);

  return (
    <>
      {limits.length > 0 && <LimitSection limits={limits} />}

      {/* Everything the section above did not account for, shown the way every
          other directory's entries are. */}
      <DirectoryView listing={listing} path={path} omit={isLimit} />
    </>
  );
}

/** Whether this entry is one of the twelve, and so already shown above. */
function isLimit(entry: Entry): boolean {
  return entry.kind === 'file' && limitFor(entry.name) !== undefined;
}

/**
 * The limits themselves: a column of them, a row per file, each name linking at
 * its own page the way every entry in a listing links at its own name.
 *
 * A tile would carry the name and nothing else, and the name is what a reader
 * already has. So this is the same table the limit pages carry — file, what it
 * bounds, what fails at the ceiling — which is the part that differs between
 * them, and it is the reason to come here rather than open all twelve.
 *
 * The **values are not here**. Reading them would be a request per file to put
 * twelve numbers on a page about what the files are, and the number is what the
 * page behind each name is for.
 */
function LimitSection({ limits }: { limits: { limit: UcountLimit; entry: Entry }[] }) {
  return (
    <section className="explorer" aria-label="Limits">
      <h2 className="explorer__title">
        Limits
        <span className="explorer__count muted">{limits.length.toLocaleString('en-US')}</span>
      </h2>

      <div className="card mounts ucount">
        <table className="mounts__table ucount__table" aria-label="The ucount limits">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Bounds</th>
              <th scope="col">At the limit</th>
            </tr>
          </thead>
          <tbody>
            {limits.map(({ limit, entry }) => (
              <tr key={limit.name} className="ucount__row">
                <td className="ucount__name">
                  <a className="ucount__link" href={linkFor(entry)} title={entry.path}>
                    {limit.name}
                  </a>
                </td>
                <td className="ucount__bounds">{limit.bounds}</td>
                <td className="ucount__errno">{limit.errno}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        Each of these is a <strong>ceiling and not a count</strong>: nothing in{' '}
        <code>/proc/sys/user</code> says how many of anything exists. Each is charged{' '}
        <strong>per user, per user namespace</strong> and against{' '}
        <strong>every ancestor namespace as well</strong>, which is what stops a user creating a
        user namespace to escape the limits they already have. And each is a{' '}
        <strong>setting rather than a report</strong> — writable by a reader with{' '}
        <code>{WRITE_CAPABILITY}</code> in the owning namespace, read-only to everyone else. Open
        one for what its number means on this machine.
      </p>
    </section>
  );
}
