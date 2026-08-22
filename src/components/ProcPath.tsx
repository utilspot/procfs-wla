import { Fragment, useMemo } from 'react';
import { adminCrumbs, crumbsFor, serverHome, type Crumb } from '../pages';

/**
 * The path at the top of every page, as a trail back up it.
 *
 * `/proc/sys/debug/exception-trace` reads as four steps: `proc`, `sys` and
 * `debug` are the directories above this file and each lists itself when
 * clicked, while `exception-trace` is where the reader is standing and so is
 * not a link. The whole still reads as the path, separators and all, because
 * the path is what the page is about — a heading that spelt it differently from
 * the file it names would be a second thing to reconcile.
 *
 * **A separator is not part of either step it sits between**, so it is drawn
 * between them rather than folded into one: a link here is a directory's name
 * and nothing else, which is what it would be anywhere else on the page.
 *
 * Where the trail goes is {@link crumbsFor}: every step above the last is a
 * directory, and every directory has a page here — the listing that any
 * directory with no page of its own lands on.
 *
 * Ahead of the path, and **only where this app is served below the root**,
 * comes the one step the trail itself cannot have: the server's own home page,
 * which is above this app rather than inside it. It sits outside the `code`
 * that holds the path, because it is not part of the path — see
 * {@link serverHome}.
 */
export function ProcPath({ path }: { path: string }) {
  const base = import.meta.env.BASE_URL;
  const crumbs = useMemo(() => crumbsFor(path, base), [path, base]);
  const home = useMemo(() => serverHome(base), [base]);

  return <PathTrail crumbs={crumbs} home={home} />;
}

/**
 * The same trail for the **admin page**, whose URL is the one here that names
 * no host path: `/proc/0/admin`, of which only `proc` is a place — see
 * {@link adminCrumbs}. It is a heading spelt as a path for the same reason
 * every other page's is, and it leads back to the listing of `/proc` the way
 * they do.
 */
export function AdminPath() {
  const base = import.meta.env.BASE_URL;
  const crumbs = useMemo(() => adminCrumbs(base), [base]);
  const home = useMemo(() => serverHome(base), [base]);

  return <PathTrail crumbs={crumbs} home={home} />;
}

/** The trail itself, which is the same however the steps were worked out. */
function PathTrail({ crumbs, home }: { crumbs: Crumb[]; home: string | null }) {
  return (
    <h1 className="app__path">
      {home !== null && (
        <a className="app__path-home" href={home} title="The top of this server, above this app">
          home
        </a>
      )}
      <code>
        {crumbs.map((crumb, index) => (
          <Fragment key={`${index}:${crumb.name}`}>
            {/* Every step is preceded by one, the first included: the path is
                absolute, and it is the leading slash that says so. */}
            <span className="app__path-separator">/</span>
            {crumb.url === null ? (
              <span className="app__path-here" aria-current="page">
                {crumb.name}
              </span>
            ) : (
              <a
                className="app__path-up"
                href={crumb.url}
                title={`List /${crumbs
                  .slice(0, index + 1)
                  .map((step) => step.name)
                  .join('/')}`}
              >
                {crumb.name}
              </a>
            )}
          </Fragment>
        ))}
      </code>
    </h1>
  );
}
