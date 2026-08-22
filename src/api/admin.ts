import { BASE_URL, FsError } from './client';

/**
 * Test-server control API, used only by the debug-mode admin page.
 *
 * A real backend serves one computer's `/proc` and has no such endpoints. The
 * mock server serves a **captured machine**, one at a time, and this is how it
 * is told which. There is no per-file choice: every page reads the same machine
 * the way they would on a real one.
 */

export interface Machine {
  /** What to send to switch to it, and what the server reports as current. */
  name: string;
  /** One line saying what kind of computer this is. */
  description: string;
}

/**
 * The machines the server offers and the one it is serving.
 *
 * The last is normally `host`, which is not a capture at all: it reads the real
 * `/proc` on the computer the test server runs on. The server leaves it out
 * where there is none, so the page offers only what it was told about.
 */
export interface MachineCatalogue {
  machines: Machine[];
  current: string;
}

export async function getMachines(signal?: AbortSignal): Promise<MachineCatalogue> {
  const url = `${BASE_URL}/fixtures`;

  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new FsError(`Cannot reach the test server at ${url}`, 0, url);
  }

  if (!response.ok) {
    throw new FsError(
      `The backend has no machine catalogue (HTTP ${response.status})`,
      response.status,
      url,
    );
  }

  const body = (await response.json()) as Partial<MachineCatalogue>;
  return { machines: body.machines ?? [], current: body.current ?? '' };
}

/** Switches the machine served, for every path and every page from now on. */
export async function setMachine(name: string, signal?: AbortSignal): Promise<string> {
  const url = `${BASE_URL}/fixtures/current`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new FsError(`Cannot reach the test server at ${url}`, 0, url);
  }

  const body = (await response.json().catch(() => null)) as {
    current?: string;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new FsError(
      body?.error ?? `Could not switch machine (HTTP ${response.status})`,
      response.status,
      url,
    );
  }

  return body?.current ?? name;
}
