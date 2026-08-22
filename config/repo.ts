import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Where this app's source lives, for the link in the footer of every page.
 *
 * It is `homepage` in package.json and nowhere else, so the URL is written down
 * once. npm already knows that field — `npm home` opens it, and a registry page
 * links it — and a second copy inside `src/` would be one more thing to forget
 * when the repository moves.
 *
 * package.json is a Node file, not something the browser should fetch, so it is
 * read here at config time and handed to the app as `__REPO_URL__`, a constant
 * `vite.config.ts` defines. What reaches the bundle is the string itself; the
 * rest of package.json — the dependency list included — stays behind.
 */

/** package.json, from `config/` rather than from wherever the process started. */
const PACKAGE_JSON = new URL('../package.json', import.meta.url);

/**
 * The `homepage` field, or a thrown error saying it is missing — the footer is
 * on every page, so a build that would ship a link to `undefined` should stop
 * here instead.
 */
export function readHomepage(json: string): string {
  const parsed: unknown = JSON.parse(json);
  const homepage =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { homepage?: unknown }).homepage
      : undefined;

  if (typeof homepage !== 'string' || homepage.trim() === '') {
    throw new Error('package.json has no "homepage": the footer of every page links it');
  }

  return homepage.trim();
}

/** The same, read from this project's own package.json. */
export function repoUrl(): string {
  return readHomepage(readFileSync(fileURLToPath(PACKAGE_JSON), 'utf8'));
}
