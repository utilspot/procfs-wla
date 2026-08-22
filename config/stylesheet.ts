import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild, type Plugin } from 'vite';
import { ASSET_DIR } from '../src/api/paths';

/**
 * **The stylesheet — there is one for the whole site.** It is emitted once per
 * build and linked from every document.
 *
 * Nothing imports it. That is the point: an `import` is folded into the
 * importing page's bundle, so with sixty-three pages the same rules would be
 * written into the output sixty-three times over, which is what this file exists
 * to stop. `dist/` carries one stylesheet, a reader fetches it on whichever
 * page they open first, and every page after that is already styled.
 *
 * A plain `<link>` in each document does not work either, and it is worth
 * saying why, because it looks like it should: Vite reads a linked stylesheet
 * as part of that document's CSS entry and folds it into the page's bundle
 * exactly as an import would. The link has to be written *after* Vite has
 * finished deciding what belongs to whom — which is what
 * {@link transformIndexHtml} is — and the file emitted beside it under a name
 * of our own choosing.
 *
 * So this plugin does both:
 *
 * - **In a build**, it emits `common-<hash>.css` at the top of the output with
 *   an explicit name, so every page's pass writes the same file rather than one
 *   of its own, and injects a link to it at `<base>/0/common-<hash>.css` — the
 *   app's own directory, where everything that is not a `/proc` entry lives.
 *   The hash is of the bytes as written, minified and all: a browser that
 *   cached the old stylesheet and then met a page built from a new one would
 *   draw it wrong, and a name that changes with the contents stops that.
 * - **In dev**, where nothing is built and nothing is renamed, it injects a
 *   link to `<base>/common.css`, which Vite serves from `src/pages/` like any
 *   other file under its root.
 *
 * The link goes under the icon and over the title, ahead of anything Vite adds
 * to the head. Nothing else styles a page, so nothing depends on that order
 * today; it is where a stylesheet belongs, and it is the order a page's own
 * rules would need if one ever had any again.
 */

/** Where the rules live: beside the documents, under Vite's root. */
const COMMON = fileURLToPath(new URL('../src/pages/common.css', import.meta.url));

/**
 * The URL it is served at in dev: its name under Vite's root, and **`?direct`**,
 * which is what makes the dev server answer with the stylesheet itself.
 *
 * Without it the answer is a JavaScript module — the shape an `import` of a
 * stylesheet takes, so that editing one can be hot-replaced — served as
 * `text/javascript`, which a browser will not apply to a `<link>`. Nothing is
 * imported here: the document links this file, so what it needs back is CSS.
 * A build has no such question, and the query is not part of the built URL.
 */
export const COMMON_URL = 'common.css?direct';

/** Enough of a content hash to name a file by, in Vite's own alphabet. */
function hashOf(source: string): string {
  return createHash('sha256').update(source).digest('base64url').slice(0, 8);
}

export function commonStylesheet(): Plugin {
  let base = '/';
  let serving = false;
  let minify = true;

  /**
   * The stylesheet as it will be written, minified once however many pages ask
   * for it — and it is asked for by every document and again when the file is
   * emitted, which is why the work is remembered rather than repeated.
   *
   * Emitting a file directly is what puts one copy of it in the output, and the
   * cost of stepping outside Vite's CSS pipeline that way is that nothing
   * minifies it on the way. So this does it, with the same tool Vite would
   * have used.
   */
  let prepared: Promise<{ source: string; name: string }> | null = null;

  const stylesheet = () => {
    prepared ??= (async () => {
      const raw = readFileSync(COMMON, 'utf8');
      const source = minify
        ? (await transformWithEsbuild(raw, COMMON, { loader: 'css', minify: true })).code
        : raw;
      return { source, name: namedFor(source) };
    })();
    return prepared;
  };

  return {
    name: 'procfs:common-stylesheet',

    configResolved(config) {
      base = config.base;
      serving = config.command === 'serve';
      minify = config.build.cssMinify !== false;
    },

    async transformIndexHtml(html) {
      const href = serving
        ? `${base}${COMMON_URL}`
        : `${base}${ASSET_DIR}/${(await stylesheet()).name}`;
      const link = `<link rel="stylesheet" href="${href}" />`;

      /*
       * Placed rather than injected, because **where it lands is the cascade**.
       * Vite appends a page's own stylesheet to the end of the head, so a tag
       * injected there would sit after it and win every tie — the shared rules
       * would beat the page's own, which is backwards. `head-prepend` would put
       * it above `<meta charset>`, which is valid but is not where a charset
       * declaration wants to be.
       *
       * So it goes where it reads: under the icon, above the title, and above
       * everything Vite adds.
       */
      const icon = /^([ \t]*)<link rel="icon"[^>]*>$/m;
      return icon.test(html)
        ? html.replace(icon, (line, indent: string) => `${line}\n${indent}${link}`)
        : html.replace(/<head>/, `<head>\n    ${link}`);
    },

    /**
     * The file itself, named for its contents. `fileName` is given rather than
     * `name` so Rollup writes exactly this path: every page's pass emits the
     * same bytes under the same name, and the output ends with one of them.
     */
    async generateBundle() {
      if (serving) return;
      const { source, name } = await stylesheet();
      this.emitFile({ type: 'asset', fileName: name, source });
    },
  };
}

/** `common-<hash>.css`, which is the file in `dist/` and the last part of its URL. */
export function namedFor(source: string): string {
  return `common-${hashOf(source)}.css`;
}
