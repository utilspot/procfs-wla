/**
 * Resolves the public base path the app is served from, so it can be deployed
 * under a sub-path (`https://host/proc/`) instead of the domain root.
 *
 * Accepted forms, highest priority first:
 *
 *   npm run build --base-url=/proc      npm exposes this as npm_config_base_url
 *   npm run build -- --base-url=/proc   CLI argument (see scripts/vite.mjs)
 *   npm run build -- --base-url /proc   same, space separated
 *   APP_BASE_URL=/proc npm run build    environment variable
 *
 * The same flag works for `dev` and `preview`.
 */

export const FLAG = '--base-url';

/** True for `https://cdn.example.com/proc`, false for `/proc`. */
function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/** Vite wants a base that ends in `/`, and a path base that also starts with one. */
export function normalizeBase(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '/') return '/';

  const withTrailing = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  if (isAbsoluteUrl(withTrailing)) return withTrailing;

  return withTrailing.startsWith('/') ? withTrailing : `/${withTrailing}`;
}

/** Reads `--base-url=<value>` or `--base-url <value>` out of CLI arguments. */
function fromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith(`${FLAG}=`)) return arg.slice(FLAG.length + 1);
    if (arg === FLAG) return argv[i + 1];
  }
  return undefined;
}

/** The configured base path, or undefined when none was given. */
export function resolveBase(
  argv: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = fromArgv(argv) ?? env['npm_config_base_url'] ?? env['APP_BASE_URL'];
  return value === undefined || value === '' ? undefined : normalizeBase(value);
}

/** Removes `--base-url` from arguments before they reach Vite's CLI parser. */
export function stripBaseUrlFlag(argv: readonly string[]): string[] {
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith(`${FLAG}=`)) continue;
    if (arg === FLAG) {
      i++; // also drop its value
      continue;
    }
    rest.push(arg);
  }
  return rest;
}
