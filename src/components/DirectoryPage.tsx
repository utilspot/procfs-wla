import type { ReactNode } from 'react';
import { DirectoryView } from './DirectoryView';
import { ProcPath } from './ProcPath';
import { SiteFooter } from './SiteFooter';
import { useFsDirectory } from '../hooks/useFsDirectory';
import type { Listing } from '../lib/directory';

/**
 * Shell shared by every page that shows a directory rather than a file: lists
 * the path it is given through `<base-url>/0/api/dir/`, which is where the
 * backend lists a directory — beside the bytes at `/0/api/file`.
 *
 * Which directory that is, is the caller's to say: `/proc` for the page the
 * base lands on, and whatever its own URL names for the page any other
 * directory lands on. See {@link IndexApp} and {@link DirApp}.
 *
 * The listing is read once, when the page loads. Nothing here navigates — an
 * entry is a link, so opening one is a load of its own.
 *
 * What is *done* with the listing is the caller's too, and by default it is
 * {@link DirectoryView} — the tiles every directory here is shown as. A page
 * with something of its own to say about the directory passes a `children`
 * instead: `sys/user/index.html` names what each of the twelve `ucount` limits
 * bounds before listing whatever else is in there. See {@link SysUserIndexApp}.
 */
export function DirectoryPage({
  path,
  children,
}: {
  path: string;
  /** Renders the listing, for a page that shows it as more than tiles. */
  children?: (listing: Listing) => ReactNode;
}) {
  const { listing, error, loading, loadedAt } = useFsDirectory(path);

  return (
    <div className="app">
      <header className="app__header">
        <ProcPath path={path} />
      </header>

      <main>
        {error !== null && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        {loading && listing === null && error === null && (
          <p className="notice" role="status">
            Listing {path}…
          </p>
        )}

        {listing !== null &&
          (children === undefined ? <DirectoryView listing={listing} path={path} /> : children(listing))}
      </main>

      <SiteFooter>
        {loadedAt !== null && `Last read at ${loadedAt.toLocaleTimeString()}`}
      </SiteFooter>
    </div>
  );
}
