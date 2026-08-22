// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from './app';
import { API_ROOT, HOST_ROOT, LIST_ROOT } from '../src/api/paths';
import { DT_DIR, DT_REG } from '../src/lib/directory';
import { choices, currentMachine, HOST_MACHINE, machines, setCurrentMachine } from './machines';

const MACHINE_ROOT = resolve('server/machines');

let server: Server;
let baseUrl: string;

const url = (path: string) => `${baseUrl}${path}`;
const file = (hostPath: string) => url(`${API_ROOT}${hostPath.slice(HOST_ROOT.length)}`);
const list = (hostPath: string) =>
  url(hostPath === HOST_ROOT ? `${LIST_ROOT}/` : `${LIST_ROOT}${hostPath.slice(HOST_ROOT.length)}`);

const switchTo = (name: string) =>
  fetch(url('/fixtures/current'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

/** Whether this computer has a `/proc` of its own, for the `host` tests. */
const hasHostProc = (() => {
  try {
    return statSync(HOST_ROOT).isDirectory();
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port assigned');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  setCurrentMachine(machines()[0]!.name);
});

/**
 * The captured machines are whole `/proc` trees rather than a list of files
 * this server was told about, so what it can serve is whatever is in the tree —
 * which is what these walk.
 */
const NAMES = machines().map((machine) => machine.name);

describe('the machines', () => {
  it('are the five captures and nothing else', () => {
    expect(NAMES).toEqual(['container', 'desktop', 'raspberry-pi', 'server', 'vm']);
  });

  it('each describe what kind of computer they are', () => {
    for (const machine of machines()) {
      expect(machine.description, machine.name).not.toBe('');
      expect(machine.description.length, machine.name).toBeGreaterThan(20);
    }
  });

  it('each hold a whole /proc, not a handful of files', () => {
    for (const name of NAMES) {
      const entries = readdirSync(join(MACHINE_ROOT, name, 'proc'));
      expect(entries.length, name).toBeGreaterThan(40);
      // The files every page in this build reads, on every machine.
      for (const entry of ['cpuinfo', 'meminfo', 'mounts', 'stat', 'version']) {
        expect(entries, name).toContain(entry);
      }
    }
  });

  /** `self` is what a page reads at a URL naming no process. */
  it('each hold a complete self/ for the pages that name no process', () => {
    for (const name of NAMES) {
      const self = readdirSync(join(MACHINE_ROOT, name, 'proc', 'self'));
      expect(self, name).toEqual(
        expect.arrayContaining(['cmdline', 'limits', 'smaps', 'stat', 'status']),
      );
    }
  });

  it('offers host beside them where this computer has a /proc', () => {
    const offered = choices().map((choice) => choice.name);

    expect(offered.slice(0, NAMES.length)).toEqual(NAMES);
    expect(offered.includes(HOST_MACHINE)).toBe(hasHostProc);
  });
});

describe('GET /fixtures', () => {
  it('reports the machines and which one is being served', async () => {
    const response = await fetch(url('/fixtures'));
    const body = (await response.json()) as {
      machines: { name: string; description: string }[];
      current: string;
    };

    expect(response.status).toBe(200);
    expect(body.machines.map((machine) => machine.name)).toEqual(
      choices().map((choice) => choice.name),
    );
    expect(body.current).toBe(currentMachine());
    expect(body.machines.every((machine) => machine.description !== '')).toBe(true);
  });
});

describe('PUT /fixtures/current', () => {
  it('switches the machine for every path at once', async () => {
    await switchTo('raspberry-pi');
    expect(currentMachine()).toBe('raspberry-pi');

    // One decision: two different files, same machine behind both.
    expect(await (await fetch(file('/proc/cpuinfo'))).text()).toContain('BogoMIPS');
    expect(await (await fetch(file('/proc/version'))).text()).toMatch(/aarch64|rpi|Raspberry/i);

    await switchTo('server');
    expect(await (await fetch(file('/proc/cpuinfo'))).text()).toContain('AMD');
  });

  it('answers with the machine now being served', async () => {
    const response = await switchTo('vm');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ current: 'vm' });
  });

  it('refuses a machine it does not have, and keeps serving the old one', async () => {
    const before = currentMachine();
    const response = await switchTo('../../etc');

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/unknown machine/);
    expect(currentMachine()).toBe(before);
  });

  it('refuses a body that does not name one', async () => {
    const response = await fetch(url('/fixtures/current'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/proc/mounts' }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/name/);
  });
});

describe(`GET ${API_ROOT}<host file>`, () => {
  it.each(NAMES)('serves every file in the %s tree as plain text', async (name) => {
    await switchTo(name);
    const root = join(MACHINE_ROOT, name, 'proc');

    // Every file the tree holds, at the host path it sits at.
    const walk = (dir: string, prefix: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name), `${prefix}/${entry.name}`)
          : [`${prefix}/${entry.name}`],
      );

    for (const hostPath of walk(root, HOST_ROOT)) {
      const response = await fetch(file(hostPath));

      expect(response.status, hostPath).toBe(200);
      expect(response.headers.get('content-type'), hostPath).toMatch(/text\/plain/);
      expect(await response.text(), hostPath).toEqual(
        readFileSync(join(root, hostPath.slice(HOST_ROOT.length + 1)), 'utf8'),
      );
    }
  });

  it('serves a file belonging to a process', async () => {
    await switchTo('desktop');

    for (const path of ['/proc/self/status', '/proc/12282/status', '/proc/self/smaps']) {
      expect((await fetch(file(path))).status, path).toBe(200);
    }
  });

  /**
   * `/proc/<pid>/auxv` is not text — it is pairs of native words, and a pointer
   * in one holds bytes no UTF-8 decoder can carry. So this asserts the *bytes*
   * rather than the text: decoding and re-encoding them here would replace
   * those with `U+FFFD` before they ever left the server, and the test above
   * would not notice, because it compares one decode against another.
   */
  it('serves a file that is not text as the bytes it is', async () => {
    await switchTo('desktop');
    const path = '/proc/self/auxv';

    const response = await fetch(file(path));
    const served = new Uint8Array(await response.arrayBuffer());
    const onDisk = new Uint8Array(
      readFileSync(join(MACHINE_ROOT, 'desktop', 'proc', 'self', 'auxv')),
    );

    expect(response.status).toBe(200);
    expect(served.length).toBe(onDisk.length);
    expect(Array.from(served)).toEqual(Array.from(onDisk));
    // And the bytes that would not have survived a decode are really in there.
    expect(served.some((byte) => byte > 0x7f)).toBe(true);
  });

  /**
   * A machine is a capture, not a running computer: a numbered process it never
   * had is simply absent, and says so rather than being answered with another's.
   */
  it('404s a process this machine does not have', async () => {
    await switchTo('desktop');
    const response = await fetch(file('/proc/99999/status'));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('no such file: /proc/99999/status');
  });

  it('404s a file this machine does not have, naming the host path', async () => {
    const response = await fetch(file('/proc/nosuchthing'));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('no such file: /proc/nosuchthing');
  });

  it('404s a directory asked for as a file', async () => {
    expect((await fetch(file('/proc/sys'))).status).toBe(404);
  });

  it('refuses to walk out of the machine it is serving', async () => {
    for (const path of ['/0/api/file/../../etc/passwd', '/0/api/file/./../etc/passwd']) {
      const response = await fetch(url(path));
      expect([400, 404], path).toContain(response.status);
      expect(await response.text(), path).not.toContain('root:');
    }
  });
});

describe(`GET ${LIST_ROOT}<host directory>`, () => {
  it('lists /proc itself, which is what the base path lands on', async () => {
    await switchTo('desktop');
    const response = await fetch(list(HOST_ROOT));
    const body = (await response.json()) as Record<string, number>;

    expect(response.status).toBe(200);
    expect(body['cpuinfo']).toBe(DT_REG);
    expect(body['self']).toBe(DT_DIR);
    expect(body['tty']).toBe(DT_DIR);
  });

  /**
   * The whole point of a machine being a directory tree: a subdirectory lists
   * like any other, so the listing page works below `/proc` and not only at it.
   */
  it('lists a directory below /proc', async () => {
    await switchTo('desktop');

    const tty = (await (await fetch(list('/proc/tty'))).json()) as Record<string, number>;
    expect(tty).toEqual({ drivers: DT_REG, ldiscs: DT_REG });

    const self = (await (await fetch(list('/proc/self'))).json()) as Record<string, number>;
    expect(self['status']).toBe(DT_REG);

    const sys = (await (await fetch(list('/proc/sys'))).json()) as Record<string, number>;
    expect(sys['kernel']).toBe(DT_DIR);
  });

  it('404s a directory this machine does not have', async () => {
    const response = await fetch(list('/proc/nosuchdir'));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('no listing for: /proc/nosuchdir');
  });

  it('404s a file asked for as a directory', async () => {
    expect((await fetch(list('/proc/cpuinfo'))).status).toBe(404);
  });

  it('follows the machine being served', async () => {
    await switchTo('desktop');
    const desktop = (await (await fetch(list('/proc/1'))).json()) as Record<string, number>;

    await switchTo('server');
    const server = (await (await fetch(list('/proc/1'))).json()) as Record<string, number>;

    // Both are pid 1, on two computers that captured different files of it.
    expect(Object.keys(desktop).length).toBeGreaterThan(0);
    expect(Object.keys(server).length).toBeGreaterThan(0);
    expect(Object.keys(desktop)).not.toEqual(Object.keys(server));
  });
});

describe('the host choice', () => {
  it.runIf(hasHostProc)('reads this computer’s own /proc rather than a capture', async () => {
    await switchTo(HOST_MACHINE);

    // Compared against a file that does not change between two reads: the
    // point is that these are this computer's bytes, and /proc/uptime ticks.
    expect(await (await fetch(file('/proc/version'))).text()).toBe(
      readFileSync('/proc/version', 'utf8'),
    );
    // And read fresh each time rather than cached, which uptime does show.
    expect(await (await fetch(file('/proc/uptime'))).text()).toMatch(/^\d+\.\d+ \d+\.\d+\n$/);

    const listing = (await (await fetch(list(HOST_ROOT))).json()) as Record<string, number>;
    expect(listing['cpuinfo']).toBe(DT_REG);
    // A real /proc has a directory per running process, this one included.
    expect(listing[String(process.pid)]).toBe(DT_DIR);
  });

  it.runIf(hasHostProc)('is never what the server starts on', () => {
    // Nothing pinned it in this run, so the first capture is what came up.
    expect(machines().map((machine) => machine.name)).toContain(machines()[0]!.name);
    expect(machines()[0]!.name).not.toBe(HOST_MACHINE);
  });

  it.runIf(hasHostProc)('says why a read of it failed rather than 404ing bare', async () => {
    await switchTo(HOST_MACHINE);
    // Readable only by root on any ordinary machine.
    const response = await fetch(file('/proc/1/smaps'));

    if (response.status === 200) return;
    expect([403, 404]).toContain(response.status);
    expect(await response.text()).toMatch(/cannot read \/proc\/1\/smaps on this computer/);
  });

  it.runIf(hasHostProc)('still refuses a path outside /proc', async () => {
    await switchTo(HOST_MACHINE);
    expect(existsSync('/etc/passwd')).toBe(true);

    const response = await fetch(url(`${API_ROOT}/../etc/passwd`));
    expect(await response.text()).not.toContain('root:');
  });
});
