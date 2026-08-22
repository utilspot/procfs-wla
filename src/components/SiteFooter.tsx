import type { ReactNode } from 'react';

/**
 * Where this app's source is, which is the one link every page carries.
 *
 * `homepage` in package.json, substituted in at build time — see
 * `config/repo.ts` and the `define` in `vite.config.ts`. The URL is written
 * down once, in the field npm already keeps it in.
 */
const REPO_URL = __REPO_URL__;

/**
 * The line at the foot of every page: the copyright and the source on the left,
 * which are the same everywhere, and whatever that page has of its own on the
 * right — the time it read the file, on the pages that read one.
 *
 * It is one small line rather than a footer proper. The pages here are about a
 * file, and what is at the bottom of them should not compete with it: muted,
 * a size below the body text, and no taller than the sentence it is.
 *
 * Every shell renders it — {@link ProcPage}, {@link DirectoryPage},
 * {@link RawApp}, {@link Refused} and the debug-build admin page — so a page
 * that has nothing to read still says where it came from.
 */
export function SiteFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="app__footer app__footer--site muted">
      <span>
        {'Copyright © 2026 · MIT · '}
        <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
          GitHub
        </a>
      </span>
      <span>{children}</span>
    </footer>
  );
}
