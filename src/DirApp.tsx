import { useMemo } from 'react';
import { DirectoryPage } from './components/DirectoryPage';
import { Refused } from './components/Refused';
import { HOST_ROOT } from './api/paths';
import { resolveEntry } from './pages';

/**
 * The page for a directory this app has no page of its own for — `/proc/sys`,
 * `/proc/12282`, and everything below them.
 *
 * `/proc` is not a flat directory of files with a page each: its own
 * directories nest, and every running process is one. The listing links at each
 * entry's own name, so a directory there leads to a URL that had nothing behind
 * it until now. This is what is behind all of them.
 *
 * **It lists the directory its own URL names**, the same rule every page here
 * follows: `<base-url>/sys/` lists `/proc/sys` from
 * `<base-url>/0/api/dir/sys`, `<base-url>/12/net/` lists `/proc/12/net` from
 * `<base-url>/0/api/dir/12/net`. One document answers for every directory, so
 * the servers route a URL naming one to it — see `documentForPath` in
 * `config/document.ts`, which looks the path up on the machine and hands a
 * directory to this page and a file to {@link RawApp} — and the URL the reader
 * is at is left as it is, since that URL is the whole of what this page reads.
 *
 * Whether the directory is there at all is the backend's answer to give: the
 * page asks for what its URL spells and reports the 404 if there is one.
 */
export function DirApp() {
  const { path, refused } = useMemo(
    () => resolveEntry(window.location.pathname, import.meta.env.BASE_URL),
    [],
  );

  // The URL is the path, so one spelling a path this app will not ask for is
  // refused rather than sent — and rather than quietly listing somewhere else.
  if (path === null) {
    return (
      <Refused path={HOST_ROOT}>
        <code>{refused}</code> is not a path this app will list. This page lists the directory its
        own URL names — <code>/sys/</code> lists <code>/proc/sys</code> — so the URL has to be a
        path under <code>/proc</code>, with no <code>.</code> or <code>..</code> in it.
      </Refused>
    );
  }

  return <DirectoryPage path={path} />;
}
