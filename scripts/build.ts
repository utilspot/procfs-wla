/**
 * Builds the app, one page at a time.
 *
 * Vite builds every entry in a single Rollup pass by default, which hoists the
 * code the pages share — React, the API client — into a `shared-<hash>.js`
 * chunk that each page then has to load alongside its own. A page here is
 * meant to be a self-contained drop-in: one document, one script, one
 * stylesheet. So each page gets its own pass, with no other entry in it for
 * Rollup to hoist anything into.
 *
 * The cost is duplicated bytes between pages and a slower build; the benefit is
 * that serving a page needs no knowledge of which chunks it depends on.
 *
 * Accepts the same `--base-url` and `--debug` flags as the other scripts.
 */
import { copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type InlineConfig } from 'vite';
import { resolveBase } from '../config/base-url.js';
import { resolveDebug } from '../config/debug.js';
import { ADMIN_DOCUMENT, DOCUMENTS } from '../config/document.js';
import { SCREENSHOTS, writeManifest } from '../config/manifest.js';

const argv = process.argv.slice(2);
const base = resolveBase(argv) ?? '/';
const debug = resolveDebug('build', argv);
const pages = debug ? [...DOCUMENTS, ADMIN_DOCUMENT] : DOCUMENTS;

const outDir = fileURLToPath(new URL('../dist', import.meta.url));

console.log(`[procfs] base ${base}, debug mode ${debug ? 'ON' : 'off'}`);
// The count rather than the list: each page is named as it is built, a line
// below, so spelling all ninety out first says the same thing twice — once as a
// paragraph nobody reads and once as the log of what actually happened.
console.log(`[procfs] building ${pages.length} pages`);

// Each pass writes into the same directory, so only the first may clear it.
rmSync(outDir, { recursive: true, force: true });

for (const page of pages) {
  // vite.config.ts narrows its entry list to this page.
  process.env.APP_ENTRY = page;

  const config: InlineConfig = {
    base,
    build: { emptyOutDir: false, outDir },
    logLevel: 'warn',
  };

  await build(config);
  console.log(`[procfs] built ${page}`);
}

delete process.env.APP_ENTRY;

/*
 * The pictures of the app the manifest advertises, copied in once the pages are
 * built.
 *
 * No build pass emits them on its own, and that is the difference between these
 * and the favicon: the icon is an *asset*, because every document carries a
 * `<link>` naming it, so Rollup finds it and emits it. Nothing links a
 * screenshot — it is described rather than loaded, by the entry
 * `config/manifest.ts` writes, for a host that shows the app before serving it.
 *
 * So they are copied here, once, into the same flat output as everything else,
 * and `urlFor` publishes them under the app's own directory like any other
 * file. That is also why they are not in `public/`, whose files are served from
 * the root: `/screenshot-light.png` is a URL a `/proc` entry of that name would
 * want, and the app's own files never take one of those.
 */
for (const screenshot of new Set(Object.values(SCREENSHOTS))) {
  copyFileSync(
    fileURLToPath(new URL(`../src/pages/${screenshot}`, import.meta.url)),
    join(outDir, screenshot),
  );
}

const manifest = writeManifest(outDir, base);
console.log(`[procfs] wrote manifest.json (${manifest.files.length} files)`);
