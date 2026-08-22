import { describe, expect, it } from 'vitest';
import { readSysUserFixture as fixture } from '../test/fixtures';
import {
  describeValue,
  impliedThreadsMax,
  INT_MAX,
  isAtMemoryCeiling,
  isDisabled,
  isFresh,
  limitFor,
  LIMITS,
  MEMORY_CLAMP,
  parseUcount,
  summarize,
  WRITE_CAPABILITY,
} from './sys-user-ucount';

/** The value of one limit on one machine, which is how a capture is keyed. */
const read = (scenario: string, name: string) => parseUcount(fixture(scenario, name))!;

describe('the twelve limits', () => {
  it('names every file of /proc/sys/user, in the order the kernel declares them', () => {
    expect(LIMITS.map((limit) => limit.name)).toEqual([
      'max_user_namespaces',
      'max_pid_namespaces',
      'max_uts_namespaces',
      'max_ipc_namespaces',
      'max_net_namespaces',
      'max_mnt_namespaces',
      'max_cgroup_namespaces',
      'max_time_namespaces',
      'max_inotify_instances',
      'max_inotify_watches',
      'max_fanotify_groups',
      'max_fanotify_marks',
    ]);
    expect(WRITE_CAPABILITY).toBe('CAP_SYS_RESOURCE');
  });

  /** Which is the difference the pages exist to carry. */
  it('gives the two that hand out descriptors EMFILE and the rest ENOSPC', () => {
    expect(limitFor('max_inotify_instances')!.errno).toBe('EMFILE');
    expect(limitFor('max_fanotify_groups')!.errno).toBe('EMFILE');
    expect(limitFor('max_inotify_watches')!.errno).toBe('ENOSPC');
    expect(limitFor('max_fanotify_marks')!.errno).toBe('ENOSPC');
    expect(
      LIMITS.filter((limit) => limit.name.endsWith('_namespaces')).every(
        (limit) => limit.errno === 'ENOSPC',
      ),
    ).toBe(true);
  });

  /** Three unrelated rules, which is why the numbers look nothing alike. */
  it('says where each default comes from', () => {
    expect(limitFor('max_cgroup_namespaces')!.defaultSource).toBe('threads');
    expect(limitFor('max_inotify_instances')!.defaultSource).toBe('fixed');
    expect(limitFor('max_inotify_watches')!.defaultSource).toBe('memory');
    expect(limitFor('max_fanotify_groups')!.defaultNote).toMatch(/128/);
    expect(limitFor('max_fanotify_marks')!.defaultNote).toMatch(/1% of addressable memory/);
  });

  /** The four with a second, older name under /proc/sys/fs. */
  it('names the sysctl each of the four is also registered as', () => {
    expect(limitFor('max_inotify_watches')!.alsoAt).toBe('/proc/sys/fs/inotify/max_user_watches');
    expect(limitFor('max_inotify_instances')!.alsoAt).toBe(
      '/proc/sys/fs/inotify/max_user_instances',
    );
    expect(limitFor('max_fanotify_groups')!.alsoAt).toBe('/proc/sys/fs/fanotify/max_user_groups');
    expect(limitFor('max_fanotify_marks')!.alsoAt).toBe('/proc/sys/fs/fanotify/max_user_marks');
    expect(limitFor('max_net_namespaces')!.alsoAt).toBeUndefined();
  });

  it('has nothing to say about a file that is not one of them', () => {
    expect(limitFor('max_pid_namespace')).toBeUndefined();
    expect(limitFor('swappiness')).toBeUndefined();
  });
});

describe('parseUcount — an ordinary machine', () => {
  it('reads the one number each file holds', () => {
    expect(read('desktop', 'max_cgroup_namespaces')).toMatchObject({
      limit: 55274,
      raw: '55274',
      terminated: true,
    });
    expect(read('desktop', 'max_inotify_instances').limit).toBe(128);
    expect(read('desktop', 'max_inotify_watches').limit).toBe(124672);
  });

  /** The eight namespace limits are one number, since one rule set them all. */
  it('reads the same default across every namespace limit', () => {
    const namespaces = LIMITS.filter((limit) => limit.defaultSource === 'threads');

    expect(namespaces).toHaveLength(8);
    for (const limit of namespaces) {
      expect(read('desktop', limit.name).limit).toBe(55274);
    }
  });

  /** And only for those eight is halving it back a sensible thing to do. */
  it('works a namespace default back to the thread limit behind it', () => {
    const cgroup = limitFor('max_cgroup_namespaces')!;
    const watches = limitFor('max_inotify_watches')!;

    expect(impliedThreadsMax(cgroup, read('desktop', cgroup.name))).toBe(110548);
    expect(impliedThreadsMax(watches, read('desktop', watches.name))).toBeNull();
  });

  it('summarizes a limit against the facts of its own file', () => {
    const limit = limitFor('max_inotify_watches')!;

    expect(summarize(limit, read('desktop', limit.name))).toEqual({
      limit: 124672,
      disabled: false,
      fresh: false,
      impliedThreadsMax: null,
      atMemoryCeiling: false,
      terminated: true,
    });
  });
});

describe('parseUcount — a machine with a great deal of memory', () => {
  /** Both memory-derived defaults stop at the same ceiling. */
  it('reads a watch and mark limit clamped to its maximum', () => {
    const watches = limitFor('max_inotify_watches')!;
    const marks = limitFor('max_fanotify_marks')!;

    expect(read('server', watches.name).limit).toBe(MEMORY_CLAMP.max);
    expect(isAtMemoryCeiling(watches, read('server', watches.name))).toBe(true);
    expect(isAtMemoryCeiling(marks, read('server', marks.name))).toBe(true);
  });

  /** The namespace limits keep climbing, since nothing clamps them. */
  it('leaves the namespace limits unclamped', () => {
    const limit = limitFor('max_net_namespaces')!;

    expect(read('server', limit.name).limit).toBe(896866);
    expect(isAtMemoryCeiling(limit, read('server', limit.name))).toBe(false);
  });

  it('reads a small board the same way, with smaller numbers', () => {
    expect(read('raspberry-pi', 'max_inotify_watches').limit).toBe(30912);
    expect(read('raspberry-pi', 'max_mnt_namespaces').limit).toBe(13708);
  });
});

describe('parseUcount — a machine locked down by hand', () => {
  /** Which is what this file is for, and what 0 means on it. */
  it('reads 0 as no user namespace at all', () => {
    const value = read('hardened', 'max_user_namespaces');

    expect(isDisabled(value)).toBe(true);
    expect(describeValue(value)).toBe('none at all');
    expect(limitFor('max_user_namespaces')!.note).toMatch(/turns unprivileged user namespaces off/);
  });

  /** A number somebody chose says nothing about the machine's memory. */
  it('offers no thread limit behind a value that was set', () => {
    const limit = limitFor('max_user_namespaces')!;

    expect(impliedThreadsMax(limit, read('hardened', limit.name))).toBeNull();
    expect(read('hardened', 'max_fanotify_groups').limit).toBe(0);
    expect(read('hardened', 'max_inotify_watches').limit).toBe(MEMORY_CLAMP.min);
  });
});

describe('parseUcount — a user namespace of its own', () => {
  /** `create_user_ns` writes INT_MAX into every one of the twelve. */
  it('reads INT_MAX on every file of a fresh namespace', () => {
    for (const limit of LIMITS) {
      const value = read('new-userns', limit.name);

      expect(value.limit).toBe(INT_MAX);
      expect(isFresh(value)).toBe(true);
      expect(describeValue(value)).toBe('no limit of its own');
    }
  });

  it('reads back to no thread limit, since nothing derived it', () => {
    const limit = limitFor('max_pid_namespaces')!;

    expect(impliedThreadsMax(limit, read('new-userns', limit.name))).toBeNull();
  });
});

describe('parseUcount — a limit somebody raised', () => {
  it('reads a raised watch limit beside untouched neighbours', () => {
    expect(read('raised', 'max_inotify_watches').limit).toBe(524288);
    expect(read('raised', 'max_inotify_instances').limit).toBe(128);
    expect(read('raised', 'max_cgroup_namespaces').limit).toBe(55274);
  });
});

describe('parseUcount — files that are not one number', () => {
  it('reads a value with no trailing newline, and one with spaces around it', () => {
    expect(parseUcount('55274')).toMatchObject({ limit: 55274, terminated: false });
    expect(parseUcount('  4  \n')).toMatchObject({ limit: 4 });
  });

  it('refuses anything that is not a whole number', () => {
    expect(parseUcount('')).toBeNull();
    expect(parseUcount('\n\n')).toBeNull();
    expect(parseUcount('many\n')).toBeNull();
    expect(parseUcount('1.5\n')).toBeNull();
    expect(parseUcount('128 128\n')).toBeNull();
  });

  /** The handler's range is 0..INT_MAX, so a negative did not come from here. */
  it('refuses a negative, which the sysctl range does not allow', () => {
    expect(parseUcount('-1\n')).toBeNull();
  });
});
