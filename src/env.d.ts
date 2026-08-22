/**
 * Constants `vite.config.ts` substitutes into the bundle, which exist for the
 * type checker only because nothing declares them at runtime: by the time the
 * app runs, each has been replaced by the literal it stands for.
 */

/** Where the source lives — `homepage` in package.json. See `config/repo.ts`. */
declare const __REPO_URL__: string;
