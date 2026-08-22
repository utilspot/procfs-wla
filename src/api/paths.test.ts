import { describe, expect, it } from 'vitest';
import {
  API_PREFIX,
  API_ROOT,
  apiPath,
  ASSET_DIR,
  hostPathFor,
  HOST_ROOT,
  listPath,
  LIST_ROOT,
} from './paths';

describe('apiPath', () => {
  it('serves a host file under the API root', () => {
    expect(apiPath('/proc/cpuinfo')).toBe('/0/api/file/cpuinfo');
    expect(apiPath('/proc/key-users')).toBe('/0/api/file/key-users');
    expect(apiPath('/proc/1234/smaps')).toBe('/0/api/file/1234/smaps');
    expect(apiPath('/proc/self/status')).toBe('/0/api/file/self/status');
  });

  /** A page's path carries its placeholder, and so does the route serving it. */
  it('leaves a placeholder where it stands', () => {
    expect(apiPath('/proc/{pid}/smaps')).toBe('/0/api/file/{pid}/smaps');
  });

  it('swaps only the prefix, however deep the path goes', () => {
    expect(apiPath('/proc/1234/task/1235/stat')).toBe('/0/api/file/1234/task/1235/stat');
    expect(apiPath('/proc/sys/kernel/osrelease')).toBe('/0/api/file/sys/kernel/osrelease');
  });

  /** Nothing outside /proc is served, so there is nothing to rewrite either. */
  it('hands back a path that is not a host file unchanged', () => {
    expect(apiPath('/etc/passwd')).toBe('/etc/passwd');
    expect(apiPath('/fixtures')).toBe('/fixtures');
    // A lookalike prefix is not the host root.
    expect(apiPath('/procfs/cpuinfo')).toBe('/procfs/cpuinfo');
  });
});

describe('hostPathFor', () => {
  it('gives back the file a request is for', () => {
    expect(hostPathFor('/0/api/file/cpuinfo')).toBe('/proc/cpuinfo');
    expect(hostPathFor('/0/api/file/self/smaps')).toBe('/proc/self/smaps');
  });

  it('has nothing to give back for a request that is not for one', () => {
    expect(hostPathFor('/proc/cpuinfo')).toBeNull();
    expect(hostPathFor('/fixtures')).toBeNull();
    expect(hostPathFor('/0/api/filex/cpuinfo')).toBeNull();
    expect(hostPathFor('/api/cpuinfo')).toBeNull();
    expect(hostPathFor('')).toBeNull();
  });

  it('undoes apiPath for every host path', () => {
    for (const path of ['/proc/cpuinfo', '/proc/12282/status', '/proc/sys/kernel/osrelease']) {
      expect(hostPathFor(apiPath(path))).toBe(path);
    }
  });
});

/**
 * The listing endpoint, beside the bytes: `GET /0/api/dir/<path>` answers with
 * what is in that directory.
 */
describe('listPath', () => {
  /**
   * The trailing slash is not decoration. The backend takes the relative path
   * as everything one character past `/0/api/dir`, so `/0/api/dir` with nothing
   * after it leaves it reading past the end of the URL — see
   * `requestStatHandler` in `WebProcfsExecutor.c`.
   */
  it('asks for the root with a trailing slash', () => {
    expect(listPath('/proc')).toBe('/0/api/dir/');
    expect(listPath('/proc/')).toBe('/0/api/dir/');
  });

  it('names a directory below it without one', () => {
    expect(listPath('/proc/sys')).toBe('/0/api/dir/sys');
    expect(listPath('/proc/sys/kernel')).toBe('/0/api/dir/sys/kernel');
    expect(listPath('/proc/12282')).toBe('/0/api/dir/12282');
    // A trailing slash on the way in does not survive into the request.
    expect(listPath('/proc/sys/')).toBe('/0/api/dir/sys');
  });

  /** The same stance apiPath takes: a path outside /proc is handed back. */
  it('leaves a path outside /proc alone', () => {
    expect(listPath('/etc')).toBe('/etc');
    expect(listPath('/procfs/sys')).toBe('/procfs/sys');
  });
});

describe('the roots', () => {
  it('are what the rest of the app spells out', () => {
    expect(API_ROOT).toBe('/0/api/file');
    expect(LIST_ROOT).toBe('/0/api/dir');
    expect(HOST_ROOT).toBe('/proc');
  });

  /** Both under `API_PREFIX`, so a server routes one prefix to the backend. */
  it('sit beside each other', () => {
    expect(API_ROOT.startsWith(`${API_PREFIX}/`)).toBe(true);
    expect(LIST_ROOT.startsWith(`${API_PREFIX}/`)).toBe(true);
    expect(API_ROOT).not.toBe(LIST_ROOT);
  });

  /**
   * And that prefix is under the directory the built assets are served from,
   * which is the whole of what keeps the app's URLs out of the space mirroring
   * `/proc`. A server dispatching on `/0/` has to match these routes first —
   * `fileForAssetUrl` in `config/document.ts` and `getInternalRequest` in
   * `WebProcfsExecutor.c` are the two that do.
   */
  it('sit under the one directory that is not a /proc entry', () => {
    expect(API_PREFIX).toBe(`/${ASSET_DIR}/api`);
    // Nothing procfs can produce: the top level is its static entries plus one
    // directory per process, and pid 0 is the idle task.
    expect(ASSET_DIR).toBe('0');
  });
});
