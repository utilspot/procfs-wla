import { ASSET_DIR, HOST_ROOT } from './api/paths';
import { LIMITS } from './lib/sys-user-ucount';
import { TUNABLES } from './lib/sys-vm';

/**
 * The pages this app builds, and the host file each one reads.
 *
 * A page reads the file its own URL names — `<base>/devices` reads
 * `/proc/devices` — so the path a page is served at and the path it reads are
 * one fact rather than two that have to agree. See {@link resolvePath}.
 *
 * Most pages read one fixed path, and `path` is it. Two kinds of page do not
 * have one and carry a **placeholder** in `path` instead, taking the value from
 * the URL: a file that belongs to a process, where `/proc/<pid>/smaps` is a
 * different file per process — `<base>/1234/smaps` — and a directory of files
 * that are one mechanism, where `/proc/sys/user/<limit>` is twelve files one
 * page explains — `<base>/sys/user/max_ipc_namespaces`. See
 * {@link PLACEHOLDER}.
 */
export interface Page {
  /** Host path this page reads, with `{pid}` or `{limit}` where a value goes. */
  path: string;
  document: string;
  /**
   * The placeholder's name, for a page that has one, and what to read at the
   * base — the one URL that names no path of its own. See {@link resolvePath}.
   *
   * `values` is the whole set of values the page answers for, for a page whose
   * set is known here: the twelve names of `/proc/sys/user`, which the kernel
   * declares in one table and this app carries in `LIMITS`. A process page
   * names none — which processes exist is the backend's answer to give, so a
   * pid is judged by its shape instead. See {@link isValidValue}.
   */
  parameter?: { name: string; fallback: string; values?: readonly string[] };
}

/**
 * A page for a **directory** rather than for a file: it lists what is in it and
 * says something about the set, where {@link Page} reads one file and parses it.
 *
 * There are two of these — `/proc/sys/user`, whose twelve entries are one
 * mechanism worth naming as a group, and `/proc/sys/vm`, whose several dozen
 * are several mechanisms worth telling apart. Every other directory below
 * `/proc` is listed by `dir.html`, which knows nothing about any of them, and
 * `/proc` itself by `index.html`, which is served at the base rather than at a
 * path and so needs no entry here. See {@link DIRECTORY_PAGES}.
 */
export interface DirectoryPage {
  /** Host directory this page lists, e.g. `/proc/sys/user`. */
  path: string;
  document: string;
}

/**
 * The directories with a page of their own, which is what the servers route a
 * URL naming one to instead of the listing page — see `documentForPath` in
 * `config/document.ts`.
 */
export const DIRECTORY_PAGES: DirectoryPage[] = [
  // The directory the twelve `ucount` limits are in. It gets a page of its own
  // because the twelve are a set rather than twelve unrelated files: the
  // listing page would show them as a dozen names in a grid, and this one names
  // what each of them bounds. Anything else the kernel puts in there is listed
  // the way the listing page lists it, since this app knows nothing about it.
  { path: '/proc/sys/user', document: 'sys/user/index.html' },
  // And the memory manager's control panel, for a different reason: those
  // twelve are one mechanism, and these three or four dozen are a dozen
  // unrelated ones sharing a directory — writeback, overcommit, reclaim, huge
  // pages, the OOM killer — which alphabetical order interleaves. The page
  // groups the ones this app has facts for and lists the rest as ever.
  { path: '/proc/sys/vm', document: 'sys/vm/index.html' },
];

/** The directory page emitted as this document, e.g. `sys/user/index.html`. */
export function directoryPageFor(document: string): DirectoryPage {
  const page = DIRECTORY_PAGES.find((candidate) => candidate.document === document);
  if (page === undefined) throw new Error(`no directory page is built as ${document}`);
  return page;
}

/**
 * The document listing this directory, for a directory that has a page of its
 * own — otherwise undefined, and the listing page answers for it.
 *
 * A trailing slash is what a directory is linked with rather than part of its
 * path, so it is dropped before the lookup.
 */
export function directoryDocumentFor(path: string): string | undefined {
  const trimmed = path.replace(/\/+$/, '');
  return DIRECTORY_PAGES.find((page) => page.path === trimmed)?.document;
}

/**
 * The URL a directory page is served at, below the base: its path with `/proc`
 * taken off and **a trailing slash on**, `sys/user/`.
 *
 * The slash is the same one the listing links every directory with: it is what
 * makes a relative link from that page resolve inside the directory rather than
 * beside it, and this page's own links are the entries' own names.
 */
export function directoryPageUrl(page: DirectoryPage): string {
  return `${page.path.slice(`${HOST_ROOT}/`.length)}/`;
}

/** The page emitted as this document, e.g. `devices.html`. */
export function pageFor(document: string): Page {
  const page = PAGES.find((candidate) => candidate.document === document);
  if (page === undefined) throw new Error(`no page is built as ${document}`);
  return page;
}

/**
 * The URL a page is served at, which is its document without the `.html`.
 *
 * The build advertises a page that way — see `urlFor` in `config/manifest.ts` —
 * so that the viewer's URLs read like the `/proc` entries they mirror. A link
 * that used `document` verbatim would point at a URL the manifest never
 * publishes. `document` still names the file the build emits; only the link to
 * it is shortened.
 *
 * With a `value`, the URL that reads that one file: `1234/smaps` rather than
 * the `pid/smaps` the document is published at. Both serve the same document —
 * see `documentForUrl` in `config/document.ts` — and the page reads whichever
 * of the two it was opened at, `pid/smaps` included: that URL is read as the
 * path it spells, like every other.
 */
export function pageUrl(page: Page, value?: string): string {
  // Whatever the value is, it has to be the one segment the placeholder is —
  // and there has to be a placeholder for it to stand in for.
  if (page.parameter === undefined || value === undefined || value === '' || value.includes('/')) {
    return page.document.replace(/\.html$/, '');
  }

  // The path is where the placeholder is written down, and the app is not
  // served under `/proc`, so the URL is that path with the root taken off:
  // `/proc/1234/smaps` is `1234/smaps`, `/proc/sys/user/max_ipc_namespaces` is
  // `sys/user/max_ipc_namespaces`. Reading it off the document instead would
  // hold only while the document spells the placeholder out, which `pid/smaps`
  // does and `sys/user/limit` does not.
  return hostPath(page, value).slice(`${HOST_ROOT}/`.length);
}

/** What stands in for a value inside a page's path. */
export const PLACEHOLDER = /\{(\w+)\}/;

/** Whether this page reads a file belonging to something the URL names. */
export function isParameterized(page: Page): boolean {
  return page.parameter !== undefined;
}

/**
 * A process identifier this app will *build* a path from: a number, or one of
 * the kernel's own symbolic links.
 *
 * This is not what a URL is checked against — the URL is read as the path it
 * spells, and which processes exist is the backend's answer to give (see
 * {@link resolvePath}). It guards the other direction: {@link hostPath} filling
 * a placeholder from a value the app was handed rather than one it read.
 */
export const PID = /^(?:self|thread-self|[1-9]\d{0,6})$/;

/**
 * Whether this value may stand in for the placeholder.
 *
 * A page that writes its values down is answered from that list, since the
 * whole set is known: `/proc/sys/user` holds the twelve names the kernel's
 * `user_table` declares and nothing else. A page that does not — a process's
 * file — is answered by the shape of a pid, because which processes exist is
 * the backend's business rather than this app's. See {@link PID}.
 */
export function isValidValue(page: Page, value: string): boolean {
  if (page.parameter === undefined) return false;

  const { values } = page.parameter;
  return values === undefined ? PID.test(value) : values.includes(value);
}

/** The host path this page reads for one value, e.g. `/proc/1234/smaps`. */
export function hostPath(page: Page, value?: string): string {
  if (page.parameter === undefined) return page.path;
  const chosen = value !== undefined && isValidValue(page, value) ? value : page.parameter.fallback;
  return page.path.replace(PLACEHOLDER, chosen);
}

/**
 * The longest host path this app will ask for. Nothing under `/proc` comes near
 * it; the cap is here so a pasted URL cannot make the app build an unbounded
 * request.
 */
export const PATH_MAX = 255;

/** Characters a path segment may hold, which is a superset of what /proc uses. */
const SEGMENT = /^[A-Za-z0-9_@%+=,.:-]+$/;

/**
 * Whether this is a host path the app is willing to read.
 *
 * Every page's path comes from its URL, so this is the one check standing
 * between a URL and a request: everything under `/proc`, no empty segments, and
 * no `.` or `..` to walk out of it. {@link resolvePath} makes it of every
 * page's URL. The backend decides what it will actually serve — this only
 * decides what the app is prepared to ask for.
 */
export function isReadablePath(path: string): boolean {
  if (path.length > PATH_MAX || !path.startsWith(`${HOST_ROOT}/`)) return false;

  const segments = path.split('/').slice(1);
  return (
    segments.length >= 2 &&
    segments.every(
      (segment) => segment !== '.' && segment !== '..' && SEGMENT.test(segment),
    )
  );
}

/**
 * The value that filled a parameterized page's placeholder for this path —
 * the `1234` in `/proc/1234/smaps`, so a link to the page can carry it.
 */
export function valueInPath(page: Page, path: string): string | null {
  if (page.parameter === undefined) return null;
  return new RegExp(`^${pathPattern(page).replace('[^/]+', '([^/]+)')}$`).exec(path)?.[1] ?? null;
}

/**
 * Whether this page is the one that answers for this host path — which is what
 * decides the document a URL naming it is served, see `documentForUrl` in
 * `config/document.ts`.
 *
 * The path has to match the page's pattern, and where the page writes its
 * values down it has to be **one of them**: `/proc/sys/user/max_ipc_namespaces`
 * is this app's page, and a thirteenth name a later kernel adds under there is
 * not — it is a file with no page here, which is what the raw page is for. A
 * page that names no values answers for every segment, since `/proc/12282` and
 * `/proc/nosuchpid` are the same question asked of the backend.
 */
export function answersPath(page: Page, path: string): boolean {
  const value = valueInPath(page, path);
  return value !== null && (page.parameter?.values === undefined || isValidValue(page, value));
}

/** What a page found at a URL should read, from {@link resolvePath}. */
export interface Resolution {
  /** Host path to read, or null for a URL naming a path the app will not read. */
  path: string | null;
  /** What that URL named, for the message that has to say what was refused. */
  refused: string | null;
}

/**
 * The path the app is served under, with no trailing slash: `/` gives `''`,
 * `/procfs/` gives `/procfs`.
 *
 * An absolute base — `https://cdn.example.com/procfs/` — says where the app's
 * *assets* come from. The pages are still served from this origin under that
 * path, so only the path is any use, whether the question is which URL a page
 * was opened at or where to link one.
 */
export function basePath(base: string): string {
  return base.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').replace(/\/+$/, '');
}

/**
 * The part of a page URL below the base, with no surrounding slashes:
 * `/procfs/1234/smaps` under `/procfs/` gives `1234/smaps`.
 *
 * The extension is left on. {@link resolvePath} drops it, because a file page
 * is *published* without one — see `urlFor` in `config/manifest.ts` — and the
 * dev and preview servers still serve the document at its own name, so both
 * spellings have to name the same file. A listing URL has no such second
 * spelling, so {@link resolveDirectory} keeps what the URL says.
 */
function routeIn(pathname: string, base: string): string {
  const prefix = basePath(base);
  const below = prefix !== '' && pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;

  return below.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * The host path the page at this URL reads.
 *
 * **The URL is the path.** Below the base, a page's URL is read as the `/proc`
 * entry it spells and nothing else: `<base>/devices` reads `/proc/devices`,
 * `<base>/1234/smaps` reads `/proc/1234/smaps`, and `<base>/pid/smaps` — the
 * document's own published URL — reads `/proc/pid/smaps`, because that is what
 * it says. No page has a say in this and nothing is taken from the query
 * string, so where a page is served and what it reads are one fact rather than
 * two that have to agree.
 *
 * Only one URL names no path at all: the base itself, which the servers send on
 * to a document rather than 404ing. There the page reads its declared
 * {@link Page.path}, with a placeholder filled by its fallback.
 *
 * Which processes exist is the backend's business, not this app's — a URL
 * naming one that does not comes back 404 and the page says so. What the app
 * decides is only what it is prepared to *ask* for, and that is
 * {@link isReadablePath}: everything under `/proc`, no empty segments, no `.`
 * or `..`, and not endless. A URL outside that is refused rather than sent.
 */
export function resolvePath(page: Page, pathname: string, base: string): Resolution {
  // A file page is published without its extension but served at its own file
  // name too, so both spellings of the URL name the same file.
  const route = routeIn(pathname, base).replace(/\.html$/, '');
  if (route === '') return { path: hostPath(page), refused: null };

  const candidate = `${HOST_ROOT}/${route}`;

  return isReadablePath(candidate)
    ? { path: candidate, refused: null }
    : // Capped because it is about to be shown, and it arrived from a URL.
      { path: null, refused: candidate.slice(0, PATH_MAX) };
}

/**
 * Where the server's own home page is, for the step the trail cannot have:
 * `/`, the top of the origin, which is above this app rather than inside it.
 *
 * **Only when the app is served below the root.** Deployed at `/proc/`, this
 * app is one of several the server hosts, and nothing in a path under `/proc`
 * leads back out to it — the first crumb is `proc`, and that goes to the app's
 * own base. Served at the root there is nowhere above to go: the server's home
 * *is* the base, which is where that first crumb already points, and a second
 * link to the same place would be a step that goes nowhere new.
 *
 * The base may be absolute — `https://cdn.example.com/procfs/` says where the
 * *assets* come from — so {@link basePath} is what decides, as everywhere else:
 * only the path of it says whether this app is below the root of the origin
 * serving its pages.
 */
export function serverHome(base: string): string | null {
  return basePath(base) === '' ? null : '/';
}

/** One step of a host path, for the trail at the top of every page. */
export interface Crumb {
  /**
   * The segment's own name and nothing else: `proc`, then `sys`, then `debug`.
   * The slashes belong to neither of the steps they sit between, so they are
   * drawn between them rather than folded into one — see {@link ProcPath}.
   */
  name: string;
  /**
   * Where it goes, or null for the last one — which is where the reader
   * already is, and so is not a link.
   */
  url: string | null;
}

/**
 * The trail for the **admin page**, which is the one page here whose URL is not
 * a host path: it lives in the app's own directory rather than in `/proc`, at
 * `/proc/0/admin`, so the trail spells that.
 *
 * Only the first step is a place. `proc` is the base, and leads back to the
 * listing everything here comes out of, the way it does on every other page.
 * `0` is a directory of *this build* — see `ASSET_DIR` in `src/api/paths.ts`,
 * which is named for a segment `/proc` can never hold — so nothing lists it and
 * it is not a link, and `admin` is where the reader is standing.
 *
 * The page keeps its `.html` in the URL it is actually served at; the trail
 * names it as the other pages are published, since it reads as the path rather
 * than as a file name. See {@link crumbsFor}, which does the same for the pages
 * that do name a host path.
 */
export function adminCrumbs(base: string): Crumb[] {
  return [
    { name: HOST_ROOT.replace(/^\//, ''), url: `${basePath(base)}/` },
    { name: ASSET_DIR, url: null },
    { name: 'admin', url: null },
  ];
}

/**
 * A host path broken into the steps above it, so a page can offer the way back
 * up: `/proc/sys/debug/exception-trace` gives `proc`, `sys` and `debug` to
 * click, then `exception-trace` where the reader is standing.
 *
 * Every step above the last is a **directory**, and a directory's URL is its
 * path below the base with a trailing slash — the same URL the listing links
 * its own entries at, and the slash is what makes a relative link from there
 * resolve inside the directory rather than beside it. `proc` itself is the
 * base, which is the one URL naming no path and lands on the listing of it.
 *
 * The links are **absolute from the base**. A page can be at any depth —
 * `/12282/status` is two segments down — so a relative link would climb from
 * wherever the reader happens to be rather than from the root.
 *
 * A path that is not under `/proc` is still broken into its steps, so the trail
 * reads as the path, but none of them is a link. Nothing builds such a path,
 * and {@link resolvePath} can refuse one — a way into a path this app would not
 * read is not worth offering.
 */
export function crumbsFor(path: string, base: string): Crumb[] {
  const prefix = basePath(base);
  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') return [{ name: path, url: null }];

  const segments = trimmed.split('/');
  const below = path === HOST_ROOT || path.startsWith(`${HOST_ROOT}/`);

  return segments.map((name, index) => ({
    name,
    url:
      // The last step is where the reader is, so it goes nowhere — and neither
      // does any step of a path this app would not read.
      !below || index === segments.length - 1
        ? null
        : // `/proc` is the base itself; everything below it is a directory,
          // linked with the trailing slash the listing links it with.
          index === 0
          ? `${prefix}/`
          : `${prefix}/${segments.slice(1, index + 1).join('/')}/`,
  }));
}

/**
 * The `/proc` entry the page at this URL is about, for the two pages that are
 * about no entry in particular — by the same rule: **the URL is the path**.
 * `<base>/sys/` is `/proc/sys`, `<base>/12/net/` is `/proc/12/net`,
 * `<base>/kmsg` is `/proc/kmsg`.
 *
 * Those two are the fallbacks: the listing page for a directory this app has
 * no page for, and the raw page for a file it has no parser for. Neither
 * declares a path or takes a parameter, so the URL is all there is to go on —
 * which is why this takes no {@link Page}. Whether the entry is a directory or
 * a file is not decided here either: the two pages differ in what they do with
 * what comes back, and the backend is what knows which it is.
 *
 * A trailing slash is dropped. It is what makes a listing's relative links
 * resolve inside the directory rather than beside it, and says nothing about
 * the path.
 *
 * Unlike {@link resolvePath} this keeps a `.html` the URL spells, because
 * neither page has a second spelling for it to be: they are published at no URL
 * of their own, so nothing links to `dir.html` or `raw.html` and a URL that
 * names one is naming an entry — `<base>/12/dir.html` is `/proc/12/dir.html`,
 * and the backend answers for whether there is anything there.
 *
 * What the app is prepared to ask for is {@link isReadablePath}, as everywhere
 * else; a URL naming anything else is refused rather than sent.
 */
export function resolveEntry(pathname: string, base: string): Resolution {
  const route = routeIn(pathname, base);
  // The base is the one URL naming no path, and what it names instead is
  // `/proc` itself — which is `index.html`'s page, but the rule holds here too.
  if (route === '') return { path: HOST_ROOT, refused: null };

  const candidate = `${HOST_ROOT}/${route}`;

  return isReadablePath(candidate)
    ? { path: candidate, refused: null }
    : { path: null, refused: candidate.slice(0, PATH_MAX) };
}

/**
 * A path as a regular expression fragment, for matching against it. A
 * placeholder matches one path segment.
 */
function patternFor(path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The escape above has quoted the braces, so match them as written.
  return escaped.replace(/\\\{\w+\\\}/, '[^/]+');
}

/** The page's host path as a pattern, for deciding which page reads a file. */
export function pathPattern(page: Page): string {
  return patternFor(page.path);
}


export const PAGES: Page[] = [
  { path: '/proc/cpuinfo', document: 'cpuinfo.html' },
  { path: '/proc/mounts', document: 'mounts.html' },
  { path: '/proc/diskstats', document: 'diskstats.html' },
  { path: '/proc/version', document: 'version.html' },
  { path: '/proc/stat', document: 'stat.html' },
  { path: '/proc/crypto', document: 'crypto.html' },
  { path: '/proc/devices', document: 'devices.html' },
  { path: '/proc/cmdline', document: 'cmdline.html' },
  { path: '/proc/slabinfo', document: 'slabinfo.html' },
  { path: '/proc/interrupts', document: 'interrupts.html' },
  { path: '/proc/modules', document: 'modules.html' },
  { path: '/proc/schedstat', document: 'schedstat.html' },
  { path: '/proc/partitions', document: 'partitions.html' },
  { path: '/proc/bootconfig', document: 'bootconfig.html' },
  { path: '/proc/buddyinfo', document: 'buddyinfo.html' },
  { path: '/proc/cgroups', document: 'cgroups.html' },
  { path: '/proc/consoles', document: 'consoles.html' },
  { path: '/proc/dma', document: 'dma.html' },
  { path: '/proc/execdomains', document: 'execdomains.html' },
  { path: '/proc/fb', document: 'fb.html' },
  { path: '/proc/filesystems', document: 'filesystems.html' },
  { path: '/proc/iomem', document: 'iomem.html' },
  { path: '/proc/ioports', document: 'ioports.html' },
  { path: '/proc/kallsyms', document: 'kallsyms.html' },
  { path: '/proc/keys', document: 'keys.html' },
  { path: '/proc/key-users', document: 'key-users.html' },
  { path: '/proc/latency_stats', document: 'latency_stats.html' },
  { path: '/proc/loadavg', document: 'loadavg.html' },
  { path: '/proc/locks', document: 'locks.html' },
  { path: '/proc/mdstat', document: 'mdstat.html' },
  { path: '/proc/meminfo', document: 'meminfo.html' },
  { path: '/proc/misc', document: 'misc.html' },
  { path: '/proc/pagetypeinfo', document: 'pagetypeinfo.html' },
  { path: '/proc/softirqs', document: 'softirqs.html' },
  { path: '/proc/swaps', document: 'swaps.html' },
  { path: '/proc/timer_list', document: 'timer_list.html' },
  { path: '/proc/uptime', document: 'uptime.html' },
  { path: '/proc/version_signature', document: 'version_signature.html' },
  { path: '/proc/vmallocinfo', document: 'vmallocinfo.html' },
  { path: '/proc/vmstat', document: 'vmstat.html' },
  { path: '/proc/zoneinfo', document: 'zoneinfo.html' },
  // The one file here no ordinary Linux has: a kernel built with
  // `CONFIG_CPU_FREQ_TIMES` — an Android one, in practice — counts CPU time per
  // uid at each clock frequency, and this is where it prints the matrix. Only
  // the `raspberry-pi` capture carries one, as the one machine here whose
  // kernel has the accounting patched in; on the other four the page reports
  // the 404 the backend gives it, the way `driver/rtc` does on a board with no
  // clock.
  { path: '/proc/uid_time_in_state', document: 'uid_time_in_state.html' },
  // And the other file here a stock kernel does not have: `/proc/gpu_load` is
  // the Mali driver's own, a device line and a row per context something has
  // the GPU open with. The `raspberry-pi` capture carries one beside its
  // `uid_time_in_state`; nowhere else has either.
  { path: '/proc/gpu_load', document: 'gpu_load.html' },
  // And its other half: the same driver's memory accounting, a row per process
  // holding pages on the GPU rather than per context holding it open. On the
  // same capture, and nowhere else, for the same reason.
  { path: '/proc/gpu_memory', document: 'gpu_memory.html' },
  // The third of the per-uid files an Android kernel adds, and the one that is
  // not at the top of `/proc`: `uid_sys_stats` puts its I/O accounting in a
  // directory of its own, so the document is in one too. Same capture as the
  // two above, and nowhere else.
  { path: '/proc/uid_io/stats', document: 'uid_io/stats.html' },
  // The one page whose file is not at the top of `/proc`. Nothing special
  // follows from that: the URL is the path, so it is served at `tty/drivers`
  // and its document sits in a `tty/` directory to match.
  { path: '/proc/tty/drivers', document: 'tty/drivers.html' },
  // The disciplines a tty driver above can be switched onto, which is the other
  // half of the same story.
  { path: '/proc/tty/ldiscs', document: 'tty/ldiscs.html' },
  // The one file at the top of `/proc/irq`, whose other entries are a directory
  // per interrupt line. It is the mask a *new* interrupt is given, so it sits
  // above the numbered directories in the same way it does in the kernel:
  // `/proc/irq/7/smp_affinity` is what line 7 ended up with.
  { path: '/proc/irq/default_smp_affinity', document: 'irq/default_smp_affinity.html' },
  // The hardware clock, under a directory whose other entries belong to
  // whichever drivers registered one. Only the machines that have an RTC the
  // kernel booted from have this file at all — a Raspberry Pi 4 has no clock,
  // and the page reports the 404 the backend gives it.
  { path: '/proc/driver/rtc', document: 'driver/rtc.html' },
  // The System V shared memory segments of the reader's IPC namespace, in the
  // directory it shares with `msg` and `sem` — the other two IPC objects, which
  // this app has no page for yet. Nothing about a segment belongs to a process:
  // one outlives every process that ever attached it, which is what the page is
  // about.
  { path: '/proc/sysvipc/shm', document: 'sysvipc/shm.html' },
  // The semaphore sets beside them, which is the same directory, the same
  // `kern_ipc_perm` fields and a different story: this one prints no pid at all,
  // and none of the values the sets are keeping.
  { path: '/proc/sysvipc/sem', document: 'sysvipc/sem.html' },
  // And the third of them, which completes the directory: the one IPC file whose
  // numbers are live rather than settled at creation, since a queue's contents
  // are what it prints.
  { path: '/proc/sysvipc/msg', document: 'sysvipc/msg.html' },
  // The one entry of `/proc/asound` that says nothing about sound: the directory
  // is there because the `snd` core is loaded, and this file in it prints the
  // kernel release rather than any version of ALSA's. Everything else under
  // there belongs to the cards, of which a machine may have none.
  { path: '/proc/asound/version', document: 'asound/version.html' },
  // Beside it, the timers that same core registered — the kernel's own among
  // them, so the file says what the machine's tick rate is as well as what each
  // card and stream is being clocked by.
  { path: '/proc/asound/timers', document: 'asound/timers.html' },
  // And the devices those timers are attached to: what the machine can play
  // through and record from, which is the directory's answer to what hardware
  // is here rather than what software is loaded.
  { path: '/proc/asound/pcm', document: 'asound/pcm.html' },
  // And which module put each of those cards there, which is the fourth entry
  // of the directory the sound core makes for itself — the three before it are
  // about what ALSA is and has, and this one about where it came from.
  { path: '/proc/asound/modules', document: 'asound/modules.html' },
  // And what all of that amounts to in `/dev`: a line per character device the
  // sound core registered, which is the last of the directory's own files and
  // the one that says what a program actually opens.
  { path: '/proc/asound/devices', document: 'asound/devices.html' },
  // And the cards themselves, which is where the directory's other files get
  // the number they all count from — the one file here whose record is two
  // lines, and the one that says in words when there is nothing to list.
  { path: '/proc/asound/cards', document: 'asound/cards.html' },
  // The one file of `/proc/scsi` that is not a driver's own: the directory holds
  // a subdirectory per registered driver, plus `device_info` and `sg/`, and this
  // is the list of everything the midlayer has attached, whichever driver put it
  // there. It exists only where the kernel was built with CONFIG_SCSI_PROC_FS,
  // and a machine whose only disk is NVMe has it and nothing in it — which is
  // half of what the page is about.
  { path: '/proc/scsi/scsi', document: 'scsi/scsi.html' },
  // And the other file of that directory that is not a driver's own: the
  // midlayer's blacklist, which is the one page here whose contents say nothing
  // about the machine reading it — the table is compiled into the kernel, so
  // the same kernel prints the same list wherever it runs. It is writable, and
  // the page says what writing to it means.
  { path: '/proc/scsi/device_info', document: 'scsi/device_info.html' },
  // And one directory deeper: the generic SCSI driver's own corner of
  // `/proc/scsi`, of which this is the file that says what the driver is. Two
  // directories below `/proc`, so the document is nested twice — the URL is the
  // path here as everywhere.
  { path: '/proc/scsi/sg/version', document: 'scsi/sg/version.html' },
  // And what that driver has: a line of nine numbers per device it gave a node
  // to, with no header of its own — `device_hdr` beside it holds the names —
  // and no column naming the node, since the line's position is what does.
  { path: '/proc/scsi/sg/devices', document: 'scsi/sg/devices.html' },
  // And the names of those same devices, which the driver prints in a file of
  // their own: one table split across two files, joined only by the position of
  // a line — this one holding what each device *is* where the other holds what
  // it is doing.
  { path: '/proc/scsi/sg/device_strs', document: 'scsi/sg/device_strs.html' },
  // And the header those numbers go under, which is a file of its own because
  // the file it belongs to has none: nine names, printed as a string literal, so
  // it is the one entry here whose contents are the same on every machine that
  // has it at all.
  { path: '/proc/scsi/sg/device_hdr', document: 'scsi/sg/device_hdr.html' },
  // The one entry of that directory that is a *setting* rather than a report:
  // the size of the reserved buffer the next open of a /dev/sg* will get, which
  // is writable and says nothing about any descriptor already open.
  { path: '/proc/scsi/sg/def_reserved_size', document: 'scsi/sg/def_reserved_size.html' },
  // And the last of that directory: the only file in it that is nested, and the
  // only one about who is *using* the devices rather than what they are. A
  // device nothing has open prints nothing, so this file is usually its header
  // line alone — which is the first thing the page has to say.
  { path: '/proc/scsi/sg/debug', document: 'scsi/sg/debug.html' },
  // And the last entry of that directory, which completes it: the other setting
  // in there, and a *gate* rather than a switch — direct I/O happens only where
  // this permits it and the request asks for it, and neither half failing is
  // what makes it worth a page.
  { path: '/proc/scsi/sg/allow_dio', document: 'scsi/sg/allow_dio.html' },
  // The page for `/proc/sys/user`, where an entry is a *setting* rather than a
  // report: writable, and holding what the kernel will allow rather than what it
  // has done. All twelve of them are one mechanism — the `ucount` limits — so
  // they are one page as well as one parser and one view, and it differs per
  // file only in the facts `LIMITS` carries.
  //
  // **One document for the twelve**, the way `pid/smaps.html` is one document
  // for every process: the name is a placeholder the page takes from its own
  // URL, so `<base>/sys/user/max_ipc_namespaces` is served `sys/user/limit.html`
  // and reads `/proc/sys/user/max_ipc_namespaces` out of that same URL. Twelve
  // documents would have been twelve copies of one page, differing in the one
  // word the URL already says.
  //
  // Unlike a process, the values are known here — the kernel declares them in
  // one table and `LIMITS` carries it — so they are written down, and a name
  // that is not one of them is not this page's: it falls through to the raw
  // page like any other file with no parser here. See {@link answersPath}.
  {
    path: '/proc/sys/user/{limit}',
    document: 'sys/user/limit.html',
    parameter: {
      name: 'limit',
      // What the page reads at a URL naming no limit of its own. It is the
      // first of the table and the one the other eleven answer to: setting it
      // to 0 is what stops a user making any user namespace, and so any of the
      // namespaces the rest of these files bound.
      fallback: 'max_user_namespaces',
      values: LIMITS.map((limit) => limit.name),
    },
  },
  // And the same arrangement for `/proc/sys/vm`, the memory manager's control
  // panel: fifty files, one document, which takes the name from its own URL.
  // These are not one mechanism the way the twelve above are — they are fifty
  // settings that happen to be read one way, a line of one or a few fields —
  // and what differs is the row of facts `TUNABLES` carries: which mechanism,
  // what it sets, what it is counted in, and what its values mean.
  //
  // The names are written down here too, so a knob this app has no facts for is
  // not this page's: it is a file with nothing to say about it, and the raw
  // page shows the bytes. The set under there differs by kernel version and by
  // architecture, so that case is the ordinary one rather than the exception.
  {
    path: '/proc/sys/vm/{parameter}',
    document: 'sys/vm/parameter.html',
    parameter: {
      name: 'parameter',
      // What the page reads at a URL naming no parameter of its own: the knob
      // everybody has an opinion about, and the one entry of this directory
      // that every capture here carries.
      fallback: 'swappiness',
      values: TUNABLES.map((tunable) => tunable.name),
    },
  },
  // The cheap half of the pair below: every region of the address space and
  // nothing about what is in RAM. `smaps` is this file with the accounting
  // filled in, which is why both read a mapping line with one function.
  {
    path: '/proc/{pid}/maps',
    document: 'pid/maps.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  {
    path: '/proc/{pid}/smaps',
    document: 'pid/smaps.html',
    // What the page reads at the base, the one URL naming no path: the
    // process doing the reading, which through this app's backend is whatever
    // it runs as. Every other URL says which process for itself.
    parameter: { name: 'pid', fallback: 'self' },
  },
  {
    path: '/proc/{pid}/limits',
    document: 'pid/limits.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // The process's own argument vector. `/proc/cmdline` above is the kernel's
  // boot line — a different file with a different page.
  {
    path: '/proc/{pid}/cmdline',
    document: 'pid/cmdline.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // And the other half of what `execve` was handed: the environment, written
  // the same way and read under a different mode — 0444 for the arguments,
  // 0400 for this, which is the whole reason a credential goes in a variable.
  {
    path: '/proc/{pid}/environ',
    document: 'pid/environ.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // And what would be *kept* of that memory if the process died on a signal:
  // nine bits deciding which mappings go into the core, inherited by everything
  // a process starts and read hex where a write to it is parsed base 0.
  {
    path: '/proc/{pid}/coredump_filter',
    document: 'pid/coredump_filter.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // What that process has read and written — counted twice, at two layers, which
  // is the one thing the file is misread for. 0400 and ptrace-checked like
  // `environ`, because byte counts leak what was typed at a terminal.
  {
    path: '/proc/{pid}/io',
    document: 'pid/io.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // And how long it has run at each clock frequency, which is the per-task half
  // of `/proc/uid_time_in_state` — one Android driver, and the half whose layout
  // names the policy boundaries the uid file leaves a reader to infer.
  {
    path: '/proc/{pid}/time_in_state',
    document: 'pid/time_in_state.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  {
    path: '/proc/{pid}/syscall',
    document: 'pid/syscall.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // The process's own accounting line. `/proc/stat` above is the machine's CPU
  // totals — a different file with a different page.
  // The cheap view of the same memory `smaps` walks page tables for: seven
  // counts in pages, two of which are constants the kernel froze at zero.
  // Not the `schedstat` page above: that one reads `/proc/schedstat`, the
  // machine's per-CPU counters. This is one task's three — time on a CPU, time
  // queued for one, and how many turns it took.
  {
    path: '/proc/{pid}/schedstat',
    document: 'pid/schedstat.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  {
    path: '/proc/{pid}/statm',
    document: 'pid/statm.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  {
    path: '/proc/{pid}/stat',
    document: 'pid/stat.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  {
    path: '/proc/{pid}/comm',
    document: 'pid/comm.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  {
    path: '/proc/{pid}/uid_map',
    document: 'pid/uid_map.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // And the file that rule is about: one flag bit, one of two words, and the
  // one of three conditions `setgroups()` needs that a reader can see.
  {
    path: '/proc/{pid}/setgroups',
    document: 'pid/setgroups.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // The group half of the same namespace. Same three columns as `uid_map`, and
  // one rule that file has not: since 3.19 an unprivileged process has to write
  // `deny` to `/proc/<pid>/setgroups` before the kernel will take this one.
  {
    path: '/proc/{pid}/gid_map',
    document: 'pid/gid_map.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // The whole chain `wchan` names one frame of, and `syscall` the entry to —
  // all three off one unwind. Brackets frozen at zero since printing the real
  // return address defeated KASLR.
  {
    path: '/proc/{pid}/stack',
    document: 'pid/stack.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  {
    path: '/proc/{pid}/wchan',
    document: 'pid/wchan.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // Not the `mounts` page above: that one reads `/proc/mounts`, which is a
  // link to `self/mounts`. This one reads any process's, which in a mount
  // namespace of its own is a different table — same file, same format.
  {
    path: '/proc/{pid}/mounts',
    document: 'pid/mounts.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // Every mount this process can see, with the tree and the propagation that
  // the fstab shape above leaves out.
  {
    path: '/proc/{pid}/mountinfo',
    document: 'pid/mountinfo.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // The audit session this process belongs to, which is not the session
  // `setsid()` makes — that one is a pid, in field 6 of the accounting line.
  {
    path: '/proc/{pid}/sessionid',
    document: 'pid/sessionid.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // Everything the accounting line above holds, and a good deal it cannot say.
  {
    path: '/proc/{pid}/status',
    document: 'pid/status.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // Which cgroup this process is in, on every hierarchy the machine has. Not
  // the `cgroups` page above: that one is the machine's table of controllers,
  // and this is one process's place in them.
  {
    path: '/proc/{pid}/cgroup',
    document: 'pid/cgroup.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // The one page whose file is not text: pairs of native words, read as the
  // bytes they are. See `src/lib/auxv.ts` and `ProcBinaryPage`.
  {
    path: '/proc/{pid}/auxv',
    document: 'pid/auxv.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // The scheduling group this process shares with the rest of its session,
  // which is a thing about the *session* read through one of its processes —
  // so two pids can answer identically, and that is the point of reading it.
  {
    path: '/proc/{pid}/autogroup',
    document: 'pid/autogroup.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // The first page for a file below `/proc/<pid>/`, so its document is nested
  // to match — the URL is the path here as everywhere. What it reads belongs to
  // the process's *network namespace* rather than to the process: `/proc/net`
  // is a link to `self/net`, and naming another pid is how the table of the
  // namespace that one is in gets read.
  {
    path: '/proc/{pid}/net/arp',
    document: 'pid/net/arp.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // Beside it, and the same lesson from the other end: this one exists *only*
  // in the initial network namespace, so naming a process in one of its own
  // gets a 404 rather than an empty table.
  {
    path: '/proc/{pid}/net/connector',
    document: 'pid/net/connector.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
  // Every interface in that namespace and what has gone through it. Unlike the
  // connector this one is created per namespace, so every process has it —
  // holding a different table.
  {
    path: '/proc/{pid}/net/dev',
    document: 'pid/net/dev.html',
    parameter: { name: 'pid', fallback: 'self' },
  },
];
