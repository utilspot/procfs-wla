// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_PREFIX, HOST_ROOT } from '../src/api/paths';
import { DIRECTORY_PAGES, directoryPageUrl, PAGES, pageUrl, PATH_MAX } from '../src/pages';
import {
  ADMIN_DOCUMENT,
  ADMIN_URL,
  ASIDE_DOCUMENTS,
  backendEntryKind,
  DIRECTORY_DOCUMENT,
  DOCUMENT,
  DOCUMENTS,
  documentAtBase,
  documentForPath,
  documentForPathAsync,
  documentForUrl,
  fileForAssetUrl,
  hostEntryKind,
  isAdminRequest,
  FILE_DOCUMENT,
  trailingSlashRedirect,
  type EntryKind,
} from './document';

/**
 * The base is where the listing is published, so a request for it is served
 * that document where it stands rather than moved on to `/proc/index.html` —
 * a URL nothing advertises and nothing links to.
 */
describe('documentAtBase', () => {
  it('serves the listing at the root', () => {
    expect(documentAtBase('/', '/')).toBe(`/${DOCUMENT}`);
  });

  it('serves it at the base path', () => {
    expect(documentAtBase('/proc/', '/proc/')).toBe(`/proc/${DOCUMENT}`);
    // Vite strips the base before plugin middlewares in some servers.
    expect(documentAtBase('/', '/proc/')).toBe(`/proc/${DOCUMENT}`);
  });

  it('keeps the query string', () => {
    expect(documentAtBase('/?view=raw', '/')).toBe(`/${DOCUMENT}?view=raw`);
  });

  it('leaves every other request alone', () => {
    expect(documentAtBase(`/${DOCUMENT}`, '/')).toBeNull();
    expect(documentAtBase('/0/api/file/cpuinfo', '/')).toBeNull();
    expect(documentAtBase('/proc/cpuinfo-abc123.js', '/proc/')).toBeNull();
    expect(documentAtBase('/manifest.json', '/')).toBeNull();
    // The slash matters: without it the request is redirected, not served.
    expect(documentAtBase('/proc', '/proc/')).toBeNull();
  });

  it('does not treat a lookalike prefix as the base', () => {
    expect(documentAtBase('/procfs', '/proc/')).toBeNull();
    expect(documentAtBase('/procfs/', '/proc/')).toBeNull();
  });
});

/**
 * The listing's links are relative — `cpuinfo`, `12282/status` — so from
 * `/proc` they would resolve against the server's root, a directory too high.
 * The slash is what makes the base a directory to a browser.
 */
describe('trailingSlashRedirect', () => {
  it('adds the slash the base needs', () => {
    expect(trailingSlashRedirect('/proc', '/proc/')).toBe('/proc/');
    expect(trailingSlashRedirect('/proc?view=raw', '/proc/')).toBe('/proc/?view=raw');
  });

  it('leaves a request that already has it alone', () => {
    expect(trailingSlashRedirect('/proc/', '/proc/')).toBeNull();
  });

  /** At the root there is no slash to add: `/` is already the base. */
  it('has nothing to do at the root', () => {
    expect(trailingSlashRedirect('/', '/')).toBeNull();
    expect(trailingSlashRedirect('', '/')).toBeNull();
  });

  it('leaves every other request alone', () => {
    expect(trailingSlashRedirect('/proc/cpuinfo', '/proc/')).toBeNull();
    expect(trailingSlashRedirect('/procfs', '/proc/')).toBeNull();
  });
});

/**
 * A page for a file belonging to a process is served at the URL that names the
 * process, which is where the page reads it from. One document answers for
 * every process, so the URL has to be mapped back to it.
 */
describe('documentForUrl', () => {
  it('maps a URL naming a process to the document behind it', () => {
    expect(documentForUrl('/12282/smaps', '/')).toBe('/pid/smaps.html');
    expect(documentForUrl('/self/status', '/')).toBe('/pid/status.html');
    expect(documentForUrl('/thread-self/limits', '/')).toBe('/pid/limits.html');
    // The dev and preview servers serve a page at its own file name too.
    expect(documentForUrl('/12282/smaps.html', '/')).toBe('/pid/smaps.html');
  });

  it('maps it behind a base', () => {
    expect(documentForUrl('/proc/12282/smaps', '/proc/')).toBe('/proc/pid/smaps.html');
    // Vite strips the base before plugin middlewares in some servers.
    expect(documentForUrl('/12282/smaps', '/proc/')).toBe('/proc/pid/smaps.html');
  });

  it('keeps a query string it was given', () => {
    expect(documentForUrl('/12282/smaps?view=raw', '/')).toBe('/pid/smaps.html?view=raw');
  });

  /**
   * Any one segment does. Which processes exist is the backend's business: the
   * page loads, asks for the path its URL spells, and reports the 404 if there
   * is one — a better answer than a blank 404 from this side. The document's
   * own URL goes through the same rule and lands on itself.
   */
  it('serves the page whatever the segment is', () => {
    expect(documentForUrl('/root/smaps', '/')).toBe('/pid/smaps.html');
    expect(documentForUrl('/0/smaps', '/')).toBe('/pid/smaps.html');
    expect(documentForUrl('/pid/smaps', '/')).toBe('/pid/smaps.html');
    expect(documentForUrl('/pid/smaps.html', '/')).toBe('/pid/smaps.html');
  });

  /**
   * The other page whose URL names its file: one document for the twelve
   * `ucount` limits, which reads whichever of them its own URL names.
   */
  it('maps a URL naming a ucount limit to the one document behind the twelve', () => {
    expect(documentForUrl('/sys/user/max_ipc_namespaces', '/')).toBe('/sys/user/limit.html');
    expect(documentForUrl('/sys/user/max_fanotify_marks', '/')).toBe('/sys/user/limit.html');
    expect(documentForUrl('/sys/user/max_ipc_namespaces.html', '/')).toBe('/sys/user/limit.html');
    expect(documentForUrl('/proc/sys/user/max_ipc_namespaces', '/proc/')).toBe(
      '/proc/sys/user/limit.html',
    );
  });

  /**
   * And the same for the memory manager's knobs: one document for the fifty,
   * which reads whichever of them its own URL names.
   */
  it('maps a URL naming a vm tunable to the one document behind them', () => {
    expect(documentForUrl('/sys/vm/swappiness', '/')).toBe('/sys/vm/parameter.html');
    expect(documentForUrl('/sys/vm/dirty_ratio', '/')).toBe('/sys/vm/parameter.html');
    expect(documentForUrl('/sys/vm/swappiness.html', '/')).toBe('/sys/vm/parameter.html');
    expect(documentForUrl('/proc/sys/vm/swappiness', '/proc/')).toBe(
      '/proc/sys/vm/parameter.html',
    );
    // A knob this app has no facts for is left to the raw page, as is the
    // document's own name and the directory itself.
    expect(documentForUrl('/sys/vm/nr_pdflush_threads', '/')).toBeNull();
    expect(documentForUrl('/sys/vm/parameter', '/')).toBeNull();
    expect(documentForUrl('/sys/vm/', '/')).toBeNull();
  });

  /**
   * Unlike a process, the twelve names are known here — so a thirteenth one a
   * later kernel adds is left to `documentForPath`, which hands a file with no
   * page here to the raw page rather than to a page with nothing to say about
   * it. The document's own name is one of those.
   */
  it('claims only the names /proc/sys/user actually has', () => {
    expect(documentForUrl('/sys/user/max_thirteenth_namespaces', '/')).toBeNull();
    expect(documentForUrl('/sys/user/max_pid_namespace', '/')).toBeNull();
    expect(documentForUrl('/sys/user/limit', '/')).toBeNull();
    expect(documentForUrl('/sys/user/', '/')).toBeNull();
    // Not the directory above it, and not the same name one directory over.
    expect(documentForUrl('/sys/kernel/max_ipc_namespaces', '/')).toBeNull();
  });

  /** A URL whose last segment is no page of this app's is not one of its URLs. */
  it('leaves every other request alone', () => {
    expect(documentForUrl('/12282/nosuchfile', '/')).toBeNull();
    expect(documentForUrl('/12282/task/12283/smaps', '/')).toBeNull();
    expect(documentForUrl('/smaps', '/')).toBeNull();
  });

  /** A page's assets sit beside it, and a hashed name is not a process page. */
  it('leaves a page’s own assets alone', () => {
    expect(documentForUrl('/pid/smaps-CMwOulyt.js', '/')).toBeNull();
    expect(documentForUrl('/pid/smaps-DBe5d3Po.css', '/')).toBeNull();
    expect(documentForUrl('/cpuinfo-CMwOulyt.js', '/')).toBeNull();
  });

  /** `/proc/stat` and `/proc/<pid>/stat` are different files with different pages. */
  it('does not take a page of the machine’s for one of a process’s', () => {
    expect(documentForUrl('/stat', '/')).toBeNull();
    expect(documentForUrl('/cmdline', '/')).toBeNull();
    expect(documentForUrl('/12282/stat', '/')).toBe('/pid/stat.html');
    expect(documentForUrl('/12282/cmdline', '/')).toBe('/pid/cmdline.html');
  });
});

/**
 * A `/proc` entry this app publishes no page for is served one of the two
 * fallbacks, and **what is at that path decides which**: a directory gets the
 * listing page, a file the raw one, and a path that is not there gets nothing.
 *
 * The lookup is injected here, so what is being tested is the decision rather
 * than the machine the tests happen to run on.
 */
describe('documentForPath', () => {
  /** Stands in for `/proc`: a couple of directories and a couple of files. */
  const PROC: Record<string, EntryKind> = {
    '/proc/sys': 'directory',
    '/proc/12282': 'directory',
    '/proc/12282/net': 'directory',
    '/proc/12282/net/dev_snmp6': 'directory',
    '/proc/sys/user': 'directory',
    '/proc/sys/vm': 'directory',
    '/proc/kmsg': 'file',
    '/proc/sysrq-trigger': 'file',
    '/proc/self/mountstats': 'file',
    '/proc/bus/pci/00/1f.3': 'file',
  };
  const kindOf = (path: string): EntryKind | null => PROC[path] ?? null;
  const document = (url: string, base = '/') => documentForPath(url, base, kindOf);

  it('serves the listing page for a directory', () => {
    expect(document('/sys/')).toBe(`/${DIRECTORY_DOCUMENT}`);
    expect(document('/12282/')).toBe(`/${DIRECTORY_DOCUMENT}`);
    // Any depth: the page lists whatever its URL spells.
    expect(document('/12282/net/dev_snmp6/')).toBe(`/${DIRECTORY_DOCUMENT}`);
  });

  /**
   * One directory has a page of its own — it names what the twelve `ucount`
   * limits in it bound — so the lookup that decides between the two fallbacks
   * decides this too.
   */
  it('serves a directory’s own page where there is one', () => {
    expect(document('/sys/user/')).toBe('/sys/user/index.html');
    expect(document('/sys/user')).toBe('/sys/user/index.html');
    expect(document('/proc/sys/user/', '/proc/')).toBe('/proc/sys/user/index.html');
    expect(document('/sys/user/?x=1')).toBe('/sys/user/index.html?x=1');
    // And the other one, the memory manager's own directory.
    expect(document('/sys/vm/')).toBe('/sys/vm/index.html');
    expect(document('/sys/vm')).toBe('/sys/vm/index.html');
    // The directory above them has no page of its own and is listed as ever.
    expect(document('/sys/')).toBe(`/${DIRECTORY_DOCUMENT}`);
  });

  it('serves the raw page for a file', () => {
    expect(document('/kmsg')).toBe(`/${FILE_DOCUMENT}`);
    expect(document('/sysrq-trigger')).toBe(`/${FILE_DOCUMENT}`);
    expect(document('/self/mountstats')).toBe(`/${FILE_DOCUMENT}`);
    // Including one whose name carries a dot, which no rule here has to guess at.
    expect(document('/bus/pci/00/1f.3')).toBe(`/${FILE_DOCUMENT}`);
  });

  /** Nothing at that path means nothing to serve: the request 404s as before. */
  it('serves nothing for a path that is not there', () => {
    expect(document('/nosuchthing')).toBeNull();
    expect(document('/nosuchthing/')).toBeNull();
    expect(document('/12282/nosuchfile')).toBeNull();
  });

  /**
   * The trailing slash a directory is linked with makes the next listing's
   * relative links resolve inside it; it is not part of the path being asked
   * about, so either spelling finds the same entry.
   */
  it('asks about the same path with or without the trailing slash', () => {
    expect(document('/sys')).toBe(`/${DIRECTORY_DOCUMENT}`);
    expect(document('/sys/')).toBe(`/${DIRECTORY_DOCUMENT}`);
  });

  it('maps it behind a base', () => {
    expect(document('/proc/sys/', '/proc/')).toBe(`/proc/${DIRECTORY_DOCUMENT}`);
    expect(document('/proc/kmsg', '/proc/')).toBe(`/proc/${FILE_DOCUMENT}`);
    // Vite strips the base before plugin middlewares in some servers.
    expect(document('/kmsg', '/proc/')).toBe(`/proc/${FILE_DOCUMENT}`);
  });

  it('keeps a query string it was given', () => {
    expect(document('/kmsg?x=1')).toBe(`/${FILE_DOCUMENT}?x=1`);
    expect(document('/sys/?x=1')).toBe(`/${DIRECTORY_DOCUMENT}?x=1`);
  });

  /** A page of this app's own answers for itself, whichever kind it is. */
  it('leaves the app’s own pages alone', () => {
    expect(document('/cpuinfo')).toBeNull();
    expect(document('/index.html')).toBeNull();
    expect(document(`/${ADMIN_DOCUMENT}`)).toBeNull();
    expect(document(`/${DIRECTORY_DOCUMENT}`)).toBeNull();
    expect(document(`/${FILE_DOCUMENT}`)).toBeNull();
    // A file belonging to a process, at any URL that names one.
    expect(document('/12282/status')).toBeNull();
    expect(document('/self/smaps')).toBeNull();
  });

  /** The base itself, and the base without the slash it is redirected to. */
  it('leaves the base alone', () => {
    expect(document('/')).toBeNull();
    expect(document('/proc/', '/proc/')).toBeNull();
    expect(document('/proc', '/proc/')).toBeNull();
  });

  /**
   * Everything the backend answers is its own, and its listing endpoint ends in
   * a slash like a directory does. This middleware runs before the dev server's
   * proxy, so a listing request taken for a page URL here would never reach the
   * backend at all.
   */
  it('leaves the backend’s own URLs alone', () => {
    expect(document('/0/api/dir/')).toBeNull();
    expect(document('/0/api/dir/12282/')).toBeNull();
    expect(document('/0/api/file/kmsg')).toBeNull();
    expect(document('/proc/0/api/dir/', '/proc/')).toBeNull();
  });

  /**
   * The app's own files and the dev server's are not asked about either: a
   * hashed asset is not a path under `/proc`, and `isReadablePath` refuses the
   * spellings Vite uses before any lookup happens.
   */
  it('leaves the app’s own files and Vite’s alone', () => {
    expect(document('/cpuinfo-CMwOulyt.js')).toBeNull();
    expect(document('/dir-CMwOulyt.js')).toBeNull();
    expect(document('/admin-CMwOulyt.js')).toBeNull();
    expect(document('/manifest.json')).toBeNull();
    expect(document('/@vite/client')).toBeNull();
    expect(document('/@react-refresh')).toBeNull();
    expect(document('/src/RawApp.tsx')).toBeNull();
  });

  /** The one check standing between a URL and the lookup. */
  it('refuses a path it would not read', () => {
    const asked: string[] = [];
    const record = (path: string): EntryKind | null => {
      asked.push(path);
      return null;
    };

    expect(documentForPath('/../etc/passwd', '/', record)).toBeNull();
    expect(documentForPath('/./kmsg', '/', record)).toBeNull();
    expect(documentForPath(`/${'x'.repeat(PATH_MAX)}`, '/', record)).toBeNull();
    expect(asked).toEqual([]);
  });
});

/**
 * The lookup itself, against the machine the tests are running on. Everything
 * above it is a decision; this is the one part that touches a filesystem.
 */
describe.runIf(existsSync(HOST_ROOT))('hostEntryKind', () => {
  it('tells a directory from a file', () => {
    expect(hostEntryKind(`${HOST_ROOT}/sys`)).toBe('directory');
    expect(hostEntryKind(`${HOST_ROOT}/self`)).toBe('directory');
    expect(hostEntryKind(`${HOST_ROOT}/cpuinfo`)).toBe('file');
    expect(hostEntryKind(`${HOST_ROOT}/self/status`)).toBe('file');
  });

  /** `/proc/self` is a symbolic link, and what it points at is the answer. */
  it('follows a link to what it names', () => {
    expect(hostEntryKind(`${HOST_ROOT}/self/cwd`)).toBe('directory');
  });

  it('has no answer for what is not there', () => {
    expect(hostEntryKind(`${HOST_ROOT}/nosuchthing`)).toBeNull();
    expect(hostEntryKind(`${HOST_ROOT}/dir.html`)).toBeNull();
  });
});

/**
 * The dev and preview servers are not the machine they serve: the pages read a
 * captured `/proc` out of the test server, and Vite is running on somebody's
 * laptop. So the lookup behind the two fallback pages is a **request** there
 * rather than a `stat`, and these are the two halves of that.
 */
describe('documentForPathAsync', () => {
  /**
   * A machine with a directory no ordinary Linux has, which is the case the
   * host lookup gets wrong: `/proc/uid_io` is an Android kernel's, so a laptop
   * running the dev server has none and would answer for the wrong computer.
   */
  const MACHINE: Record<string, EntryKind> = {
    '/proc/uid_io': 'directory',
    '/proc/sys': 'directory',
    '/proc/sys/user': 'directory',
    '/proc/kmsg': 'file',
  };
  const kindOf = async (path: string): Promise<EntryKind | null> => MACHINE[path] ?? null;
  const document = (url: string, base = '/') => documentForPathAsync(url, base, kindOf);

  it('serves the listing page for a directory only the served machine has', async () => {
    await expect(document('/uid_io/')).resolves.toBe(`/${DIRECTORY_DOCUMENT}`);
    await expect(document('/sys/')).resolves.toBe(`/${DIRECTORY_DOCUMENT}`);
  });

  it('serves the raw page for a file', async () => {
    await expect(document('/kmsg')).resolves.toBe(`/${FILE_DOCUMENT}`);
  });

  /** A directory with a page of its own still gets it rather than the listing. */
  it('hands a directory with a page of its own that page', async () => {
    await expect(document('/sys/user/')).resolves.toBe('/sys/user/index.html');
  });

  it('leaves alone everything the synchronous one does', async () => {
    // This app's own pages, the app's own directory, and nothing at all.
    await expect(document('/uid_io/stats')).resolves.toBeNull();
    await expect(document('/0/api/dir/uid_io')).resolves.toBeNull();
    await expect(document('/nosuchthing/')).resolves.toBeNull();
    await expect(document('/')).resolves.toBeNull();
  });

  it('keeps a query string on the rewrite', async () => {
    await expect(document('/uid_io/?raw=1')).resolves.toBe(`/${DIRECTORY_DOCUMENT}?raw=1`);
  });

  /** The lookup is the expensive half, so a URL that is answered never makes it. */
  it('asks nothing about a URL this app already answers', async () => {
    const asked: string[] = [];
    const spy = async (path: string): Promise<EntryKind | null> => {
      asked.push(path);
      return null;
    };

    await documentForPathAsync('/uid_io/stats', '/', spy);
    await documentForPathAsync('/0/uid_io/stats-DiIgG7M9.js', '/', spy);
    expect(asked).toEqual([]);

    await documentForPathAsync('/uid_io/', '/', spy);
    expect(asked).toEqual(['/proc/uid_io']);
  });
});

describe('backendEntryKind', () => {
  /** Stands in for the test server: the two endpoints the pages themselves read. */
  function mockBackend(entries: Record<string, EntryKind>) {
    return vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      const dir = url.pathname.startsWith('/0/api/dir/');
      const path = `${HOST_ROOT}/${url.pathname.slice(dir ? '/0/api/dir/'.length : '/0/api/file/'.length)}`;
      const kind = entries[path];

      return new Response('', {
        status: kind === (dir ? 'directory' : 'file') ? 200 : 404,
      });
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a directory off the listing endpoint and a file off the other', async () => {
    vi.stubGlobal('fetch', mockBackend({ '/proc/uid_io': 'directory', '/proc/kmsg': 'file' }));
    const kindOf = backendEntryKind('http://localhost:3001');

    await expect(kindOf('/proc/uid_io')).resolves.toBe('directory');
    await expect(kindOf('/proc/kmsg')).resolves.toBe('file');
  });

  it('has no answer for a path the machine does not have', async () => {
    vi.stubGlobal('fetch', mockBackend({ '/proc/uid_io': 'directory' }));

    await expect(backendEntryKind('http://localhost:3001')('/proc/nothing')).resolves.toBeNull();
  });

  /** A directory settles it without the file endpoint being asked at all. */
  it('asks the file endpoint only where the listing one said no', async () => {
    const fetched = mockBackend({ '/proc/uid_io': 'directory' });
    vi.stubGlobal('fetch', fetched);
    const kindOf = backendEntryKind('http://localhost:3001');

    await kindOf('/proc/uid_io');
    expect(fetched).toHaveBeenCalledTimes(1);

    await kindOf('/proc/nothing');
    expect(fetched).toHaveBeenCalledTimes(3);
  });

  /** Nothing to serve and nothing to say: the request 404s as it would have. */
  it('has no answer where the server is not up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(backendEntryKind('http://localhost:3001')('/proc/uid_io')).resolves.toBeNull();
  });
});

/**
 * Every document loads its own mount script, and **the URL it is served at is
 * not always where the file is**: `pid/cmdline.html` answers at
 * `/12282/cmdline`, `sys/user/limit.html` at `/sys/user/max_ipc_namespaces`.
 * A relative `src` is resolved by the browser against the URL, so on those
 * pages it asks for a script that is not there — the page loads, the script
 * 404s, and what the reader gets is a blank page.
 *
 * The build hides this: Rollup rewrites every `src` to the hashed file it
 * emitted, so only the dev server shows it. Hence this, which reads the
 * documents themselves.
 */
describe('the script each document loads', () => {
  const PAGES_ROOT = fileURLToPath(new URL('../src/pages/', import.meta.url));

  /** The `src` of the module script, as the document spells it. */
  function scriptSrc(document: string): string {
    const html = readFileSync(join(PAGES_ROOT, document), 'utf8');
    const src = /<script type="module" src="([^"]+)"/.exec(html);

    expect(src, `${document} loads no module script`).not.toBeNull();
    return src![1]!;
  }

  /**
   * URLs the document answers at, worst case included: a process page is served
   * at the URL naming a process rather than at its own name, and the two
   * fallbacks answer at any depth at all.
   */
  function servedAt(document: string): string[] {
    if (document === DOCUMENT) return ['/'];
    if (document === ADMIN_DOCUMENT) return [`/${ADMIN_URL}`, `/${ADMIN_URL.replace(/\.html$/, '')}`];
    // `dir.html` and `file.html` answer for whatever entry the URL names.
    if (ASIDE_DOCUMENTS.includes(document)) return ['/kmsg', '/sys/', '/12282/net/dev_snmp6/'];

    const directory = DIRECTORY_PAGES.find((candidate) => candidate.document === document);
    if (directory !== undefined) return [`/${directoryPageUrl(directory)}`];

    const page = PAGES.find((candidate) => candidate.document === document);
    if (page === undefined) return [`/${document.replace(/\.html$/, '')}`];

    const values = page.parameter?.values;
    const value = values === undefined ? '12282' : values[0]!;
    return [`/${pageUrl(page)}`, `/${pageUrl(page, value)}`, `/${document}`];
  }

  it.each([...DOCUMENTS, ADMIN_DOCUMENT])(
    '%s asks for one script, and one that is there, from every URL it answers',
    (document) => {
      const src = scriptSrc(document);

      // What the browser would ask for, given that page at each of its URLs.
      const asked = new Set(
        servedAt(document).map((url) => new URL(src, `http://localhost${url}`).pathname),
      );

      // A relative src only holds where every URL sits at the file's own depth;
      // `pid/cmdline.html` answers at `/12282/cmdline` and needs an absolute one.
      expect([...asked], `${document} resolves ${src} differently per URL`).toHaveLength(1);

      // The name need not match the document — `cpuinfo.html` loads `main.tsx`,
      // which is the scaffold's name and still the file — but it has to be a file.
      const file = join(PAGES_ROOT, [...asked][0]!.slice(1));
      expect(existsSync(file), `${document} loads ${src}, which is not a file`).toBe(true);
    },
  );
});

/**
 * What a page loads is asked for under `0/` and kept without it — a corner of
 * the URL space `/proc` can never reach into, over files the build left where
 * they were. The manifest gives a deployed server both halves; the preview
 * server serves the output directory by path, so it is told here.
 */
describe('fileForAssetUrl', () => {
  it('maps an asset URL to the file behind it', () => {
    expect(fileForAssetUrl('/0/cpuinfo-CMwOulyt.js', '/')).toBe('/cpuinfo-CMwOulyt.js');
    expect(fileForAssetUrl('/0/cpuinfo-DBe5d3Po.css', '/')).toBe('/cpuinfo-DBe5d3Po.css');
    // A page kept in a directory keeps it: only the `0/` in front comes off.
    expect(fileForAssetUrl('/0/pid/smaps-CppHR6Xo.js', '/')).toBe('/pid/smaps-CppHR6Xo.js');
  });

  it('maps it behind a base', () => {
    expect(fileForAssetUrl('/proc/0/cpuinfo-CMwOulyt.js', '/proc/')).toBe(
      '/proc/cpuinfo-CMwOulyt.js',
    );
    // Vite strips the base before plugin middlewares in some servers.
    expect(fileForAssetUrl('/0/cpuinfo-CMwOulyt.js', '/proc/')).toBe('/proc/cpuinfo-CMwOulyt.js');
  });

  it('keeps a query string it was given', () => {
    expect(fileForAssetUrl('/0/cpuinfo-CMwOulyt.js?v=1', '/')).toBe('/cpuinfo-CMwOulyt.js?v=1');
  });

  it('leaves every other request alone', () => {
    expect(fileForAssetUrl('/cpuinfo-CMwOulyt.js', '/')).toBeNull();
    expect(fileForAssetUrl('/0/', '/')).toBeNull();
    expect(fileForAssetUrl('/0', '/')).toBeNull();
    expect(fileForAssetUrl('/', '/')).toBeNull();
    expect(fileForAssetUrl('/cpuinfo', '/')).toBeNull();
    // `/proc/0` is a path a URL may name; `/0/` in front of a file is not it.
    expect(fileForAssetUrl('/01/cmdline', '/')).toBeNull();
  });

  /**
   * The backend's routes are under `0/` too — one namespace for everything that
   * is not a `/proc` entry — so they have to be turned down here rather than
   * rewritten into a file the build never emitted. Every server dispatching on
   * `/0/` owes them the same precedence.
   */
  it('leaves the backend’s own routes alone', () => {
    expect(fileForAssetUrl(`${API_PREFIX}/file/cpuinfo`, '/')).toBeNull();
    expect(fileForAssetUrl(`${API_PREFIX}/file/1234/smaps`, '/')).toBeNull();
    expect(fileForAssetUrl(`${API_PREFIX}/dir/`, '/')).toBeNull();
    expect(fileForAssetUrl(API_PREFIX, '/')).toBeNull();
    expect(fileForAssetUrl(`/proc${API_PREFIX}/file/cpuinfo`, '/proc/')).toBeNull();

    // A built file whose name merely starts the same way is still an asset.
    expect(fileForAssetUrl('/0/apiary-CMwOulyt.js', '/')).toBe('/apiary-CMwOulyt.js');
  });
});

describe('isAdminRequest', () => {
  /**
   * Where it is published. With debug off this is the spelling anyone who has
   * the link will use, so it is the one that has to be refused.
   */
  it('recognises the admin page at the URL it is served at', () => {
    expect(ADMIN_URL).toBe('0/admin.html');

    expect(isAdminRequest(`/${ADMIN_URL}`, '/')).toBe(true);
    expect(isAdminRequest(`/proc/${ADMIN_URL}`, '/proc/')).toBe(true);
    // Vite may have stripped the base already.
    expect(isAdminRequest(`/${ADMIN_URL}`, '/proc/')).toBe(true);
    expect(isAdminRequest(`/${ADMIN_URL}?x=1`, '/')).toBe(true);
  });

  /**
   * And at the file's own name, which is what `fileForAssetUrl` rewrites the
   * URL above to, and what the dev server would serve out of `src/pages/` on
   * its own. Refusing only the published spelling would leave this one open.
   */
  it('recognises it at the bare file name too', () => {
    expect(isAdminRequest(`/${ADMIN_DOCUMENT}`, '/')).toBe(true);
    expect(isAdminRequest(`/proc/${ADMIN_DOCUMENT}`, '/proc/')).toBe(true);
    expect(isAdminRequest(`/${ADMIN_DOCUMENT}?x=1`, '/')).toBe(true);

    expect(fileForAssetUrl(`/${ADMIN_URL}`, '/')).toBe(`/${ADMIN_DOCUMENT}`);
  });

  /**
   * And without the extension. The static server under `vite preview` finds
   * `admin.html` for `/admin`, the same resolution that serves every page at
   * `/cpuinfo` — so a debug build served with debug off would otherwise hand
   * the page out at a spelling this app never writes down.
   */
  it('recognises it without the .html, which a static server resolves anyway', () => {
    expect(isAdminRequest('/0/admin', '/')).toBe(true);
    expect(isAdminRequest('/admin', '/')).toBe(true);
    expect(isAdminRequest('/proc/0/admin', '/proc/')).toBe(true);
    expect(isAdminRequest('/proc/admin', '/proc/')).toBe(true);
  });

  it('leaves the cpuinfo page and its assets alone', () => {
    expect(isAdminRequest(`/${DOCUMENT}`, '/')).toBe(false);
    expect(isAdminRequest('/admin-abc123.js', '/')).toBe(false);
    expect(isAdminRequest('/0/admin-abc123.js', '/')).toBe(false);
    expect(isAdminRequest('/0/api/file/cpuinfo', '/')).toBe(false);
  });
});
