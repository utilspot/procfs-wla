import { Router } from 'express';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { API_ROOT, hostPathFor, HOST_ROOT, LIST_ROOT } from '../src/api/paths.js';
import { DT_DIR, DT_REG } from '../src/lib/directory.js';
import {
  choices,
  currentMachine,
  isServablePath,
  resolveHostPath,
  setCurrentMachine,
} from './machines.js';

/**
 * The two endpoints the real backend serves, over whichever machine this server
 * is currently set to, plus the switcher the admin page drives.
 *
 * Because a machine is a directory tree rather than a list of paths this server
 * was told about, both endpoints are the same two lines they would be against a
 * real `/proc`: resolve the host path inside the tree, then read the file or
 * the directory. Nothing here knows which files have a page.
 */

/** A listing as it goes on the wire: entry name to the `d_type` for it. */
export type Listing = Record<string, number>;

/**
 * A directory read the way `requestStatHandler` in `WebProcfsExecutor.c` reads
 * it: regular files and directories, everything else — links included — left
 * out. On a real `/proc` that means no `self` and no `thread-self`; in a
 * captured machine those are ordinary directories, since a capture cannot hold
 * a link to a process that is not running.
 */
export function readListing(directory: string): Listing {
  const listing: Listing = {};

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile()) listing[entry.name] = DT_REG;
    else if (entry.isDirectory()) listing[entry.name] = DT_DIR;
  }

  return listing;
}

/** The host path a file request is for: `/0/api/file/cpuinfo` is `/proc/cpuinfo`. */
function fileRequest(requestPath: string): string | null {
  return hostPathFor(requestPath);
}

/**
 * The host directory a listing request is for: `/0/api/dir/` is `/proc` itself,
 * `/0/api/dir/sys` is `/proc/sys`.
 */
export function directoryFor(requestPath: string): string | null {
  if (requestPath !== LIST_ROOT && !requestPath.startsWith(`${LIST_ROOT}/`)) return null;

  const below = requestPath.slice(LIST_ROOT.length).replace(/^\/+/, '').replace(/\/+$/, '');
  return below === '' ? HOST_ROOT : `${HOST_ROOT}/${below}`;
}

/**
 * Says why a read of the computer's own `/proc` failed, rather than leaving a
 * bare 404 to be puzzled over. A capture fails only through a mistake in this
 * repo, so that one stays a plain 404.
 */
function reportHostFailure(
  res: Parameters<Parameters<Router['get']>[1]>[1],
  file: string,
  cause: unknown,
  what: string,
): void {
  const status = (cause as NodeJS.ErrnoException).code === 'EACCES' ? 403 : 404;
  const detail = `${file} on this computer: ${(cause as Error).message}`;

  console.log(`[machines] host ${what} failed — ${detail}`);
  res.status(status).type('text/plain').send(`cannot ${what} ${detail}`);
}

export function routes(): Router {
  const router = Router();

  /** The catalogue the admin page reads: the six choices and which is on. */
  router.get('/fixtures', (_req, res) => {
    res.json({ machines: choices(), current: currentMachine() });
  });

  /** And what it calls to switch. One decision for the whole of `/proc`. */
  router.put('/fixtures/current', (req, res) => {
    const body = req.body as { name?: unknown } | undefined;
    if (typeof body?.name !== 'string') {
      res.status(400).json({ error: 'expected a JSON body of { "name": "<machine>" }' });
      return;
    }

    try {
      setCurrentMachine(body.name);
    } catch (cause) {
      res.status(400).json({ error: cause instanceof Error ? cause.message : String(cause) });
      return;
    }

    console.log(`[machines] now serving ${currentMachine()}`);
    res.json({ current: currentMachine() });
  });

  // The listing endpoint. Registered first: its prefix is not under the file
  // one, but both are matched by pattern and this keeps the order plain.
  router.get(new RegExp(`^${LIST_ROOT}(/.*)?$`), (req, res) => {
    const directory = directoryFor(req.path);

    if (directory === null || !isServablePath(directory)) {
      res.status(404).type('text/plain').send(`no listing for: ${directory ?? req.path}`);
      return;
    }

    const resolved = resolveHostPath(directory);
    if (resolved === null) {
      res.status(404).type('text/plain').send(`no listing for: ${directory}`);
      return;
    }

    let listing: Listing;
    try {
      if (!statSync(resolved.file).isDirectory()) throw new Error('not a directory');
      listing = readListing(resolved.file);
    } catch (cause) {
      if (!resolved.host) {
        res.status(404).type('text/plain').send(`no listing for: ${directory}`);
        return;
      }
      reportHostFailure(res, resolved.file, cause, 'list');
      return;
    }

    res.json(listing);
  });

  // The file endpoint. What a message names is the host path, not the route:
  // the file is what the reader asked for, and the page's heading says the same.
  router.get(new RegExp(`^${API_ROOT}(/.*)?$`), (req, res) => {
    const path = fileRequest(req.path);

    if (path === null || !isServablePath(path)) {
      res.status(404).type('text/plain').send(`no such file: ${path ?? req.path}`);
      return;
    }

    const resolved = resolveHostPath(path);
    if (resolved === null) {
      res.status(404).type('text/plain').send(`no such file: ${path}`);
      return;
    }

    /*
     * Read as **bytes**, not as text. Most of `/proc` is text and every page
     * but one reads it as such, but `/proc/<pid>/auxv` is an array of native
     * words — pointers, with bytes no UTF-8 decoder can carry — and decoding it
     * here would replace them before they ever left this server. The real
     * backend does the same thing for the same reason: `fileHandler` in
     * `WebProcfsExecutor.c` reads into a byte buffer and writes it through
     * untouched.
     *
     * Express sends a Buffer as it stands, so a text file is unchanged by this
     * and arrives as the same bytes it always did.
     */
    let content: Buffer;
    try {
      if (!statSync(resolved.file).isFile()) throw new Error('not a file');
      content = readFileSync(resolved.file);
    } catch (cause) {
      if (!resolved.host) {
        res.status(404).type('text/plain').send(`no such file: ${path}`);
        return;
      }
      reportHostFailure(res, resolved.file, cause, 'read');
      return;
    }

    res.type('text/plain').send(content);
  });

  return router;
}
