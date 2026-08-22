import { statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { API_PREFIX, API_ROOT, ASSET_DIR, HOST_ROOT, LIST_ROOT } from '../src/api/paths';
import {
  answersPath,
  directoryDocumentFor,
  isReadablePath,
  PAGES,
  type Page,
} from '../src/pages';

/**
 * The page a request for the base path lands on: the listing of `/proc` itself,
 * so the viewer opens on the directory everything else here comes out of rather
 * than on whichever file happened to be built first.
 *
 * It is also Vite's own default entry name, which is a coincidence worth not
 * relying on — every entry this app builds is named explicitly in
 * vite.config.ts, this one included.
 */
export const DOCUMENT = 'index.html';

/**
 * Where every file a page *loads* is served from: its script, its stylesheet,
 * and anything else the build emits that is not itself a page.
 *
 * The file stays where the build put it — `cpuinfo-CMwOulyt.js` at the top of
 * `dist/`, `pid/smaps-CppHR6Xo.js` beside its document — and only the URL moves
 * under here. `dist/manifest.json` is a map from URL to file, so saying the two
 * differ is what it is for; the tags the build writes into each page are made
 * to agree by `renderBuiltUrl` in vite.config.ts, and the preview server maps
 * the URL back to the file with {@link fileForAssetUrl}.
 *
 * Defined in `src/api/paths.ts`, which says why the name is `0` — and which
 * puts the backend's own routes under the same directory, so the two are one
 * decision rather than two that have to agree. That is why
 * {@link fileForAssetUrl} answers for the assets here but not for `/0/api`.
 */
export { ASSET_DIR };

/**
 * The page every *other* directory lands on: the one this app has no page of
 * its own for. It lists the directory its own URL names, so one document
 * answers for all of them — `/sys/`, `/12282/`, and any depth below — the way
 * `pid/smaps.html` answers for every process. See {@link documentForPath}.
 *
 * Named for what the backend calls the same thing, `/0/api/dir` — the two
 * answer the same question, one with a listing and one with a page showing it.
 */
export const DIRECTORY_DOCUMENT = 'dir.html';

/**
 * And the page every other *file* lands on: the one no page here parses, shown
 * as the bytes it is. It reads the file its own URL names, so one document
 * answers for all of those too. Which of the two a URL gets is decided by what
 * is actually at that path — again {@link documentForPath}.
 *
 * Named for `/0/api/file`, as {@link DIRECTORY_DOCUMENT} is for `/0/api/dir`.
 */
export const FILE_DOCUMENT = 'file.html';

/** The two of them, which are the documents published at no URL of their own. */
export const ASIDE_DOCUMENTS = [DIRECTORY_DOCUMENT, FILE_DOCUMENT];

/** Every page a normal build emits. `DOCUMENT` is the one `/` lands on. */
export const DOCUMENTS = [
  DOCUMENT,
  DIRECTORY_DOCUMENT,
  FILE_DOCUMENT,
  'cpuinfo.html',
  'mounts.html',
  'diskstats.html',
  'version.html',
  'stat.html',
  'crypto.html',
  'devices.html',
  'cmdline.html',
  'slabinfo.html',
  'interrupts.html',
  'modules.html',
  'schedstat.html',
  'partitions.html',
  'bootconfig.html',
  'buddyinfo.html',
  'cgroups.html',
  'consoles.html',
  'dma.html',
  'execdomains.html',
  'fb.html',
  'filesystems.html',
  'iomem.html',
  'ioports.html',
  'kallsyms.html',
  'keys.html',
  'key-users.html',
  'latency_stats.html',
  'loadavg.html',
  'locks.html',
  'mdstat.html',
  'meminfo.html',
  'misc.html',
  'pagetypeinfo.html',
  'softirqs.html',
  'swaps.html',
  'timer_list.html',
  'uptime.html',
  'version_signature.html',
  'vmallocinfo.html',
  'vmstat.html',
  'zoneinfo.html',
  'uid_time_in_state.html',
  'gpu_load.html',
  'gpu_memory.html',
  'uid_io/stats.html',
  // A file in a directory of `/proc` rather than at the top of it, so its
  // document is in one too — the URL is the path, here as everywhere.
  'tty/drivers.html',
  'tty/ldiscs.html',
  'irq/default_smp_affinity.html',
  'driver/rtc.html',
  'sysvipc/shm.html',
  'sysvipc/sem.html',
  'sysvipc/msg.html',
  'asound/version.html',
  'asound/timers.html',
  'asound/pcm.html',
  'asound/modules.html',
  'asound/devices.html',
  'asound/cards.html',
  'scsi/scsi.html',
  'scsi/device_info.html',
  'scsi/sg/version.html',
  'scsi/sg/devices.html',
  'scsi/sg/device_strs.html',
  'scsi/sg/device_hdr.html',
  'scsi/sg/def_reserved_size.html',
  'scsi/sg/debug.html',
  'scsi/sg/allow_dio.html',
  // The twelve files two directories below `/proc`, and the only ones from the
  // sysctl tree — everything else under `sys/` is still answered by the listing
  // and raw pages. One document for all twelve, which takes the limit from its
  // own URL the way a process page takes the pid: `/sys/user/max_ipc_namespaces`
  // is served this, and reads the file that URL names. See `documentForUrl`.
  'sys/user/limit.html',
  // And the directory holding them, which is the one directory below `/proc`
  // with a page of its own: it names what each of the twelve bounds, and lists
  // anything else in there the way `dir.html` would. See `documentForPath`.
  'sys/user/index.html',
  // The memory manager's own directory, which gets a page for the opposite
  // reason: its entries are several mechanisms rather than one, so the page
  // groups them. Everything else under `sys/` is still the listing page's.
  'sys/vm/index.html',
  // And the one document behind every file in it, which takes the name from its
  // own URL the way `sys/user/limit.html` takes the limit.
  'sys/vm/parameter.html',
  // Files that belong to a process rather than to the machine, so their pages
  // are nested and take the process from their own URL — `/1234/smaps` serves
  // this document, which then reads /proc/1234/smaps. See `documentForUrl`.
  'pid/maps.html',
  'pid/smaps.html',
  'pid/limits.html',
  'pid/cmdline.html',
  'pid/environ.html',
  'pid/coredump_filter.html',
  'pid/io.html',
  'pid/time_in_state.html',
  'pid/syscall.html',
  'pid/schedstat.html',
  'pid/statm.html',
  'pid/stat.html',
  'pid/comm.html',
  'pid/uid_map.html',
  'pid/gid_map.html',
  'pid/setgroups.html',
  'pid/stack.html',
  'pid/wchan.html',
  'pid/mounts.html',
  'pid/mountinfo.html',
  'pid/sessionid.html',
  'pid/status.html',
  'pid/autogroup.html',
  'pid/auxv.html',
  'pid/cgroup.html',
  // A file in a directory of a process's own directory, so its document is two
  // deep — `/1234/net/arp` serves this one, which reads /proc/1234/net/arp.
  'pid/net/arp.html',
  'pid/net/connector.html',
  'pid/net/dev.html',
];

/**
 * The fixture switcher, built and served in debug mode only. With debug off it
 * is not an entry point, so a build never emits it — and the dev server, which
 * would otherwise happily serve any file in `src/pages/`, is told to treat
 * it as missing.
 *
 * This is the **file**, at the top of the output like every other document.
 * Where it is *served* is {@link ADMIN_URL}.
 */
export const ADMIN_DOCUMENT = 'admin.html';

/**
 * The URL it is served at, below the base: `/0/admin.html`.
 *
 * Unlike the two fallbacks the admin page *is* published — see `urlFor` in
 * `config/manifest.ts` — because it is entered directly rather than reached, so
 * its name claims a URL. That URL goes under {@link ASSET_DIR}, the one
 * directory `/proc` can never reach into, rather than beside the pages named
 * for `/proc` entries: the admin page is not one, and putting it there would
 * shadow the entry `/proc/admin` if a kernel ever grew one.
 *
 * File and URL differ here exactly as they do for everything else under `0/` —
 * the build leaves the file where it put it and only the URL moves — so
 * {@link fileForAssetUrl} maps this one back with no case of its own.
 *
 * It keeps its `.html`: nobody navigates to it by path, so an extensionless URL
 * would buy it nothing and only break the links that already point at it.
 */
export const ADMIN_URL = `${ASSET_DIR}/${ADMIN_DOCUMENT}`;

/**
 * The document served *at* the base path itself: the listing of `/proc`, which
 * is what the base is a listing of.
 *
 * This is a **rewrite**, not a redirect. `/proc/` is the URL the listing is
 * published at — see `urlFor` in `config/manifest.ts` — so a reader who asks
 * for it should keep it rather than being moved along to `/proc/index.html`,
 * a URL nothing advertises and nothing links to.
 *
 * Returns null for every other request, which is left alone.
 */
export function documentAtBase(url: string, base: string): string | null {
  const [pathname = '/', query] = url.split('?', 2);

  // Vite strips the base from req.url before plugin middlewares see it, but not
  // in every server, so accept both spellings.
  const isBase = pathname === '/' || pathname === '' || pathname === base;
  if (!isBase) return null;

  return `${base}${DOCUMENT}${query === undefined ? '' : `?${query}`}`;
}

/**
 * Where a request for the base *without* its trailing slash belongs, which is
 * the same URL with one.
 *
 * This one is a redirect, and has to be: the listing's links are relative —
 * `cpuinfo`, `12282/status` — so from `/proc` they would resolve a directory
 * too high, against the server's root. The slash is what makes the base a
 * directory as far as a browser is concerned.
 */
export function trailingSlashRedirect(url: string, base: string): string | null {
  const [pathname = '/', query] = url.split('?', 2);
  const withoutSlash = base.replace(/\/$/, '');

  if (withoutSlash === '' || pathname !== withoutSlash) return null;

  return `${base}${query === undefined ? '' : `?${query}`}`;
}

/**
 * The file behind an asset URL: `/0/cpuinfo-CMwOulyt.js` is the file
 * `cpuinfo-CMwOulyt.js`, which sits at the top of the build output rather than
 * in a `0/` directory — see {@link ASSET_DIR} for why the two differ.
 *
 * **`/0/api` is not an asset URL.** The backend's routes are under the same
 * directory — one namespace for everything that is not a `/proc` entry — so
 * they are turned down here rather than rewritten into a file that was never
 * built. Every server dispatching on `/0/` owes the API routes the same
 * precedence; `getInternalRequest` in `WebProcfsExecutor.c` is the other one.
 *
 * A deployed server needs none of this: `dist/manifest.json` gives it the URL
 * and the file side by side. It is the *preview* server that serves the output
 * directory by path and so has to be told, and the dev server never sees such a
 * URL at all — nothing is built there, so nothing is renamed.
 *
 * Returns null for every other request, which is left alone.
 */
export function fileForAssetUrl(url: string, base: string): string | null {
  const [pathname = '/', query] = url.split('?', 2);
  // Vite strips the base from req.url before plugin middlewares see it, but not
  // in every server, so accept both spellings.
  const below = pathname.startsWith(base)
    ? pathname.slice(base.length)
    : pathname.replace(/^\//, '');

  const prefix = `${ASSET_DIR}/`;
  if (!below.startsWith(prefix)) return null;

  // The backend answers for everything under here, and none of it is a file
  // this build emitted.
  const urlPath = `/${below}`;
  if (urlPath === API_PREFIX || urlPath.startsWith(`${API_PREFIX}/`)) return null;

  const file = below.slice(prefix.length);
  if (file === '') return null;

  return `${base}${file}${query === undefined ? '' : `?${query}`}`;
}

/**
 * Whether a request is for the admin page, in any of its spellings.
 *
 * With debug off every one of them has to be refused, so this is deliberately
 * the widest of the checks here rather than the narrowest.
 *
 * {@link ADMIN_URL} is where the page is published. The bare file name is what
 * {@link fileForAssetUrl} rewrites that to, and what the dev server would serve
 * out of `src/pages/` on its own. Both count with and without the base, since
 * Vite strips it before plugin middlewares in some servers and not others —
 * and both count **without the `.html`**, because the static server under the
 * preview finds `admin.html` for a URL that leaves the extension off, the same
 * resolution that serves every page at `/cpuinfo`. Refusing only the spellings
 * this app writes down would leave that one open on a debug build served with
 * debug off.
 */
export function isAdminRequest(url: string, base: string): boolean {
  const [pathname = '/'] = url.split('?', 2);
  const spellings = [ADMIN_URL, ADMIN_DOCUMENT].flatMap((spelling) => [
    spelling,
    spelling.replace(/\.html$/, ''),
  ]);

  return spellings.some(
    (spelling) => pathname === `/${spelling}` || pathname === `${base}${spelling}`,
  );
}

/** The pages whose URL names a value, which is what needs mapping below. */
const PARAMETERIZED: Page[] = PAGES.filter((page) => page.parameter !== undefined);

/**
 * The document behind a URL that names a value: `/1234/smaps` is served by
 * `pid/smaps.html`, which then reads `/proc/1234/smaps` out of that same URL,
 * and `/sys/user/max_ipc_namespaces` by `sys/user/limit.html`, which reads that
 * limit out of its URL the same way.
 *
 * For a process any one segment does, `/pid/smaps` — the document's own
 * published URL — and `/root/smaps` included. Which processes exist is the
 * backend's business: the page loads, asks for the path its URL spells, and
 * reports the 404 if there is one. Refusing to serve the page here would
 * replace that answer with a blank 404 from the wrong side.
 *
 * For `/proc/sys/user` the twelve names are known, so only they are claimed —
 * `answersPath` is what decides — and a name that is not one of them goes on to
 * {@link documentForPath} like any other path, which hands a file the kernel
 * grew since to the raw page rather than to a page that has nothing to say
 * about it.
 *
 * Returns null for every other request, which is left alone — a URL whose last
 * segment is not one of these pages is not one of this app's, and a page's own
 * assets sit beside it under a hashed name that never matches.
 *
 * This is a **rewrite**, not a redirect. The process is in the URL because that
 * is where the page reads it from, so sending the browser to `/pid/smaps`
 * instead would throw away the thing being asked for.
 */
export function documentForUrl(url: string, base: string): string | null {
  const [pathname = '/', query] = url.split('?', 2);
  // Vite strips the base from req.url before plugin middlewares see it, but not
  // in every server, so accept both spellings.
  const below = pathname.startsWith(base)
    ? pathname.slice(base.length)
    : pathname.replace(/^\//, '');
  // The dev and preview servers still serve a page at its own file name, so a
  // URL reaches here in both spellings; `resolvePath` reads it the same way.
  const candidate = `${HOST_ROOT}/${below.replace(/\.html$/, '')}`;

  for (const page of PARAMETERIZED) {
    if (answersPath(page, candidate)) {
      return `${base}${page.document}${query === undefined ? '' : `?${query}`}`;
    }
  }

  return null;
}

/**
 * The URLs this app's own documents are served at, below the base.
 *
 * The admin page is not among them: it is served under {@link ASSET_DIR}, and
 * everything there is turned down by {@link documentForPath} wholesale.
 */
const SERVED_URLS = new Set(DOCUMENTS.map((document) => document.replace(/\.html$/, '')));

/** What a `/proc` path turns out to be, as far as this app has pages for. */
export type EntryKind = 'file' | 'directory';

/**
 * What is at this path on the machine, or null for nothing this app shows —
 * which is anything that is not there and anything that is neither a file nor
 * a directory. `/proc/self` is a symbolic link to one, so the link is followed:
 * what the reader asked for is what it points at.
 */
export function hostEntryKind(path: string): EntryKind | null {
  try {
    const entry = statSync(path);
    return entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : null;
  } catch {
    // Not there, or not readable enough to say. Either way there is nothing to
    // serve, and the request is left to 404 as it did before.
    return null;
  }
}

/**
 * The document behind a URL this app publishes no page for: **whatever is at
 * that path on the machine decides**. `/sys/` is a directory, so it is served
 * `dir.html` and lists `/proc/sys`; `/kmsg` is a file, so it is served
 * `raw.html` and shows the bytes; `/nosuchthing` is nothing, so nothing here
 * answers and the request 404s as it did before.
 *
 * A directory this app has a **page of its own** for is handed that page rather
 * than the listing one — `/sys/user/` gets `sys/user/index.html`, which names
 * what the twelve `ucount` limits in there bound. That is the same decision as
 * the two fallbacks, made from the same lookup: what is at the path, and then
 * which page answers for it. See `DIRECTORY_PAGES` in `src/pages.ts`.
 *
 * The URL below the base *is* the path, as everywhere else in this app —
 * `<base>/12282/net` asks about `/proc/12282/net` — so this is the same rule
 * the two pages themselves follow, applied one step earlier to decide which of
 * them to hand over.
 *
 * A URL gets this far only if nothing else claimed it: not the base, not the
 * base awaiting its slash, not the backend's — everything under `/api`, whose
 * listing endpoint ends in a slash like a directory does — and not a page of
 * this app's own, which includes every document it builds and every URL naming
 * a process's file. Those are the manifest's entries, at build time; here they
 * are the documents themselves, since in dev there is no manifest yet.
 *
 * `isReadablePath` is what stands between the URL and the lookup, the same
 * check the pages make before reading: no `.`, no `..`, nothing outside
 * `/proc`, nothing endless. A URL that fails it is not asked about.
 *
 * `kindOf` is the lookup, injected so this stays a pure decision. The default
 * is the machine's own `/proc`.
 *
 * This is a **rewrite**, not a redirect. The path is in the URL because that is
 * where the page reads it from, so sending the browser anywhere else would
 * throw away the thing being asked for.
 */
export function documentForPath(
  url: string,
  base: string,
  kindOf: (path: string) => EntryKind | null = hostEntryKind,
): string | null {
  const path = entryPathFor(url, base);
  if (path === null) return null;

  const kind = kindOf(path);
  return kind === null ? null : documentUrlFor(kind, path, url, base);
}

/**
 * The same decision where the lookup is a **request rather than a `stat`**, for
 * a server that is not the machine it serves.
 *
 * The dev and preview servers are exactly that: the pages they serve read a
 * captured `/proc` out of the test server, and the computer Vite is running on
 * is some developer's laptop. Asking that laptop what is at `/proc/uid_io`
 * answers for the wrong machine — see {@link backendEntryKind}, which asks the
 * one being served instead.
 *
 * Every guard {@link documentForPath} applies is applied here first, so the
 * lookup happens only for a URL that has got past all of them.
 */
export async function documentForPathAsync(
  url: string,
  base: string,
  kindOf: (path: string) => Promise<EntryKind | null>,
): Promise<string | null> {
  const path = entryPathFor(url, base);
  if (path === null) return null;

  const kind = await kindOf(path);
  return kind === null ? null : documentUrlFor(kind, path, url, base);
}

/**
 * The `/proc` path a URL is asking about, or null where this app has already
 * answered — which is every case {@link documentForPath} turns down before it
 * looks anything up.
 */
function entryPathFor(url: string, base: string): string | null {
  const [pathname = '/'] = url.split('?', 2);
  // Vite strips the base from req.url before plugin middlewares see it, but not
  // in every server, so accept both spellings.
  const below = pathname.startsWith(base)
    ? pathname.slice(base.length)
    : pathname.replace(/^\//, '');

  // The base is the `/proc` listing; the base without its slash is a redirect.
  if (below === '' || pathname === base.replace(/\/$/, '')) return null;

  // Nothing under the app's own directory names a `/proc` entry: the files a
  // page loads, everything the backend answers, and the admin page all live
  // there, and none of them is looked up on the machine.
  if (below === ASSET_DIR || below.startsWith(`${ASSET_DIR}/`)) return null;

  // A page of this app's own answers for itself — including at its file name,
  // which is how the dev and preview servers also serve it.
  if (SERVED_URLS.has(below.replace(/\.html$/, ''))) return null;
  if (documentForUrl(url, base) !== null) return null;

  // The trailing slash a directory is linked with is not part of its path.
  const path = `${HOST_ROOT}/${below.replace(/\/+$/, '')}`;
  return isReadablePath(path) ? path : null;
}

/** Which document answers for what turned out to be at the path, as a URL. */
function documentUrlFor(kind: EntryKind, path: string, url: string, base: string): string {
  const [, query] = url.split('?', 2);

  const document =
    kind === 'directory'
      ? // A directory with a page of its own gets it; every other one is listed
        // by the page that knows nothing about any of them.
        (directoryDocumentFor(path) ?? DIRECTORY_DOCUMENT)
      : FILE_DOCUMENT;

  return `${base}${document}${query === undefined ? '' : `?${query}`}`;
}

/**
 * A lookup that asks **the backend serving the pages** what is at a path,
 * rather than the computer this server happens to run on.
 *
 * It asks the two questions the pages themselves ask, in the order that settles
 * it fastest: `/0/api/dir` answers for a directory and `/0/api/file` for a
 * file, so a 200 from the first is a directory and a 200 from the second is a
 * file. Anything else — a 404 from both, a server that is not up — is nothing
 * this app will serve a page for, and the request goes on to 404 the way it
 * would have anyway.
 *
 * This is why `/uid_io/` works in dev: `/proc/uid_io` is a directory on the
 * machine being served and on no ordinary Linux, so the answer has to come from
 * the machine being served.
 */
export function backendEntryKind(server: string): (path: string) => Promise<EntryKind | null> {
  const below = (path: string) => path.slice(`${HOST_ROOT}/`.length);
  const ok = async (endpoint: string, path: string): Promise<boolean> => {
    try {
      return (await fetch(`${server}${endpoint}/${below(path)}`)).ok;
    } catch {
      // The test server is not up, which is not this middleware's to report.
      return false;
    }
  };

  return async (path: string) => {
    if (await ok(LIST_ROOT, path)) return 'directory';
    return (await ok(API_ROOT, path)) ? 'file' : null;
  };
}

/**
 * Applies {@link documentAtBase}, {@link trailingSlashRedirect},
 * {@link documentForUrl} and {@link documentForPath} to the dev and preview
 * servers, and with `debug` off refuses the admin page so it exists in debug
 * mode only.
 *
 * A deployed server has to do the same mapping for a URL that names a process.
 * It is published in `dist/manifest.json`, where such a page's `url` is the
 * pattern it answers — `/proc/{pid}/smaps` — see `config/manifest.ts`, so a
 * server reading that file can build the rule rather than hard-coding the page
 * names.
 *
 * The two fallbacks are the rules the manifest does not carry: `dir.html` and
 * `raw.html` answer every directory and every unparsed file rather than a URL
 * of their own, so they are left out of the manifest — see `buildManifest`.
 * A deployed server does the same as {@link documentForPath} does here: what it
 * has no entry for, it looks up under `/proc` and hands to whichever of the two
 * the answer calls for, or 404s if there is nothing there.
 */
export function serveDocument(debug: boolean, backend?: string): Plugin {
  let base = '/';

  // Where the fallback lookup asks. With a backend it is the machine being
  // served, which is the only one that can answer for a capture; without one it
  // is this computer's own `/proc`, which is what a deployed server reads.
  const kindOf =
    backend === undefined
      ? async (path: string) => hostEntryKind(path)
      : backendEntryKind(backend);

  const middleware = async (
    req: { url?: string | undefined },
    res: {
      statusCode: number;
      setHeader(name: string, value: string): void;
      end(body?: string): void;
    },
    next: () => void,
  ): Promise<void> => {
    const url = req.url ?? '/';

    if (!debug && isAdminRequest(url, base)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end(`${ADMIN_DOCUMENT} is available in debug mode only\n`);
      return;
    }

    // What a page loads is asked for under `0/` and kept without it, so the
    // preview server is pointed at the file. Asked first: this is the app's
    // own file space, and nothing below reads a URL in it.
    const asset = fileForAssetUrl(url, base);
    if (asset !== null) {
      req.url = asset;
      next();
      return;
    }

    // A process page is served at the URL that names the process, so the
    // request is rewritten to the document behind it and the browser's URL —
    // which is what the page reads — is left as it is.
    const document = documentForUrl(url, base);
    if (document !== null) {
      req.url = document;
      next();
      return;
    }

    // Anything else this app has no page for is looked up on the machine: a
    // directory gets the listing page, a file the raw one, and a path that is
    // not there gets nothing — the request goes on to 404 as it did before.
    // The lookup is a request rather than a `stat`, so a capture's own
    // directories — `/proc/uid_io`, which no ordinary Linux has — are answered
    // for by the machine that has them rather than by this computer.
    const entry = await documentForPathAsync(url, base, kindOf);
    if (entry !== null) {
      req.url = entry;
      next();
      return;
    }

    // The one redirect here, and only to add a slash: without it the listing's
    // relative links would resolve a directory too high.
    const slashed = trailingSlashRedirect(url, base);
    if (slashed !== null) {
      res.statusCode = 302;
      res.setHeader('Location', slashed);
      res.end();
      return;
    }

    // The base itself is served the listing where it stands. `/proc/` is the
    // URL that page is published at, so a reader who asked for it keeps it.
    const listing = documentAtBase(url, base);
    if (listing !== null) req.url = listing;

    next();
  };

  /**
   * The middleware as Connect wants it: it ignores what a handler returns, so a
   * rejected promise would be an unhandled one rather than a failed request.
   * Anything thrown here means the lookup could not be made, and a request
   * nobody rewrote is left to go on as it would have.
   */
  const guarded = (
    req: Parameters<typeof middleware>[0],
    res: Parameters<typeof middleware>[1],
    next: () => void,
  ): void => {
    void middleware(req, res, next).catch(() => next());
  };

  return {
    name: 'procfs:serve-document',

    configResolved(config) {
      base = config.base;
    },

    configureServer(server) {
      server.middlewares.use(guarded);
    },

    configurePreviewServer(server) {
      server.middlewares.use(guarded);
    },
  };
}
