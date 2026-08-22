import { describe, expect, it } from 'vitest';
import { readPidCgroupFixture as fixture } from '../test/fixtures';
import {
  allAtRoot,
  atRoot,
  controllersIn,
  describeController,
  disagreeing,
  isEmpty,
  layoutOf,
  parseCgroup,
  unifiedLine,
  unitOf,
} from './pid-cgroup';

describe('parseCgroup — a machine on cgroup v2 alone', () => {
  const cgroup = parseCgroup(fixture('unified-v2', 'self'));

  it('reads the one line such a machine has', () => {
    expect(cgroup.lines).toHaveLength(1);
    expect(layoutOf(cgroup)).toBe('unified (cgroup v2)');
    expect(cgroup.unread).toEqual([]);
  });

  /** The empty middle field is the mark, and the 0 follows from it. */
  it('knows the unified hierarchy by its empty controller field', () => {
    const line = unifiedLine(cgroup)!;

    expect(line.unified).toBe(true);
    expect(line.id).toBe(0);
    expect(line.controllers).toEqual([]);
    expect(line.name).toBeNull();
    expect(line.path).toBe('/user.slice/user-1000.slice/session-2.scope');
  });

  it('reads the cgroup as the unit it is', () => {
    expect(unitOf(unifiedLine(cgroup)!)).toEqual({ name: 'session-2.scope', kind: 'scope' });
    expect(unitOf(parseCgroup(fixture('unified-v2', '1')).lines[0]!)).toEqual({
      name: 'init.scope',
      kind: 'scope',
    });
  });

  it('reads a deeper path as the unit at the end of it', () => {
    const browser = parseCgroup(fixture('unified-v2', '12282'));

    expect(unitOf(browser.lines[0]!)).toEqual({
      name: 'app-org.chromium.Chromium.scope',
      kind: 'scope',
    });
    expect(browser.lines[0]!.path.split('/').filter(Boolean)).toHaveLength(5);
  });
});

describe('parseCgroup — a machine on cgroup v1 alone', () => {
  const cgroup = parseCgroup(fixture('legacy-v1', 'self'));

  it('reads a line per mounted hierarchy', () => {
    expect(cgroup.lines).toHaveLength(11);
    expect(layoutOf(cgroup)).toBe('legacy (cgroup v1)');
    expect(unifiedLine(cgroup)).toBeNull();
  });

  it('reads co-mounted controllers as the several they are', () => {
    const shared = cgroup.lines.find((line) => line.id === 4)!;

    expect(shared.controllers).toEqual(['cpu', 'cpuacct']);
    expect(cgroup.lines.find((line) => line.id === 7)!.controllers).toEqual([
      'net_cls',
      'net_prio',
    ]);
  });

  /** systemd mounts one to track its units, and it limits nothing. */
  it('reads a named hierarchy with no controller on it', () => {
    const named = cgroup.lines.find((line) => line.id === 1)!;

    expect(named.name).toBe('systemd');
    expect(named.controllers).toEqual([]);
    // Named is not unified: the field was not empty.
    expect(named.unified).toBe(false);
  });

  it('names every controller across the hierarchies once', () => {
    expect(controllersIn(cgroup)).toEqual([
      'hugetlb',
      'pids',
      'devices',
      'blkio',
      'net_cls',
      'net_prio',
      'freezer',
      'memory',
      'cpu',
      'cpuacct',
      'cpuset',
      'perf_event',
    ]);
    expect(describeController('pids')).toMatch(/fork bomb/);
  });

  /** A process can genuinely be somewhere different on each hierarchy. */
  it('reads a different cgroup per hierarchy', () => {
    expect(cgroup.lines.find((line) => line.id === 5)!.path).toBe(
      '/user.slice/user-1000.slice/session-4.scope',
    );
    expect(cgroup.lines.find((line) => line.id === 4)!.path).toBe('/user.slice');
    expect(atRoot(cgroup.lines.find((line) => line.id === 3)!)).toBe(true);
  });
});

describe('parseCgroup — both at once', () => {
  const cgroup = parseCgroup(fixture('hybrid', 'self'));

  it('tells the unified line from the v1 ones', () => {
    expect(layoutOf(cgroup)).toBe('hybrid (v1 and v2)');
    expect(cgroup.lines.map((line) => line.unified)).toEqual([false, false, true]);
    expect(unifiedLine(cgroup)!.path).toBe('/user.slice/user-1000.slice/session-1.scope');
  });

  it('finds the hierarchy that puts the process somewhere else', () => {
    expect(disagreeing(cgroup).map((line) => line.controllers.join(','))).toEqual(['devices']);
  });
});

describe('parseCgroup — read from inside a cgroup namespace', () => {
  /**
   * The path is resolved against the *reader's* namespace, so a process that
   * cannot see past its own root reads `/` however deep it really sits.
   */
  it('reads every path as the root', () => {
    const cgroup = parseCgroup(fixture('container', 'self'));

    expect(allAtRoot(cgroup)).toBe(true);
    expect(unifiedLine(cgroup)!.path).toBe('/');
    expect(unitOf(unifiedLine(cgroup)!)).toBeNull();
  });
});

describe('parseCgroup — a process on its way out', () => {
  /**
   * `proc_cgroup_show` prints the root for an exiting task on a v1 hierarchy,
   * while the unified line keeps naming the cgroup it was in.
   */
  it('reads one file with two answers in it', () => {
    const cgroup = parseCgroup(fixture('zombie', 'self'));

    expect(unifiedLine(cgroup)!.path).toBe('/user.slice/user-1000.slice/session-1.scope');
    expect(disagreeing(cgroup)).toHaveLength(2);
    expect(disagreeing(cgroup).every(atRoot)).toBe(true);
    expect(allAtRoot(cgroup)).toBe(false);
  });
});

describe('parseCgroup — lines the fixtures do not hold', () => {
  /** A cgroup directory may be named with a colon in it. */
  it('keeps a path that holds a colon whole', () => {
    const cgroup = parseCgroup('0::/machine.slice/lxc:101:ct.scope\n');

    expect(cgroup.lines[0]!.path).toBe('/machine.slice/lxc:101:ct.scope');
    expect(unitOf(cgroup.lines[0]!)).toEqual({ name: 'lxc:101:ct.scope', kind: 'scope' });
    // Which a split on every colon would have cut in half.
    expect(cgroup.lines[0]!.path.split(':')).toHaveLength(3);
  });

  it('reads the unit kinds systemd names', () => {
    const kinds = (path: string) => unitOf(parseCgroup(`0::${path}\n`).lines[0]!);

    expect(kinds('/user.slice')).toEqual({ name: 'user.slice', kind: 'slice' });
    expect(kinds('/system.slice/nginx.service')).toEqual({
      name: 'nginx.service',
      kind: 'service',
    });
    expect(kinds('/kubepods/besteffort/pod1234')).toEqual({ name: 'pod1234', kind: 'other' });
  });

  it('keeps a controller no table here knows', () => {
    const cgroup = parseCgroup('5:vendor_thing:/\n');

    expect(cgroup.lines[0]!.controllers).toEqual(['vendor_thing']);
    expect(describeController('vendor_thing')).toBeNull();
  });

  it('sets aside a line that is not id:controllers:path', () => {
    const cgroup = parseCgroup('0::/user.slice\nnot a cgroup line\n');

    expect(cgroup.lines).toHaveLength(1);
    expect(cgroup.unread).toEqual(['not a cgroup line']);
  });

  it('has nothing to say about an empty file', () => {
    const cgroup = parseCgroup('');

    expect(isEmpty(cgroup)).toBe(true);
    expect(layoutOf(cgroup)).toBeNull();
    expect(allAtRoot(cgroup)).toBe(false);
    expect(disagreeing(cgroup)).toEqual([]);
  });
});
