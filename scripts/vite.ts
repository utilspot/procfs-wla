/**
 * Runs Vite with `--base-url` and `--debug` support.
 *
 * Vite's CLI rejects flags it does not know, and has its own `--debug` meaning
 * verbose logging, so both flags are handled here rather than passed through:
 * `--base-url` becomes the `--base` option Vite understands, and `--debug`
 * becomes `APP_DEBUG` in the child's environment. The
 * `npm run build --base-url=/proc --debug` and `APP_BASE_URL` / `APP_DEBUG`
 * forms never reach argv; those are read by vite.config.ts directly.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveBase, stripBaseUrlFlag } from '../config/base-url.js';
import { debugFromArgv, parseDebug, stripDebugFlag } from '../config/debug.js';

const argv = process.argv.slice(2);

const base = resolveBase(argv, {});
// Only the CLI flag is read here; the env forms reach the config on their own.
const debug = parseDebug(debugFromArgv(argv));

const viteArgs = stripDebugFlag(stripBaseUrlFlag(argv));
if (base !== undefined) viteArgs.push(`--base=${base}`);

const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

// `--base` alone would tell Vite where the app lives but not the config, which
// needs the base too — it proxies the host paths from under it. The env forms
// reach the config on their own, so the CLI flag is passed on as one of them.
const env = { ...process.env };
if (debug !== undefined) env.APP_DEBUG = String(debug);
if (base !== undefined) env.APP_BASE_URL = base;

spawn(process.execPath, [viteBin, ...viteArgs], {
  stdio: 'inherit',
  env,
}).on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
