import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { announceAdmin } from './config/banner';
import { resolveBase } from './config/base-url';
import { resolveDebug } from './config/debug';
import { ADMIN_DOCUMENT, ASSET_DIR, DOCUMENTS, serveDocument } from './config/document';
import { repoUrl } from './config/repo';
import { commonStylesheet } from './config/stylesheet';
import { API_PREFIX } from './src/api/paths';

const TEST_SERVER = process.env.TEST_SERVER_URL ?? 'http://localhost:3001';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Path the app is served under, without its trailing slash: `/` gives `''`,
 * `--base-url=/procfs` gives `/procfs`. An absolute base (`https://cdn/proc/`)
 * puts the app on another origin, where this dev-server proxy plays no part.
 */
function pathPrefix(base: string): string {
  return base.startsWith('/') ? base.replace(/\/+$/, '') : '';
}

/**
 * The React app reads each host file from `<base-url>/0/api/file<name>`, e.g.
 * `/procfs/0/api/file/cpuinfo` for `/proc/cpuinfo`, and lists a directory under
 * `<base-url>/0/api/dir`; those requests are proxied to the mock filesystem
 * server, which serves them at the bare path, so the base is stripped back off
 * on the way. `vite preview` reads its own `preview.proxy`, so the same table is
 * used for both.
 *
 * **Everything under the API prefix goes to the backend**, not a list of the
 * paths the pages read. The mock server serves a whole captured `/proc` rather
 * than a set of files it was told about, so `dir.html` and `file.html` — the
 * pages for an entry with no page of its own — ask for paths no `PAGES` entry
 * names, and a table built from `PAGES` would leave exactly those unproxied.
 *
 * Matching a prefix is safe here because that prefix is `/0/api`, and `0/` is
 * the app's own directory: nothing Vite serves lives under it. See
 * `src/api/paths.ts`.
 *
 * `/fixtures` is what the debug-mode admin page reads and writes to switch the
 * machine the test server serves.
 */
function proxyTable(base: string) {
  const prefix = pathPrefix(base);
  const rewrite = (path: string): string => path.slice(prefix.length);
  const proxy = { target: TEST_SERVER, changeOrigin: true, rewrite };

  return {
    [`^${escapeRegExp(prefix + API_PREFIX)}(/.*)?$`]: proxy,
    [`${prefix}/fixtures`]: proxy,
  };
}

/** The project itself, which is no longer where Vite is rooted. */
const PROJECT_ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * The documents live in `src/pages/`, and Vite is rooted there rather than at
 * the project root.
 *
 * Vite lays `dist/` out by each document's path *relative to the root*, so
 * rooting it here is what keeps the build a flat drop-in directory and the
 * pages at `/cpuinfo.html` instead of `/src/pages/cpuinfo.html`. The cost is
 * that everything else Vite resolves against the root has to be pointed back
 * at the project: the output directory, the `.env` files and `public/`.
 */
const PAGES_ROOT = fileURLToPath(new URL('./src/pages', import.meta.url));

const entry = (document: string): string =>
  fileURLToPath(new URL(`./src/pages/${document}`, import.meta.url));

/**
 * Where a page's assets go, relative to `dist/`: the directory its document is
 * in, so `pid/smaps.html` puts its script and stylesheet in `pid/` beside
 * itself rather than at the top with everybody else's.
 *
 * `scripts/build.ts` builds one page per pass and names it in `APP_ENTRY`, so
 * each pass knows which document it is emitting for. Without that — the dev
 * server, or a build of every entry at once — there is no single answer, and
 * the top of `dist/` is where all but one of the pages belong anyway.
 */
const entryDir = (document: string | undefined): string => {
  const slash = document === undefined ? -1 : document.lastIndexOf('/');
  return slash === -1 ? '' : document!.slice(0, slash);
};

/**
 * The one icon every page links, which is emitted once for the whole build
 * rather than once per page — see `assetFileNames` below. The name is the file
 * in `src/pages/`, the file in `dist/`, and the last segment of the URL it is
 * served at, which is `<base>/0/favicon.svg`.
 */
const FAVICON = 'favicon.svg';

export default defineConfig(({ command }) => {
  // Debug mode adds the admin page. On by default while developing, off for a
  // build unless --debug is passed, so it never ships by accident.
  const debug = resolveDebug(command);
  // Public path the app is served from, e.g. `npm run dev --base-url=/procfs`.
  // The app reads the host files from under it, so the proxy has to match there.
  const base = resolveBase() ?? '/';
  const proxy = proxyTable(base);

  // Only when this config is the whole story. `scripts/build.ts` builds one
  // page per pass, loading this config once per page, and has already said
  // which mode it is building in — so announcing it again per pass would say
  // the same thing as many times as the app has pages. APP_ENTRY is how that
  // script marks its passes; without it this is a dev server, a preview, or a
  // one-shot `vite build`, where nobody else has mentioned it.
  if (process.env.APP_ENTRY === undefined) {
    console.log(
      debug
        ? `[procfs] debug mode ON — ${ADMIN_DOCUMENT} included`
        : `[procfs] debug mode off — no ${ADMIN_DOCUMENT}`,
    );
  }

  return {
    // A `--base-url` CLI argument arrives as `--base`, which overrides this;
    // scripts/vite.ts also puts it in APP_BASE_URL so `base` above agrees.
    base,
    // The footer every page carries links the source, and `homepage` in
    // package.json is where that URL is written down — read here rather than
    // copied into `src/`, since package.json is a Node file the browser has no
    // business fetching. Only the string crosses over. See config/repo.ts, and
    // `src/env.d.ts` for the declaration the app sees.
    define: {
      __REPO_URL__: JSON.stringify(repoUrl()),
    },
    // A document per page — mostly one per file it reads, and one for a set of
    // files that are one mechanism, as `sys/user/limit.html` is for the twelve
    // `ucount` limits — not one app behind a rewrite. Vite's default would serve `index.html` for every URL it does
    // not recognise, so a name with nothing behind it — `/kmsg`, or a mistyped
    // page — would answer 200 with the listing on it instead of saying there
    // is nothing there. The listing links at each entry's own name, so those
    // URLs are real requests and 404 is the honest answer to most of them.
    appType: 'mpa',
    root: PAGES_ROOT,
    // Both default to somewhere under the root, which is now src/pages. The
    // .env files and public/ belong to the project, so say so explicitly —
    // otherwise VITE_API_BASE_URL would quietly stop being read.
    envDir: PROJECT_ROOT,
    publicDir: fileURLToPath(new URL('./public', import.meta.url)),
    plugins: [
      react(),
      commonStylesheet(),
      serveDocument(debug, TEST_SERVER),
      announceAdmin(debug),
    ],
    experimental: {
      /*
       * What a page loads is served from `<base>/0/`, so the tags the build
       * writes into it have to say so — see ASSET_DIR in config/document.ts,
       * and `urlFor` in config/manifest.ts, which publishes the same URLs.
       *
       * Only the URL moves: `filename` is where the file sits in the output and
       * it stays there, which is what keeps the manifest's `file` field the
       * plain name it has always been. The dev server never gets here — nothing
       * is built — and the preview server maps the URL back to the file.
       */
      renderBuiltUrl(filename, { type }) {
        return type === 'asset' ? `${base}${ASSET_DIR}/${filename}` : undefined;
      },
    },
    build: {
      // Relative to the root, so spell it out: dist/ belongs to the project,
      // not to src/pages. scripts/build.ts passes its own absolute path.
      outDir: fileURLToPath(new URL('./dist', import.meta.url)),
      // Emit the JS and CSS beside the document instead of in an assets/
      // subfolder — including for a document that is itself in one, so a page
      // and everything it loads stay in the same directory.
      assetsDir: entryDir(process.env.APP_ENTRY),
      // The pages are cpuinfo.html and mounts.html, not Vite's default
      // index.html; admin.html joins them in debug mode. `npm run build` sets
      // APP_ENTRY to build one page per pass, so no page ends up depending on
      // a chunk shared with another — see scripts/build.ts.
      rollupOptions: {
        input: (process.env.APP_ENTRY !== undefined
          ? [process.env.APP_ENTRY]
          : debug
            ? [...DOCUMENTS, ADMIN_DOCUMENT]
            : DOCUMENTS
        ).map(entry),
        output: {
          /*
           * One favicon for the whole build, at `dist/favicon.svg` and served
           * at `<base>/0/favicon.svg`.
           *
           * Every page links the same icon, and the default naming would give
           * each of them a copy of it: assets are emitted into `assetsDir`,
           * which is the document's own directory, so a build would carry it
           * nine times over — once at the top and again in `pid/`, `pid/net/`,
           * `tty/`, `irq/`, `driver/`, `sysvipc/`, `asound/` and `sys/user/`. That is the right trade for a page's own script and
           * stylesheet, which stay beside it so the page is self-contained; it
           * is the wrong one for a file every page shares byte for byte.
           *
           * So the favicon is named on its own, with no directory and no
           * content hash: every pass writes the same path with the same bytes.
           * `renderBuiltUrl` above puts it under the app's own directory like
           * any other asset, which makes the URL `<base>/0/favicon.svg` — a
           * fixed URL rather than a hashed one, which is what a favicon wants,
           * since a browser goes looking for it on its own schedule.
           *
           * The shared stylesheet is emitted once too, for the same reason,
           * but not from here: `config/stylesheet.ts` writes it by name and
           * links it into every document, since Vite folds a stylesheet a
           * document merely links into that page's own bundle.
           *
           * Everything else keeps Vite's own naming, which is this pattern
           * joined onto `assetsDir` — spelled out here because supplying this
           * option at all replaces that default.
           */
          assetFileNames: (asset) => {
            const names = [...(asset.names ?? []), ...(asset.originalFileNames ?? [])];
            const named = (file: string) =>
              names.some((name) => name === file || name.endsWith(`/${file}`));

            if (named(FAVICON)) return FAVICON;

            const dir = entryDir(process.env.APP_ENTRY);
            return dir === '' ? '[name]-[hash][extname]' : `${dir}/[name]-[hash][extname]`;
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy,
    },
    preview: {
      port: 4173,
      proxy,
    },
    test: {
      // The tests live all over the project, not under src/pages, so they get
      // the project root rather than Vite's — the globs below are relative to it.
      root: PROJECT_ROOT,
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'config/**/*.test.ts'],
    },
  };
});
