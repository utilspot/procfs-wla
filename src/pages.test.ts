import { describe, expect, it } from 'vitest';
import {
  crumbsFor,
  hostPath,
  isParameterized,
  isReadablePath,
  answersPath,
  DIRECTORY_PAGES,
  directoryDocumentFor,
  directoryPageFor,
  directoryPageUrl,
  isValidValue,
  pageFor,
  PAGES,
  pageUrl,
  pathPattern,
  PATH_MAX,
  PID,
  resolveEntry,
  resolvePath,
  serverHome,
  valueInPath,
  type Page,
} from './pages';

const smaps = pageFor('pid/smaps.html');
const cpuinfo = pageFor('cpuinfo.html');
/** The other page whose URL names its file: one document for the twelve. */
const ucount = pageFor('sys/user/limit.html');
/** And the memory manager's, whose fifty names are written down the same way. */
const vm = pageFor('sys/vm/parameter.html');

describe('the pages', () => {
  it('name each document once', () => {
    const documents = PAGES.map((page) => page.document);

    expect(new Set(documents).size).toBe(documents.length);
  });

  it('read each path once', () => {
    const paths = PAGES.map((page) => page.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  /** A page whose path has a placeholder must say what fills it. */
  it('give every placeholder a parameter to fill it', () => {
    for (const page of PAGES) {
      expect(/\{\w+\}/.test(page.path), page.path).toBe(isParameterized(page));
    }
  });
});

describe('hostPath', () => {
  it('leaves a fixed path alone', () => {
    expect(hostPath(cpuinfo)).toBe('/proc/cpuinfo');
    expect(hostPath(cpuinfo, '1234')).toBe('/proc/cpuinfo');
  });

  it('fills the placeholder with the value given', () => {
    expect(hostPath(smaps, '1234')).toBe('/proc/1234/smaps');
    expect(hostPath(smaps, 'self')).toBe('/proc/self/smaps');
  });

  it('falls back where no value was given', () => {
    expect(hostPath(smaps)).toBe('/proc/self/smaps');
  });

  /**
   * The value arrives from a query string and ends up in a URL path, so a
   * rejected one must not reach it — the fallback is used instead.
   */
  it('refuses a value that is not a process, rather than pasting it in', () => {
    for (const value of ['../../etc/passwd', 'self/../..', '0', '-1', '', 'root']) {
      expect(hostPath(smaps, value), value).toBe('/proc/self/smaps');
    }
  });
});

describe('isValidValue', () => {
  it('takes a pid, or the kernel’s own names for one', () => {
    expect(isValidValue(smaps, '1')).toBe(true);
    expect(isValidValue(smaps, '12282')).toBe(true);
    expect(isValidValue(smaps, 'self')).toBe(true);
    expect(isValidValue(smaps, 'thread-self')).toBe(true);
  });

  it('takes nothing else', () => {
    for (const value of ['0', '-1', '01', '1.5', 'root', '..', 'self ', '', '12345678']) {
      expect(isValidValue(smaps, value), value).toBe(false);
    }
    expect(PID.test('9999999')).toBe(true);
  });

  it('is false for a page with no parameter at all', () => {
    expect(isValidValue(cpuinfo, '1234')).toBe(false);
  });

  /**
   * `/proc/sys/user` holds the names the kernel's `user_table` declares and
   * nothing else, so that page is answered from the list rather than by shape.
   */
  it('takes one of the names a page writes down, and no other', () => {
    expect(isValidValue(ucount, 'max_user_namespaces')).toBe(true);
    expect(isValidValue(ucount, 'max_fanotify_marks')).toBe(true);

    for (const value of ['max_pid_namespace', 'file', '1234', 'self', '..', '']) {
      expect(isValidValue(ucount, value), value).toBe(false);
    }
  });
});

/**
 * Every page's path comes from its URL, so this is the one check standing
 * between a URL and a request.
 */
describe('isReadablePath', () => {
  it('takes a file under /proc, however deep', () => {
    expect(isReadablePath('/proc/cpuinfo')).toBe(true);
    expect(isReadablePath('/proc/kmsg')).toBe(true);
    expect(isReadablePath('/proc/self/mountinfo')).toBe(true);
    expect(isReadablePath('/proc/1234/task/1235/stat')).toBe(true);
    expect(isReadablePath('/proc/sys/kernel/osrelease')).toBe(true);
  });

  it('takes the punctuation /proc really uses in a name', () => {
    expect(isReadablePath('/proc/key-users')).toBe(true);
    expect(isReadablePath('/proc/latency_stats')).toBe(true);
    expect(isReadablePath('/proc/driver/rtc')).toBe(true);
  });

  /** The path ends up in a request, so nothing that walks out of /proc gets in. */
  it('refuses anything that could walk out of /proc', () => {
    for (const path of [
      '/proc/../etc/passwd',
      '/proc/..',
      '/proc/./cpuinfo',
      '/proc/self/../../etc/shadow',
      '/etc/passwd',
      '/proc',
      '/proc/',
      '/procfs/cpuinfo',
      '//proc/cpuinfo',
      '',
    ]) {
      expect(isReadablePath(path), path).toBe(false);
    }
  });

  it('refuses a path with something other than a path in it', () => {
    for (const path of [
      '/proc/cpuinfo?x=1',
      '/proc/cpuinfo#f',
      '/proc/cpu info',
      '/proc/cpuinfo\n/proc/mounts',
      'http://elsewhere/proc/cpuinfo',
    ]) {
      expect(isReadablePath(path), path).toBe(false);
    }
  });

  it('refuses one longer than anything under /proc could be', () => {
    expect(isReadablePath(`/proc/${'a'.repeat(PATH_MAX)}`)).toBe(false);
    expect(PATH_MAX).toBeGreaterThan(64);
  });
});

describe('valueInPath', () => {
  it('gives back the value that filled the placeholder', () => {
    expect(valueInPath(smaps, '/proc/12282/smaps')).toBe('12282');
    expect(valueInPath(smaps, '/proc/self/smaps')).toBe('self');
  });

  it('has nothing to give back for a page with no placeholder', () => {
    expect(valueInPath(cpuinfo, '/proc/cpuinfo')).toBeNull();
  });

  it('has nothing to give back for a path the page does not read', () => {
    expect(valueInPath(smaps, '/proc/cpuinfo')).toBeNull();
  });

  it('gives back the limit two directories down', () => {
    expect(valueInPath(ucount, '/proc/sys/user/max_ipc_namespaces')).toBe('max_ipc_namespaces');
    expect(valueInPath(ucount, '/proc/sys/user')).toBeNull();
    expect(valueInPath(ucount, '/proc/sys/user/max_ipc_namespaces/x')).toBeNull();
  });
});

/** Which page answers for a path, which is what the servers route by. */
describe('answersPath', () => {
  it('claims every value for a page that writes none of them down', () => {
    expect(answersPath(smaps, '/proc/12282/smaps')).toBe(true);
    expect(answersPath(smaps, '/proc/self/smaps')).toBe(true);
    // Which processes exist is the backend's answer to give, not this app's.
    expect(answersPath(smaps, '/proc/root/smaps')).toBe(true);
    expect(answersPath(smaps, '/proc/12282/status')).toBe(false);
  });

  /**
   * The twelve are known here, so a thirteenth name a later kernel adds under
   * `/proc/sys/user` is not this page's — it is a file with no page here, and
   * the raw page is what answers for those.
   */
  it('claims only the names a page writes down', () => {
    expect(answersPath(ucount, '/proc/sys/user/max_ipc_namespaces')).toBe(true);
    expect(answersPath(ucount, '/proc/sys/user/max_thirteenth_namespaces')).toBe(false);
    expect(answersPath(ucount, '/proc/sys/user/limit')).toBe(false);
  });

  it('claims the vm knobs it has facts for, and no other name', () => {
    expect(answersPath(vm, '/proc/sys/vm/swappiness')).toBe(true);
    expect(answersPath(vm, '/proc/sys/vm/dirty_ratio')).toBe(true);
    expect(answersPath(vm, '/proc/sys/vm/nr_pdflush_threads')).toBe(false);
    expect(answersPath(vm, '/proc/sys/vm/parameter')).toBe(false);
  });

  it('is false for a page that reads one fixed path', () => {
    expect(answersPath(cpuinfo, '/proc/cpuinfo')).toBe(false);
  });
});

describe('the directory pages', () => {
  it('lists the directory each is the page for', () => {
    expect(directoryPageFor('sys/user/index.html').path).toBe('/proc/sys/user');
    expect(() => directoryPageFor('nothing.html')).toThrow(/no directory page is built as/);
  });

  it('finds the document listing a directory that has one', () => {
    expect(directoryDocumentFor('/proc/sys/user')).toBe('sys/user/index.html');
    expect(directoryDocumentFor('/proc/sys/vm')).toBe('sys/vm/index.html');
    // The slash a directory is linked with is not part of its path.
    expect(directoryDocumentFor('/proc/sys/user/')).toBe('sys/user/index.html');
  });

  /** Every other directory is listed by the page that knows none of them. */
  it('has nothing for a directory with no page of its own', () => {
    expect(directoryDocumentFor('/proc/sys')).toBeUndefined();
    expect(directoryDocumentFor('/proc/12282')).toBeUndefined();
    expect(directoryDocumentFor('/proc')).toBeUndefined();
  });

  it('is served where the directory is, trailing slash and all', () => {
    expect(directoryPageUrl(directoryPageFor('sys/user/index.html'))).toBe('sys/user/');
    expect(directoryPageUrl(directoryPageFor('sys/vm/index.html'))).toBe('sys/vm/');
  });

  it('lists each directory once', () => {
    const paths = DIRECTORY_PAGES.map((page) => page.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  /** A directory page and a file page cannot both claim one path. */
  it('names no path a file page reads', () => {
    for (const directory of DIRECTORY_PAGES) {
      expect(PAGES.some((page) => page.path === directory.path), directory.path).toBe(false);
    }
  });
});

describe('pageFor', () => {
  it('finds the page built as a document', () => {
    expect(pageFor('devices.html').path).toBe('/proc/devices');
    expect(pageFor('pid/smaps.html').path).toBe('/proc/{pid}/smaps');
  });

  it('refuses a document no page is built as', () => {
    expect(() => pageFor('nothing.html')).toThrow(/no page is built as/);
  });
});

describe('pageUrl', () => {
  it('is the document without its extension', () => {
    expect(pageUrl(cpuinfo)).toBe('cpuinfo');
    expect(pageUrl(smaps)).toBe('pid/smaps');
  });

  /** The page reads the process its URL names, so a link carries it there. */
  it('puts a process where the placeholder is spelled out', () => {
    expect(pageUrl(smaps, '12282')).toBe('12282/smaps');
    expect(pageUrl(smaps, 'self')).toBe('self/smaps');
  });

  it('ignores a value the page would not read', () => {
    expect(pageUrl(smaps, '../etc')).toBe('pid/smaps');
    expect(pageUrl(cpuinfo, '12282')).toBe('cpuinfo');
  });

  /**
   * The URL comes out of the *path*, where the placeholder is written down, so
   * it holds for a page whose document does not spell the placeholder out:
   * `sys/user/limit.html` answers at twelve URLs, none of them its own name.
   */
  it('puts a limit where the document names none', () => {
    expect(pageUrl(ucount)).toBe('sys/user/limit');
    expect(pageUrl(ucount, 'max_ipc_namespaces')).toBe('sys/user/max_ipc_namespaces');
    expect(pageUrl(vm, 'swappiness')).toBe('sys/vm/swappiness');
  });

  /** A link to a page is a link to a file it will read, or to nothing. */
  it('falls back rather than linking a value the page refuses', () => {
    expect(pageUrl(ucount, 'max_pid_namespace')).toBe('sys/user/max_user_namespaces');
    expect(pageUrl(smaps, 'root')).toBe('self/smaps');
  });
});

/**
 * A page reads the file its own URL names, so that where a page is served and
 * what it reads are one fact rather than two that have to agree.
 */
describe('resolvePath', () => {
  it('reads the file the URL names', () => {
    expect(resolvePath(cpuinfo, '/devices', '/').path).toBe('/proc/devices');
    expect(resolvePath(smaps, '/12282/smaps', '/').path).toBe('/proc/12282/smaps');
    expect(resolvePath(smaps, '/self/smaps', '/').path).toBe('/proc/self/smaps');
  });

  /** The dev and preview servers still serve a page at its own file name. */
  it('reads the same file at the URL with the extension on', () => {
    expect(resolvePath(cpuinfo, '/devices.html', '/').path).toBe('/proc/devices');
    expect(resolvePath(smaps, '/12282/smaps.html', '/').path).toBe('/proc/12282/smaps');
  });

  it('reads it under a base the app is served from', () => {
    expect(resolvePath(cpuinfo, '/procfs/devices', '/procfs/').path).toBe('/proc/devices');
    expect(resolvePath(smaps, '/procfs/12282/smaps', '/procfs/').path).toBe('/proc/12282/smaps');
    // An absolute base says where the assets come from; only its path applies.
    expect(resolvePath(cpuinfo, '/procfs/devices', 'https://cdn.example.com/procfs/').path).toBe(
      '/proc/devices',
    );
  });

  /**
   * The URL is the path, with no page given a say in it — a page's own
   * published URL is read the same way as any other, so `/pid/smaps` reads
   * `/proc/pid/smaps` because that is what it says.
   */
  it('reads a page’s own published URL as the path it spells', () => {
    expect(resolvePath(smaps, '/pid/smaps', '/').path).toBe('/proc/pid/smaps');
    expect(resolvePath(smaps, '/pid/smaps.html', '/').path).toBe('/proc/pid/smaps');
    expect(resolvePath(cpuinfo, '/cpuinfo', '/').path).toBe('/proc/cpuinfo');
    // Under a base too: `/proc/pid/status` reads /proc/pid/status, which the
    // backend then 404s — not /proc/self/status, which nothing asked for.
    expect(resolvePath(pageFor('pid/status.html'), '/proc/pid/status', '/proc/').path).toBe(
      '/proc/pid/status',
    );
  });

  /**
   * And no page checks the URL against what it was built to parse, so a page
   * hands its view whatever came back — including from a path of another
   * page's shape entirely.
   */
  it('does not hold a page to the path it declares', () => {
    expect(resolvePath(cpuinfo, '/self/status', '/').path).toBe('/proc/self/status');
    expect(resolvePath(smaps, '/devices', '/').path).toBe('/proc/devices');
    expect(resolvePath(smaps, '/1234/task/5678/smaps', '/').path).toBe(
      '/proc/1234/task/5678/smaps',
    );
  });

  /**
   * Which processes exist is the backend's business — `/proc/root/smaps` comes
   * back 404 and the page says so, which is a better answer than this app
   * guessing that no such process could be meant.
   */
  it('leaves it to the backend whether the file is there', () => {
    expect(resolvePath(smaps, '/root/smaps', '/').path).toBe('/proc/root/smaps');
    expect(resolvePath(smaps, '/0/smaps', '/').path).toBe('/proc/0/smaps');
    expect(resolvePath(smaps, '/12345678/smaps', '/').path).toBe('/proc/12345678/smaps');
    // Percent-encoding is left encoded, so it is still one segment here and
    // whatever it decodes to is the backend's to accept or refuse — the mock
    // server checks the segment against its own PID before touching a path.
    expect(resolvePath(smaps, `/${encodeURIComponent('../../etc/passwd')}/smaps`, '/').path).toBe(
      '/proc/..%2F..%2Fetc%2Fpasswd/smaps',
    );
  });

  /** The base is the one URL that names no path; the servers land it here. */
  it('falls back to the declared path at the base itself', () => {
    expect(resolvePath(cpuinfo, '/', '/').path).toBe('/proc/cpuinfo');
    expect(resolvePath(cpuinfo, '/procfs/', '/procfs/').path).toBe('/proc/cpuinfo');
    // A placeholder is filled by its fallback, which is a real path.
    expect(resolvePath(smaps, '/', '/').path).toBe('/proc/self/smaps');
  });

  /**
   * What the app decides is only what it is prepared to *ask* for, which is
   * {@link isReadablePath} — the same check {@link RawApp} makes of the path in
   * its query string. Anything else is refused rather than sent.
   */
  it('refuses a URL naming a path it will not ask for', () => {
    expect(resolvePath(cpuinfo, '/./cpuinfo', '/')).toEqual({
      path: null,
      refused: '/proc/./cpuinfo',
    });
    expect(resolvePath(cpuinfo, '/a/../devices', '/')).toEqual({
      path: null,
      refused: '/proc/a/../devices',
    });
    expect(resolvePath(smaps, '/12282/smaps/../../etc/passwd', '/').path).toBeNull();
    expect(resolvePath(cpuinfo, `/${'x'.repeat(PATH_MAX)}`, '/').path).toBeNull();
  });

  /** The refused path is about to be shown, and it came out of a URL. */
  it('caps the refused path it hands back', () => {
    const long = 'x'.repeat(PATH_MAX * 2);

    expect(resolvePath(smaps, `/${long}/smaps`, '/').refused).toHaveLength(PATH_MAX);
  });
});

/**
 * The listing page follows the same rule as every other: the URL is the path.
 * It declares none of its own, so the URL is all there is to go on.
 */
describe('crumbsFor', () => {
  /** A step is the segment's own name; the slashes are drawn between them. */
  it('breaks a path into the steps above it, the last one going nowhere', () => {
    expect(crumbsFor('/proc/sys/debug/exception-trace', '/')).toEqual([
      { name: 'proc', url: '/' },
      { name: 'sys', url: '/sys/' },
      { name: 'debug', url: '/sys/debug/' },
      { name: 'exception-trace', url: null },
    ]);
  });

  it('carries no separator in a step’s name', () => {
    for (const crumb of crumbsFor('/proc/sys/debug/exception-trace', '/')) {
      expect(crumb.name, crumb.name).not.toContain('/');
    }
  });

  /** A file at the top of `/proc` has one step above it, which is the base. */
  it('leads a top-level file back to the listing of /proc', () => {
    expect(crumbsFor('/proc/cpuinfo', '/')).toEqual([
      { name: 'proc', url: '/' },
      { name: 'cpuinfo', url: null },
    ]);
  });

  it('leads a process’s file back through the process', () => {
    expect(crumbsFor('/proc/12282/status', '/')).toEqual([
      { name: 'proc', url: '/' },
      { name: '12282', url: '/12282/' },
      { name: 'status', url: null },
    ]);
  });

  it('goes nowhere at all from /proc itself, which is where the base lands', () => {
    expect(crumbsFor('/proc', '/')).toEqual([{ name: 'proc', url: null }]);
  });

  /**
   * A directory's URL carries the trailing slash the listing links it with:
   * that is what makes a relative link from there resolve inside it.
   */
  it('links a directory with its trailing slash', () => {
    const crumbs = crumbsFor('/proc/12282/net/dev_snmp6/lo', '/');

    expect(crumbs.map((crumb) => crumb.url)).toEqual([
      '/',
      '/12282/',
      '/12282/net/',
      '/12282/net/dev_snmp6/',
      null,
    ]);
  });

  it('puts the base in front of every step', () => {
    expect(crumbsFor('/proc/tty/drivers', '/procfs/')).toEqual([
      { name: 'proc', url: '/procfs/' },
      { name: 'tty', url: '/procfs/tty/' },
      { name: 'drivers', url: null },
    ]);
  });

  /** An absolute base says where the assets are, not where the pages are. */
  it('takes only the path of an absolute base', () => {
    expect(crumbsFor('/proc/tty/drivers', 'https://cdn.example.com/procfs/')[0]).toEqual({
      name: 'proc',
      url: '/procfs/',
    });
  });

  /** Still the steps of the path, so it reads right — but none is a way in. */
  it('offers no trail out of a path this app would not read', () => {
    expect(crumbsFor('/etc/passwd', '/')).toEqual([
      { name: 'etc', url: null },
      { name: 'passwd', url: null },
    ]);
    expect(crumbsFor('/procfs/cpuinfo', '/')).toEqual([
      { name: 'procfs', url: null },
      { name: 'cpuinfo', url: null },
    ]);
  });
});

/**
 * The one step the trail cannot have: the server above the app, which only
 * exists as a place to go when the app is not itself at the top of it.
 */
describe('serverHome', () => {
  it('is the top of the server when the app is served below it', () => {
    expect(serverHome('/proc/')).toBe('/');
    expect(serverHome('/procfs/')).toBe('/');
    expect(serverHome('/a/b/c/')).toBe('/');
  });

  /**
   * At the root the server's home is the app's own base, which is where the
   * first crumb already goes — so there is nothing above to offer.
   */
  it('is nowhere when the app is the top of the server', () => {
    expect(serverHome('/')).toBeNull();
    expect(serverHome('')).toBeNull();
  });

  /**
   * An absolute base says where the *assets* come from; the pages are still
   * served from this origin under its path, so only the path decides.
   */
  it('reads an absolute base as the path it puts the pages under', () => {
    expect(serverHome('https://cdn.example.com/procfs/')).toBe('/');
    expect(serverHome('https://cdn.example.com/')).toBeNull();
    expect(serverHome('https://cdn.example.com')).toBeNull();
  });

  it('does not care whether the base ends in a slash', () => {
    expect(serverHome('/proc')).toBe('/');
    expect(serverHome('/proc//')).toBe('/');
  });
});

describe('resolveEntry', () => {
  it('lists the directory the URL names', () => {
    expect(resolveEntry('/sys/', '/').path).toBe('/proc/sys');
    expect(resolveEntry('/12282/', '/').path).toBe('/proc/12282');
    expect(resolveEntry('/12282/net/dev_snmp6/', '/').path).toBe('/proc/12282/net/dev_snmp6');
  });

  /**
   * The trailing slash a directory is linked with is what makes the next
   * listing's relative links resolve inside it; it says nothing about the path.
   */
  it('lists the same directory with or without the slash', () => {
    expect(resolveEntry('/sys', '/').path).toBe('/proc/sys');
    expect(resolveEntry('/sys/', '/').path).toBe('/proc/sys');
  });

  it('lists it under a base the app is served from', () => {
    expect(resolveEntry('/procfs/sys/', '/procfs/').path).toBe('/proc/sys');
    expect(resolveEntry('/procfs/12282/', 'https://cdn.example.com/procfs/').path).toBe(
      '/proc/12282',
    );
  });

  /**
   * Unlike a file page, `.html` is left on: a listing is published at a URL
   * ending in a slash, so nothing links to `dir.html` and a URL naming it is
   * naming an entry. `/12/dir.html` asks for `/0/api/dir/12/dir.html`, and
   * whether there is anything there is the backend's answer to give.
   */
  it('reads a URL spelling the document as the path it spells', () => {
    expect(resolveEntry('/12/dir.html', '/').path).toBe('/proc/12/dir.html');
    expect(resolveEntry('/dir.html', '/').path).toBe('/proc/dir.html');
    expect(resolveEntry('/procfs/12/dir.html', '/procfs/').path).toBe('/proc/12/dir.html');
  });

  /** The base names no directory of its own, and is a listing of `/proc`. */
  it('lists /proc at the base itself', () => {
    expect(resolveEntry('/', '/').path).toBe('/proc');
    expect(resolveEntry('/procfs/', '/procfs/').path).toBe('/proc');
  });

  /** What the app is prepared to ask for is the same everywhere. */
  it('refuses a URL naming a path it will not ask for', () => {
    expect(resolveEntry('/12282/../../etc/', '/')).toEqual({
      path: null,
      refused: '/proc/12282/../../etc',
    });
    expect(resolveEntry('/./sys/', '/').path).toBeNull();
    expect(resolveEntry(`/${'x'.repeat(PATH_MAX)}/`, '/').path).toBeNull();
  });

  it('caps the refused path it hands back', () => {
    expect(resolveEntry(`/${'x'.repeat(PATH_MAX * 2)}/`, '/').refused).toHaveLength(PATH_MAX);
  });
});

describe('pathPattern', () => {
  it('matches a fixed path exactly', () => {
    expect(new RegExp(`^${pathPattern(cpuinfo)}$`).test('/proc/cpuinfo')).toBe(true);
    expect(new RegExp(`^${pathPattern(cpuinfo)}$`).test('/proc/cpuinfoX')).toBe(false);
  });

  it('matches one segment where the placeholder is', () => {
    const pattern = new RegExp(`^${pathPattern(smaps)}$`);

    expect(pattern.test('/proc/self/smaps')).toBe(true);
    expect(pattern.test('/proc/12282/smaps')).toBe(true);
    expect(pattern.test('/proc/smaps')).toBe(false);
    expect(pattern.test('/proc/a/b/smaps')).toBe(false);
  });

  it('escapes what would otherwise be regular expression syntax', () => {
    const dotted: Page = { path: '/proc/a.b/c', document: 'x.html' };

    expect(new RegExp(`^${pathPattern(dotted)}$`).test('/proc/aXb/c')).toBe(false);
    expect(new RegExp(`^${pathPattern(dotted)}$`).test('/proc/a.b/c')).toBe(true);
  });
});
