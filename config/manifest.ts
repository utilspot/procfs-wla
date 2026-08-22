import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_ROOT } from '../src/api/paths';
import { DIRECTORY_PAGES, PAGES, directoryPageUrl, pageUrl, type Page } from '../src/pages';
import { ADMIN_DOCUMENT, ADMIN_URL, ASIDE_DOCUMENTS, ASSET_DIR, DOCUMENT } from './document';

/**
 * Writes `dist/manifest.json`, which answers two different questions.
 *
 * **`files`** is the public URL of every emitted file, the file it corresponds
 * to, and the content type it should be served as. Filenames carry a content
 * hash that changes on every rebuild, so a server that injects tags or preloads
 * assets cannot hard-code them. Vite's own `build.manifest` maps sources to
 * outputs but records no URLs — it does not apply `base` — so this records the
 * resolved URLs instead.
 *
 * **`entries`** is what this build *is*, for a host that lists it beside other
 * apps rather than serving it: what to call it in a list, the version it is at,
 * a line about what it does, the URL to open it at, and an icon and a
 * screenshot per colour scheme. What the *project* is called sits above them
 * all, at the root — one build is one project — see {@link MANIFEST_NAME}. The whole build
 * is one app, so there is one entry — and everything it points at is taken from
 * the file list below it, so an entry cannot advertise a URL this build does
 * not answer.
 */

/** Content type to serve each emitted file as, keyed by extension. */
export const MIME_TYPES: Record<string, string> = {
  html: 'text/html',
  // RFC 9239 supersedes application/javascript.
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  map: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  txt: 'text/plain',
  wasm: 'application/wasm',
};

export function contentTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return MIME_TYPES[fileName.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

export const MANIFEST_FILE = 'manifest.json';

/**
 * The public URL of an emitted file.
 *
 * A page's URL drops the `.html`, so that the viewer's paths read like the
 * `/proc` entries they mirror — `/pid/smaps`, not `/pid/smaps.html`. The `file`
 * field still names what is on disk; only the URL is shortened.
 *
 * Everything that is *not* a page — the scripts, the stylesheets, whatever else
 * a build emits — is published under {@link ASSET_DIR} instead, so the app's
 * own files sit in a corner of the URL space that `/proc` can never reach into:
 * `cpuinfo-CMwOulyt.js` is served at `/0/cpuinfo-CMwOulyt.js`. Here too the
 * `file` field names what is on disk, which has not moved; a manifest is a map
 * from URL to file, and this is a place the two differ on purpose.
 *
 * {@link DOCUMENT} is published at the base itself, since that is where a
 * request naming no page lands and what the page is a listing of. `/proc/index`
 * would be a URL for the same file that nothing sends anybody to.
 *
 * A page for a **directory** is published at that directory's URL, trailing
 * slash and all: `sys/user/index.html` answers at `/proc/sys/user/`. The slash
 * is what the listing links every directory with and what makes this page's own
 * relative links resolve inside it, so it is part of the URL rather than
 * decoration on it.
 *
 * A page whose URL names the file it reads is published at the URL it actually
 * answers rather than at its own file name. Where the values are not knowable
 * here — which processes a machine is running — that URL is a **pattern**,
 * `/proc/{pid}/smaps`, where `{pid}` stands for exactly one path segment: the
 * page reads the file its own URL names, so one document serves every process,
 * and `/proc/12282/smaps` and `/proc/self/smaps` are both `pid/smaps.html`. A
 * server cannot see that from the file listing, so the URL says it; the dev and
 * preview servers route by the same data — see `documentForUrl` in
 * `config/document.ts`.
 *
 * Where the values *are* known — the twelve names of `/proc/sys/user`, which
 * the kernel declares in one table — there is no pattern and no rule to follow:
 * the page is published at each of the twelve URLs it answers, all naming the
 * one file. See {@link urlsFor}, which is what the manifest is built from; this
 * gives the first of them, since a file is published somewhere whatever else is
 * asked of it.
 *
 * The {@link ASIDE_DOCUMENTS} are not published at all — see
 * {@link buildManifest}.
 */
export function urlFor(base: string, file: string): string {
  if (file === DOCUMENT) return base;

  // The admin page is entered directly rather than reached as one of the
  // `/proc` paths the viewer mirrors, so it goes under the app's own directory
  // and keeps its extension — see ADMIN_URL in `config/document.ts`.
  if (file === ADMIN_DOCUMENT) return `${base}${ADMIN_URL}`;

  // A page is served at a URL of its own; everything a page loads is served
  // from one directory, wherever in the output it happens to sit.
  if (contentTypeFor(file) !== MIME_TYPES.html) return `${base}${ASSET_DIR}/${file}`;

  // A directory's page is published where the directory is, slash and all.
  const directory = DIRECTORY_PAGES.find((candidate) => candidate.document === file);
  if (directory !== undefined) return `${base}${directoryPageUrl(directory)}`;

  const page = pageBuiltAs(file);
  if (page?.parameter !== undefined) {
    const { values } = page.parameter;

    // The host path is where the placeholder is written down; the page's URL is
    // that path with `/proc` taken off, since the app is not served under it —
    // and where the values are known, the first of the URLs it answers instead.
    return values === undefined
      ? base + page.path.slice(`${HOST_ROOT}/`.length)
      : `${base}${pageUrl(page, values[0]!)}`;
  }

  return base + file.replace(/\.html$/, '');
}

/** The page emitted as this document, for a document that is a page at all. */
function pageBuiltAs(file: string): Page | undefined {
  return PAGES.find((candidate) => candidate.document === file);
}

/**
 * Every URL an emitted file answers, which for all but one file is the one
 * {@link urlFor} gives.
 *
 * The exception is a page whose values are **written down** — `sys/user/limit.html`,
 * the one page behind the twelve `ucount` limits. Those twelve names are the
 * whole set: the kernel declares them together in `user_table` and this app
 * carries them in `LIMITS`, so the manifest can say what the page answers
 * instead of leaving a pattern for a server to apply. Twelve rows, one file,
 * and no rule to implement — and a name that is not one of the twelve is not
 * claimed by anybody here, so it falls through to whatever a server does with a
 * `/proc` path it has no entry for: the listing page for a directory, the raw
 * page for a file, and a 404 for nothing.
 *
 * A process page keeps its pattern. Which processes exist is the machine's
 * answer rather than this build's, so there is no set to write down and the
 * `{pid}` rule stands.
 */
export function urlsFor(base: string, file: string): string[] {
  const page = pageBuiltAs(file);
  const values = page?.parameter?.values;

  if (page === undefined || values === undefined) return [urlFor(base, file)];

  return values.map((value) => `${base}${pageUrl(page, value)}`);
}


/**
 * Where the project's identity is written down, and the only place: the
 * manifest advertises what this file says rather than a copy of it.
 *
 * Resolved against this module rather than the working directory, since the
 * build that writes the manifest can be started from anywhere.
 */
const PACKAGE_FILE = fileURLToPath(new URL('../package.json', import.meta.url));

/** The project's own `package.json`, parsed once for the fields below. */
const PACKAGE = JSON.parse(readFileSync(PACKAGE_FILE, 'utf8')) as Record<string, unknown>;

/**
 * One field of it, which has to be there: a manifest advertising an empty name
 * or a version this build is not would be worse than one advertising none, and
 * a build is the moment to say so.
 */
function packageField(field: string): string {
  const value = PACKAGE[field];

  if (typeof value !== 'string' || value === '') {
    throw new Error(`no ${field} in ${PACKAGE_FILE}, and the manifest advertises one`);
  }

  return value;
}

/**
 * A field that may simply not be there, which is a different thing from one
 * that is empty: both come back undefined, and what the manifest does with
 * that is leave the field out rather than publish a blank.
 */
export function optionalPackageField(
  pkg: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = pkg[field];
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The version this build is, for a host that has listed it before: `title`
 * names the app and never moves, so this is what says whether what it is
 * looking at is new.
 *
 * **Read from `package.json` rather than written down here.** It is where the
 * project's version already is and where `npm version` changes it, and a
 * manifest advertising a version this build is not would be worse than one
 * advertising none. (`CMakeLists.txt` carries the same number for the C module
 * beside this app; the two are spelled separately because they are built
 * separately, and only this one reaches the manifest.)
 */
export const MANIFEST_VERSION = packageField('version');

/**
 * What the project calls itself — `procfs-wla`, the `name` in `package.json`.
 *
 * The **identifier**, where {@link MANIFEST_TITLE} is a display name: one is
 * the token a package registry, a lockfile and this repository already know the
 * build by, and the other is prose a host prints in a list. Neither substitutes
 * for the other, which is why both are published — but they are published in
 * different places, since they answer for different things: this one names the
 * project the whole file came out of and sits at its root, and the title names
 * an app inside it.
 *
 * Read from `package.json` like the version, so renaming the project there
 * renames it here on the next build and nowhere has to be told twice.
 */
export const MANIFEST_NAME = packageField('name');

/**
 * The line under the name, wherever a host shows one: what the app *is*, in a
 * sentence, since that is what sits beside other apps' sentences in a list.
 *
 * The `description` in `package.json`, like the name and the version — where
 * npm already keeps a project's one-line summary, and where a registry, `npm
 * view` and a repository page all read it from. There is nothing to keep in
 * step because there is only the one copy.
 *
 * Unlike those two it is **optional**. A project without a description has
 * nothing to say in that line, and the honest manifest is one with no
 * `description` field rather than one advertising an empty string — a host
 * reading it can then fall back to whatever it shows for an app that gave none,
 * which it cannot do for a blank. See {@link descriptionOf}.
 */
export const MANIFEST_DESCRIPTION = optionalPackageField(PACKAGE, 'description');

/**
 * What the app is called, in a host's list of the apps it serves.
 *
 * It names the directory the whole of it is about without *being* that
 * directory: a bare `/proc` beside other apps' names reads as a path rather
 * than as a name, and this app is a way of reading what is in there rather than
 * the thing itself.
 *
 * A host may key on it, so it stays put: a changed title is a different app to
 * whatever was listing the old one.
 */
export const MANIFEST_TITLE = 'Inside /proc';

/** The two looks a page has, since every one of them follows the reader's. */
export type ColorScheme = 'light' | 'dark';

export const COLOR_SCHEMES: readonly ColorScheme[] = ['light', 'dark'];

/**
 * The icon per colour scheme — the same file for both, deliberately.
 *
 * Support for `prefers-color-scheme` inside an SVG favicon depends on which
 * browser is asking, so this one carries its own background and reads the same
 * against light and dark chrome; see `src/pages/favicon.svg`. There is one
 * image, and it is offered for both.
 */
export const ICONS: Record<ColorScheme, string> = {
  light: 'favicon.svg',
  dark: 'favicon.svg',
};

/**
 * The picture of the app per colour scheme, and here the two really are two
 * files: a page takes its colours from the reader's own setting, so a single
 * shot would show half the readers a window they will never see.
 */
export const SCREENSHOTS: Record<ColorScheme, string> = {
  light: 'screenshot-light.png',
  dark: 'screenshot-dark.png',
};

/** An image the entry advertises, at the URL it is published at. */
export interface ManifestImage {
  url: string;
  colorScheme: ColorScheme;
}

/**
 * What this build *is*, for a host listing it beside other apps: its name, what
 * it does, the URL to open it at, and something to show it with.
 *
 * One app, so one entry. The `files` below are the app's parts; this is the app.
 */
export interface ManifestEntry {
  title: string;
  /** The project's version, from `package.json` — see {@link MANIFEST_VERSION}. */
  version: string;
  /**
   * What the app does in a sentence — absent entirely when `package.json` gives
   * no description. See {@link MANIFEST_DESCRIPTION}.
   */
  description?: string;
  main: string;
  icons: ManifestImage[];
  screenshots: ManifestImage[];
}

/** One emitted file: the URL it answers, the file behind it, how to serve it. */
export interface ManifestFile {
  url: string;
  file: string;
  type: string;
}

/**
 * The file, in the order it is written: what this is the build of, what the
 * URLs here are relative to, then what this build is, then what it is made of.
 */
export interface Manifest {
  /**
   * What the project calls itself — see {@link MANIFEST_NAME}.
   *
   * The **file's** subject rather than an entry's field: one build is one
   * project, however many entries it comes to advertise, so the name belongs to
   * the whole of it. An entry names the app a host would list; this names the
   * thing that produced the file.
   */
  name: string;
  base: string;
  entries: ManifestEntry[];
  files: ManifestFile[];
}

/**
 * The images of one kind that this build actually emitted, at the URLs the
 * `files` list publishes them at.
 *
 * Taken from the output rather than written down twice: an entry pointing at a
 * picture the build did not produce would be a link to a 404, and every URL
 * here comes out of {@link urlFor} exactly as the matching `files` row does.
 */
function imagesFor(
  base: string,
  files: readonly string[],
  byScheme: Record<ColorScheme, string>,
): ManifestImage[] {
  return COLOR_SCHEMES.filter((scheme) => files.includes(byScheme[scheme])).map((scheme) => ({
    url: urlFor(base, byScheme[scheme]),
    colorScheme: scheme,
  }));
}

/**
 * The `description` an entry carries, or **no field at all** when there is
 * none: a key whose value is `null`, `''` or `undefined` is a claim that the
 * app's blurb is blank, and this build would rather say nothing.
 *
 * Spread into the entry rather than assigned, which is what lets the key be
 * missing instead of present-and-empty — `JSON.stringify` drops an `undefined`
 * value, but only after the key has been written into the object, and the two
 * differ to anything reading the object itself.
 */
export function descriptionOf(description: string | undefined): { description?: string } {
  return description === undefined ? {} : { description };
}

/**
 * The one entry: the viewer itself, opened at the base — which is the listing of
 * `/proc`, the directory everything else here comes out of.
 */
export function entryFor(base: string, files: readonly string[]): ManifestEntry {
  return {
    title: MANIFEST_TITLE,
    version: MANIFEST_VERSION,
    ...descriptionOf(MANIFEST_DESCRIPTION),
    main: urlFor(base, DOCUMENT),
    icons: imagesFor(base, files, ICONS),
    screenshots: imagesFor(base, files, SCREENSHOTS),
  };
}

/**
 * The manifest maps a URL to the file to answer it with, and the two pages in
 * {@link ASIDE_DOCUMENTS} answer no URL of their own: `dir.html` is the page
 * for *any* directory below the base — `/proc/sys/`, `/proc/12282/net/` — and
 * `raw.html` the page for any file with no parser here, each showing whichever
 * entry its URL names. That is a routing rule rather than an entry, so both are
 * left out of the manifest entirely rather than advertised at some URL nothing
 * links to. What a server has no entry for, it looks up under `/proc` and hands
 * to whichever of the two the answer calls for — see `documentForPath` in
 * `config/document.ts`, which is that rule for the dev and preview servers.
 *
 * The scripts and stylesheets they load stay listed like any other file: those
 * names carry a content hash, so the manifest is where they are found.
 */
export function buildManifest(base: string, files: readonly string[]): Manifest {
  return {
    name: MANIFEST_NAME,
    base,
    entries: [entryFor(base, files)],
    files: files
      .filter((file) => !ASIDE_DOCUMENTS.includes(file))
      .flatMap((file) =>
        // One row per URL the file answers, which is one row for all but the
        // page behind the twelve `ucount` limits — see `urlsFor`.
        urlsFor(base, file).map((url) => ({
          url,
          file,
          type: contentTypeFor(file),
        })),
      )
      // By file, and by URL within a file, so a build's manifest reads the same
      // way twice running whatever order the directory came back in.
      .sort((a, b) => a.file.localeCompare(b.file) || a.url.localeCompare(b.url)),
  };
}

/**
 * Every file under `dir`, as paths relative to it.
 *
 * Most documents sit at the top level, but a page for a file that belongs to a
 * process is nested — `pid/smaps.html` — and Vite lays the build out by each
 * document's path relative to its root. A listing that stopped at the top
 * level would leave such a page out of the manifest entirely: built, served,
 * and invisible to whatever reads this file to find it.
 */
function filesUnder(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    // Always posix separators: these become URLs.
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;

    if (entry.isDirectory()) return filesUnder(join(dir, entry.name), relative);
    if (!entry.isFile() || relative === MANIFEST_FILE) return [];

    return [relative];
  });
}

/**
 * Writes `manifest.json` describing what is in `outDir`.
 *
 * The listing is taken from disk rather than from one Rollup bundle, because
 * each page is built in its own pass — see `scripts/build.ts` — so no single
 * bundle knows about all of them.
 */
export function writeManifest(outDir: string, base: string): Manifest {
  const files = filesUnder(outDir);

  const manifest = buildManifest(base, files);
  writeFileSync(join(outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}
