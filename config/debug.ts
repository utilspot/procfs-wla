/**
 * Debug mode decides whether the admin page is part of the app.
 *
 *   npm run dev                     debug on  — admin.html served alongside
 *   npm run dev --debug=false       debug off — dev without the admin page
 *   npm run build                   debug off — admin.html is not built
 *   npm run build --debug           debug on  — admin.html included in dist/
 *   APP_DEBUG=1 npm run build       same, for CI
 *
 * A normal production build therefore never emits the admin page: it is not in
 * `dist/`, not in `manifest.json`, and there is nothing to reach.
 *
 * Vite's CLI has its own `--debug` (verbose logging), so `scripts/vite.ts`
 * strips the flag and forwards the decision as `APP_DEBUG` instead.
 */

export const FLAG = '--debug';

const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off']);

/** Parses a flag or environment value; undefined when it says nothing. */
export function parseDebug(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUE.has(normalized)) return true;
  if (FALSE.has(normalized)) return false;
  return undefined;
}

/** Reads `--debug`, `--debug=false` or `--debug false` from CLI arguments. */
export function debugFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith(`${FLAG}=`)) return arg.slice(FLAG.length + 1);
    if (arg === FLAG) {
      const next = argv[i + 1];
      // `--debug` on its own means on; only consume a following value.
      return next !== undefined && parseDebug(next) !== undefined ? next : 'true';
    }
  }
  return undefined;
}

/**
 * Whether debug mode is on. Defaults to on while developing and off for a
 * build, so shipping the admin page is always a deliberate `--debug`.
 */
export function resolveDebug(
  command: 'serve' | 'build',
  argv: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // npm rewrites `--debug=false` and `--no-debug` to an empty value, so an
  // empty npm_config_debug means off — unlike an empty APP_DEBUG, which is
  // treated as unset the way an empty environment variable normally is.
  const npmValue = env['npm_config_debug'];
  const fromNpm = npmValue === '' ? false : parseDebug(npmValue);

  const explicit = parseDebug(debugFromArgv(argv)) ?? fromNpm ?? parseDebug(env['APP_DEBUG']);

  return explicit ?? command === 'serve';
}

/** Removes `--debug` from arguments before they reach Vite's own CLI. */
export function stripDebugFlag(argv: readonly string[]): string[] {
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith(`${FLAG}=`)) continue;
    if (arg === FLAG) {
      const next = argv[i + 1];
      if (next !== undefined && parseDebug(next) !== undefined) i++;
      continue;
    }
    rest.push(arg);
  }
  return rest;
}
