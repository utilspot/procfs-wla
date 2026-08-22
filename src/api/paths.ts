/**
 * The one place that knows how a host path becomes a request path.
 *
 * A page names the file it reads by its path on the machine — `/proc/cpuinfo`,
 * `/proc/1234/smaps` — and that is what the headings, the error messages and
 * the fixture catalogue all say. The backend serves those files under
 * `/0/api/file` instead of at the path itself, so the app is not fighting the
 * server it is deployed beside for the `/proc` prefix: with `--base-url=/proc`
 * the pages are `/proc/cpuinfo.html` and the data `/proc/0/api/file/cpuinfo`,
 * and neither can swallow the other. Everything the backend answers lives under
 * `/0/api`, the file bytes at `/0/api/file` beside the listing at `/0/api/dir`.
 *
 * Kept free of `import.meta.env` and of node built-ins, so the client, the dev
 * server's proxy table and the mock server can all agree on one mapping.
 */

/**
 * The one directory in this app's URL space that is not a `/proc` entry: what a
 * page *loads* is served from here, and so is everything the backend answers.
 *
 * `0` is a name `/proc` can never hold, which is the point: it keeps the app's
 * own URLs out of the space that mirrors the machine's entries. The top level
 * is procfs's static entries plus one directory per running process, and pid 0
 * is the idle task — it has no directory, and never will. So no URL below the
 * base is ambiguous: `/0/…` is the app's, everything else names an entry.
 *
 * It lives here rather than beside the build's own settings because both sides
 * of that split need it — `config/document.ts` re-exports it as `ASSET_DIR` for
 * the files a page loads, and the routes below put the data under the same
 * name. A server dispatching on it has to match these routes **before** it
 * hands the rest of `/0/` to whatever serves the built assets.
 */
export const ASSET_DIR = '0';

/** Everything the backend answers lives under here, and nothing else does. */
export const API_PREFIX = `/${ASSET_DIR}/api`;

/** Where the backend serves the host files. */
export const API_ROOT = `${API_PREFIX}/file`;

/** Where it lists a directory of them, beside the bytes at {@link API_ROOT}. */
export const LIST_ROOT = `${API_PREFIX}/dir`;

/** The directory on the machine those files come from. */
export const HOST_ROOT = '/proc';

/** Whether this path names a file the backend serves — everything under /proc. */
function isHostPath(path: string): boolean {
  return path === HOST_ROOT || path.startsWith(`${HOST_ROOT}/`);
}

/**
 * The request path for a host path: `/proc/cpuinfo` -> `/0/api/file/cpuinfo`,
 * and `/proc/{pid}/smaps` -> `/0/api/file/{pid}/smaps` with the placeholder in
 * place, so a page's path and the route serving it are built the same way.
 *
 * A path outside `/proc` is handed back unchanged rather than rewritten into
 * something that looks served: there is nothing behind it either way, and the
 * 404 then names the path that was actually asked for.
 */
export function apiPath(path: string): string {
  return isHostPath(path) ? `${API_ROOT}${path.slice(HOST_ROOT.length)}` : path;
}

/**
 * The request path for a *listing* of a directory: `/proc` -> `/0/api/dir/`,
 * `/proc/sys` -> `/0/api/dir/sys`.
 *
 * The trailing slash on the root is not decoration. The backend takes the
 * relative path as everything one character past `/0/api/dir`, so `/0/api/dir`
 * with nothing after it leaves it reading past the end of the URL — see
 * `requestStatHandler` in `WebProcfsExecutor.c`. `/0/api/dir/` is what asks for
 * `/proc` itself.
 */
export function listPath(path: string): string {
  if (!isHostPath(path)) return path;

  const below = path.slice(HOST_ROOT.length).replace(/\/$/, '');
  return `${LIST_ROOT}${below === '' ? '/' : below}`;
}

/**
 * The host path a request is for, or null for a request that is not under
 * {@link API_ROOT} at all.
 */
export function hostPathFor(path: string): string | null {
  if (path !== API_ROOT && !path.startsWith(`${API_ROOT}/`)) return null;
  return `${HOST_ROOT}${path.slice(API_ROOT.length)}`;
}
