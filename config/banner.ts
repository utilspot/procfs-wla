/**
 * The one line the dev server adds to Vite's banner: where the admin page is.
 *
 *     ➜  Local:   http://localhost:5173/
 *     ➜  Admin:   http://localhost:5173/0/admin
 *     ➜  Network: use --host to expose
 *
 * The admin page is the fixture switcher, and it exists in debug mode only —
 * see `config/debug.ts`. It is also the one page here nothing links to: every
 * other page is reached from the listing at the base, and this one is entered
 * by typing its URL, because it is not a `/proc` entry and has no place among
 * them. A line in the banner is where that URL comes from.
 *
 * Announced on the **dev server alone**. Debug mode defaults to on while
 * developing and off for a build, so the preview server can be showing a `dist/`
 * with no admin page in it at all — printing the URL there would advertise a
 * 404.
 */
import type { Plugin } from 'vite';
import { ADMIN_URL } from './document';

/** The colour codes themselves, which come off before the line is read. */
const COLOUR_CODE = /\u001b\[[0-9;]*m/g;

/**
 * How Vite spells the line this one goes after — **once the colours are off**.
 *
 * Coloured, that line arrives as `…[1mLocal[22m:   …`: the label is bold and
 * the colon is outside it, so neither `Local:` nor `\bLocal` is in the string
 * to find. Stripping the codes first leaves one spelling to match rather than
 * one per way Vite paints it.
 */
const LOCAL_LINE = /\bLocal:/;

/** A line as it reads without its colours. */
function plain(message: string): string {
  return message.replace(COLOUR_CODE, '');
}

/**
 * What a colour code starts with. Vite has already decided whether this output
 * takes colour, so the answer is read off what it printed rather than worked
 * out again here.
 */
const ESCAPE = '\u001b[';

/** The label, which is `Local`'s width so the two URLs line up under each other. */
const LABEL = 'Admin';

/**
 * The admin page's URL, from the one Vite prints for the app itself.
 *
 * Vite's URL already carries the base — `http://localhost:5173/procfs/` under
 * `--base-url=/procfs` — and {@link ADMIN_URL} is spelled from the base down,
 * so the two join with no knowledge of either here. The `.html` comes off the
 * way it does for every other page: what this app publishes is `0/admin`.
 */
export function adminUrl(local: string): string {
  const base = local.endsWith('/') ? local : `${local}/`;
  return `${base}${ADMIN_URL.replace(/\.html$/, '')}`;
}

/**
 * The line itself, coloured the way Vite colours its own — a green arrow, the
 * label in bold, the URL in cyan with a bold port.
 *
 * The codes are written out rather than taken from a colour library: Vite
 * bundles its own and exports none, and a transitive dependency is not one this
 * project has asked for. Whether to use them at all is not guessed either — see
 * {@link announceAdmin}, which reads that off the line Vite has just printed.
 */
export function adminLine(url: string, colored: boolean): string {
  if (!colored) return `  ➜  ${LABEL}:   ${url}`;

  const green = (text: string) => `${ESCAPE}32m${text}${ESCAPE}39m`;
  const bold = (text: string) => `${ESCAPE}1m${text}${ESCAPE}22m`;
  const cyan = (text: string) => `${ESCAPE}36m${text}${ESCAPE}39m`;
  // The port in bold inside the cyan, which is what Vite does to its own URLs.
  const withPort = url.replace(/:(\d+)\//, (_, port: string) => `:${bold(port)}/`);

  return `  ${green('➜')}  ${bold(LABEL)}:   ${cyan(withPort)}`;
}

/**
 * Adds that line to the dev server's banner, right under `Local`.
 *
 * Vite prints the banner a line at a time through its own logger, so the line
 * goes in by watching for `Local:` as it goes past rather than by rebuilding a
 * banner this plugin does not own. Two things follow from doing it that way,
 * and both are deliberate:
 *
 *  - **The colours are whatever Vite just used.** A line carrying a colour code
 *    means Vite decided this output takes colour — a terminal, or `FORCE_COLOR`
 *    — and one without means it decided not to. Reading that off the line
 *    settles it exactly, where guessing from `NO_COLOR` and `isTTY` would be
 *    this plugin's own answer to a question Vite has already answered.
 *  - **A banner with no `Local` line still gets the URL**, printed after
 *    whatever Vite did print. The admin page is worth announcing even from a
 *    Vite whose banner this plugin no longer recognises.
 */
export function announceAdmin(debug: boolean): Plugin {
  return {
    name: 'procfs:announce-admin',

    configureServer(server) {
      if (!debug) return;

      const printUrls = server.printUrls.bind(server);

      server.printUrls = () => {
        const local = server.resolvedUrls?.local[0];
        if (local === undefined) {
          printUrls();
          return;
        }

        const { logger } = server.config;
        // Kept by reference so the logger can be handed back exactly as found;
        // `info` is the same function, bound for calling from the wrapper.
        const original = logger.info;
        const info = original.bind(logger);
        let printed = false;

        logger.info = (message, options) => {
          info(message, options);

          if (!printed && LOCAL_LINE.test(plain(message))) {
            printed = true;
            info(adminLine(adminUrl(local), message.includes(ESCAPE)));
          }
        };

        try {
          printUrls();
        } finally {
          logger.info = original;
        }

        if (!printed) info(adminLine(adminUrl(local), false));
      };
    },
  };
}
