import { describe, expect, it } from 'vitest';
import { readCgroupsFixture as fixture } from '../test/fixtures';
import { coMounted, hierarchies, layoutOf, parseCgroups, summarize } from './cgroups';

describe('parseCgroups — a unified v2 host', () => {
  const controllers = parseCgroups(fixture('unified-v2'));

  it('skips the header and reads a line per controller', () => {
    expect(controllers).toHaveLength(14);
    expect(controllers.every((controller) => !controller.name.startsWith('#'))).toBe(true);
    expect(controllers[0]).toEqual({ name: 'cpuset', hierarchy: 0, cgroups: 155, enabled: true });
  });

  /**
   * Under v2 every controller is on the single unified hierarchy, which has no
   * number here — so hierarchy 0 across the board means v2, not "unused".
   */
  it('reads hierarchy 0 everywhere as the unified hierarchy', () => {
    expect(controllers.every((controller) => controller.hierarchy === 0)).toBe(true);
    expect(layoutOf(controllers)).toBe('unified (cgroup v2)');
  });

  // Hierarchy 0 is not a hierarchy, so grouping must not invent one.
  it('reports no v1 hierarchies', () => {
    expect(hierarchies(controllers)).toEqual([]);
    expect(summarize(controllers).hierarchies).toBe(0);
  });

  it('has nothing co-mounted, since nothing is on a v1 mount', () => {
    const cpu = controllers.find((controller) => controller.name === 'cpu')!;
    expect(coMounted(cpu, controllers)).toEqual([]);
  });
});

describe('parseCgroups — a classic v1 host', () => {
  const controllers = parseCgroups(fixture('legacy-v1'));
  const controller = (name: string) => controllers.find((c) => c.name === name)!;

  it('reads a numbered hierarchy per controller', () => {
    expect(layoutOf(controllers)).toBe('legacy (cgroup v1)');
    expect(controller('cpuset').hierarchy).toBe(2);
    expect(controller('memory')).toMatchObject({ hierarchy: 5, cgroups: 91 });
  });

  // Controllers sharing a number are mounted together — the usual pairings.
  it('groups the controllers that share a hierarchy', () => {
    const grouped = hierarchies(controllers);

    expect(grouped).toHaveLength(10);
    expect(grouped.find((h) => h.id === 3)?.controllers.map((c) => c.name)).toEqual([
      'cpu',
      'cpuacct',
    ]);
    expect(grouped.find((h) => h.id === 8)?.controllers.map((c) => c.name)).toEqual([
      'net_cls',
      'net_prio',
    ]);
  });

  it('names what a controller is mounted with', () => {
    expect(coMounted(controller('cpu'), controllers).map((c) => c.name)).toEqual(['cpuacct']);
    expect(coMounted(controller('cpuacct'), controllers).map((c) => c.name)).toEqual(['cpu']);
    expect(coMounted(controller('blkio'), controllers)).toEqual([]);
  });

  it('takes the cgroup count of a hierarchy from its controllers', () => {
    expect(hierarchies(controllers).find((h) => h.id === 3)?.cgroups).toBe(84);
    expect(hierarchies(controllers).find((h) => h.id === 5)?.cgroups).toBe(91);
  });
});

describe('parseCgroups — a hybrid host', () => {
  const controllers = parseCgroups(fixture('hybrid'));

  it('calls it hybrid when only some controllers are on v1', () => {
    expect(layoutOf(controllers)).toBe('hybrid (v1 and v2)');
    expect(summarize(controllers).hierarchies).toBe(2);
  });

  it('lists only the controllers that really are on a v1 hierarchy', () => {
    expect(hierarchies(controllers).map((h) => h.controllers[0]?.name)).toEqual([
      'memory',
      'devices',
    ]);
  });
});

describe('parseCgroups — a host with controllers switched off', () => {
  const controllers = parseCgroups(fixture('disabled-controllers'));

  it('reads enabled as a flag, not a count', () => {
    const summary = summarize(controllers);

    expect(summary.controllers).toBe(14);
    expect(summary.enabled).toBe(12);
    expect(summary.disabled.map((controller) => controller.name)).toEqual(['memory', 'hugetlb']);
  });

  /**
   * A disabled controller sits on hierarchy 0 whatever the machine's layout, so
   * counting it would make a v1 host look unified.
   */
  it('decides the layout from the enabled controllers only', () => {
    const mixed = parseCgroups(
      '#subsys_name\thierarchy\tnum_cgroups\tenabled\ncpu\t3\t8\t1\nmemory\t0\t1\t0\n',
    );

    expect(mixed.find((c) => c.name === 'memory')?.hierarchy).toBe(0);
    // Only `cpu` is enabled, and it is on a v1 hierarchy.
    expect(layoutOf(mixed)).toBe('legacy (cgroup v1)');
  });
});

describe('parseCgroups — a busy container host', () => {
  const controllers = parseCgroups(fixture('container-host'));

  it('reads counts in the thousands', () => {
    const summary = summarize(controllers);

    expect(summary.cgroups).toBe(3184);
    expect(summary.busiest[0]?.cgroups).toBe(3184);
  });
});

describe('parseCgroups — every fixture', () => {
  const names = ['unified-v2', 'legacy-v1', 'hybrid', 'disabled-controllers', 'container-host'];

  it.each(names)('parses %s into consistent controllers', (name) => {
    const controllers = parseCgroups(fixture(name));
    const summary = summarize(controllers);

    expect(controllers.length).toBeGreaterThan(0);

    for (const controller of controllers) {
      expect(controller.name).not.toBe('');
      expect(controller.hierarchy).toBeGreaterThanOrEqual(0);
      expect(controller.cgroups).toBeGreaterThanOrEqual(0);
    }

    // Every controller on a v1 hierarchy appears in exactly one group.
    const onV1 = controllers.filter((controller) => controller.hierarchy > 0);
    expect(hierarchies(controllers).reduce((n, h) => n + h.controllers.length, 0)).toBe(
      onV1.length,
    );

    // Controllers sharing a hierarchy agree on how many cgroups it has.
    for (const hierarchy of hierarchies(controllers)) {
      expect(new Set(hierarchy.controllers.map((c) => c.cgroups)).size).toBe(1);
    }

    expect(summary.enabled + summary.disabled.length).toBe(summary.controllers);
  });
});

describe('parseCgroups — awkward input', () => {
  it('returns nothing for a file that is not /proc/cgroups', () => {
    expect(parseCgroups('')).toEqual([]);
    expect(parseCgroups('processor\t: 0\n')).toEqual([]);
  });

  it('reads a file with only the header as no controllers', () => {
    expect(parseCgroups('#subsys_name\thierarchy\tnum_cgroups\tenabled\n')).toEqual([]);
    expect(summarize([])).toMatchObject({ controllers: 0, enabled: 0, hierarchies: 0 });
  });

  // Documented behaviour: with nothing enabled there is no v1 hierarchy to see.
  it('reads an empty list as unified rather than guessing', () => {
    expect(layoutOf([])).toBe('unified (cgroup v2)');
  });

  it('accepts spaces where the kernel writes tabs', () => {
    expect(parseCgroups('cpu   3   42   1\n')[0]).toEqual({
      name: 'cpu',
      hierarchy: 3,
      cgroups: 42,
      enabled: true,
    });
  });

  it('skips a line with a missing column', () => {
    expect(parseCgroups('cpu\t3\t42\n')).toEqual([]);
  });

  it('skips a line whose enabled column is not 0 or 1', () => {
    expect(parseCgroups('cpu\t3\t42\t2\n')).toEqual([]);
  });

  it('reads a hierarchy number above nine', () => {
    expect(parseCgroups('pids\t11\t91\t1\n')[0]?.hierarchy).toBe(11);
  });

  it('reads a controller no cgroup uses', () => {
    const [controller] = parseCgroups('rdma\t0\t0\t1\n');

    expect(controller).toMatchObject({ cgroups: 0, enabled: true });
    expect(summarize([controller!]).cgroups).toBe(0);
  });
});
