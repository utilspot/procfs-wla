import { apiPath, listPath } from './paths';
import type { Listing } from '../lib/directory';

/**
 * Base URL of the backend.
 *
 * Defaults to the path the app itself is served from — `--base-url=/procfs`
 * makes it `/procfs`, so a page loaded from `/procfs/cpuinfo.html` reads
 * `/procfs/0/api/file/cpuinfo` rather than `/0/api/file/cpuinfo` at the domain root.
 * Set `VITE_API_BASE_URL` to point the reads at a backend somewhere else.
 *
 * Either way the path is relative to this origin in dev, where Vite proxies the
 * served paths and `/fixtures` to the mock server (see vite.config.ts).
 */
export const BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL || import.meta.env.BASE_URL
).replace(/\/+$/, '');

export class FsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'FsError';
  }
}

export interface ReadFileOptions {
  signal?: AbortSignal;
}

/** Builds a host path's URL, e.g. `/proc/cpuinfo` -> `<base>/0/api/file/cpuinfo`. */
export function fileUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_URL}${apiPath(normalized)}`;
}

/**
 * Reads a file from the host filesystem: the backend serves it under
 * `/0/api/file`, at its host path with the `/proc` prefix swapped for that one.
 *
 * `path` stays the host path throughout — it is what the caller asked for and
 * what an error message should name, so the mapping goes no further than the
 * URL {@link fileUrl} builds.
 */
export async function readFile(path: string, options: ReadFileOptions = {}): Promise<string> {
  const url = fileUrl(path);

  let response: Response;
  try {
    response = await fetch(url, { signal: options.signal, headers: { Accept: 'text/plain' } });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new FsError(`Cannot reach the server at ${url}`, 0, url);
  }

  if (!response.ok) {
    throw new FsError(
      `Failed to read ${path} (HTTP ${response.status} ${response.statusText})`,
      response.status,
      url,
    );
  }

  return response.text();
}

/**
 * Reads a file as the **bytes** it is, for the one kind of `/proc` entry that
 * is not text: `/proc/<pid>/auxv` is an array of native words, and a pointer in
 * it holds bytes no UTF-8 decoder can carry — {@link readFile} would hand back
 * `U+FFFD` where they were, with no way to get them back.
 *
 * Everything else about the read is the same, deliberately: the same URL, the
 * same errors, the same host path in the message. Only the decoding differs,
 * and only because there is nothing here to decode.
 */
export async function readFileBytes(
  path: string,
  options: ReadFileOptions = {},
): Promise<Uint8Array> {
  const url = fileUrl(path);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: options.signal,
      headers: { Accept: 'application/octet-stream' },
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new FsError(`Cannot reach the server at ${url}`, 0, url);
  }

  if (!response.ok) {
    throw new FsError(
      `Failed to read ${path} (HTTP ${response.status} ${response.statusText})`,
      response.status,
      url,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

/** Builds a directory's listing URL, e.g. `/proc` -> `<base>/0/api/dir/`. */
export function listUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_URL}${listPath(normalized)}`;
}

/**
 * Lists a directory on the host filesystem: the backend serves the listing
 * under `/0/api/dir`, beside the bytes at `/0/api/file`.
 *
 * The answer is a JSON object keyed by entry name, each value the `d_type`
 * `readdir` reported — see `src/lib/directory.ts`, which reads it. It is
 * checked to be that much here rather than handed on as whatever arrived: an
 * HTML error page parses as JSON exactly never, but a JSON array or a string
 * would, and would go on to be read as a directory with nothing in it.
 */
export async function listDirectory(
  path: string,
  options: ReadFileOptions = {},
): Promise<Listing> {
  const url = listUrl(path);

  let response: Response;
  try {
    response = await fetch(url, { signal: options.signal, headers: { Accept: 'application/json' } });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new FsError(`Cannot reach the server at ${url}`, 0, url);
  }

  if (!response.ok) {
    throw new FsError(
      `Failed to list ${path} (HTTP ${response.status} ${response.statusText})`,
      response.status,
      url,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FsError(`The listing of ${path} was not JSON`, response.status, url);
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new FsError(`The listing of ${path} was not a directory listing`, response.status, url);
  }

  return body as Listing;
}
