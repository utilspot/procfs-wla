/**
 * Parser for `/proc/cgroups`.
 *
 * One line per cgroup controller the kernel was built with, behind a `#` header:
 *
 *   #subsys_name	hierarchy	num_cgroups	enabled
 *   cpuset	0	155	1
 *   cpu	3	42	1
 *   cpuacct	3	42	1
 *   memory	0	1	0
 *
 * The columns are the controller's name, the **hierarchy** it is attached to,
 * how many cgroups use it, and whether it is enabled.
 *
 * The hierarchy number is the part worth understanding. A non-zero value is the
 * id of a cgroup **v1** hierarchy, and controllers sharing a number are mounted
 * together — `cpu` and `cpuacct` on the same mount is the usual pairing. Zero
 * does **not** mean "unused": under cgroup **v2** every controller lives on the
 * single unified hierarchy, which has no number here, so a v2 machine shows 0
 * for all of them. Telling those apart is what {@link layoutOf} does, and it is
 * why the number alone cannot be read as a count.
 *
 * `enabled` is 0 for a controller compiled in but switched off, usually by
 * `cgroup_disable=` on the kernel command line.
 */

export interface Controller {
  name: string;
  /** v1 hierarchy id, or 0 for the v2 unified hierarchy / not mounted. */
  hierarchy: number;
  /** Cgroups using this controller. */
  cgroups: number;
  enabled: boolean;
}

/** How the machine has its controllers arranged. */
export type Layout = 'unified (cgroup v2)' | 'legacy (cgroup v1)' | 'hybrid (v1 and v2)';

/** `cpu	3	42	1` — four whitespace-separated columns. */
const ROW = /^(\S+)\s+(\d+)\s+(\d+)\s+([01])\s*$/;

export function parseCgroups(text: string): Controller[] {
  const controllers: Controller[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    // The header names the columns and starts with a hash.
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const match = ROW.exec(trimmed);
    if (match === null) continue;

    controllers.push({
      name: match[1]!,
      hierarchy: Number(match[2]),
      cgroups: Number(match[3]),
      enabled: match[4] === '1',
    });
  }

  return controllers;
}

/**
 * Which cgroup version the machine is using, from where the **enabled**
 * controllers sit. A disabled controller is always on hierarchy 0 whatever the
 * layout, so counting it would make every machine look unified.
 */
export function layoutOf(controllers: readonly Controller[]): Layout {
  const enabled = controllers.filter((controller) => controller.enabled);
  const onV1 = enabled.filter((controller) => controller.hierarchy > 0).length;

  if (onV1 === 0) return 'unified (cgroup v2)';
  if (onV1 === enabled.length) return 'legacy (cgroup v1)';
  return 'hybrid (v1 and v2)';
}

export interface Hierarchy {
  /** v1 hierarchy id. */
  id: number;
  /** Controllers mounted together on it, in file order. */
  controllers: Controller[];
  /** Cgroups on the hierarchy — the same for every controller sharing it. */
  cgroups: number;
}

/**
 * The v1 hierarchies, each with the controllers co-mounted on it. Controllers
 * on hierarchy 0 are left out: they are on the unified hierarchy or nowhere,
 * and grouping them under "0" would invent a hierarchy that does not exist.
 */
export function hierarchies(controllers: readonly Controller[]): Hierarchy[] {
  const grouped = new Map<number, Controller[]>();

  for (const controller of controllers) {
    if (controller.hierarchy === 0) continue;
    const existing = grouped.get(controller.hierarchy);
    if (existing === undefined) grouped.set(controller.hierarchy, [controller]);
    else existing.push(controller);
  }

  return [...grouped]
    .map(([id, list]) => ({ id, controllers: list, cgroups: list[0]?.cgroups ?? 0 }))
    .sort((a, b) => a.id - b.id);
}

/** Controllers sharing this one's hierarchy, i.e. mounted with it. */
export function coMounted(controller: Controller, all: readonly Controller[]): Controller[] {
  if (controller.hierarchy === 0) return [];
  return all.filter(
    (candidate) => candidate !== controller && candidate.hierarchy === controller.hierarchy,
  );
}

export interface CgroupsSummary {
  controllers: number;
  enabled: number;
  /** Controllers compiled in but switched off. */
  disabled: Controller[];
  layout: Layout;
  /** Distinct v1 hierarchies in use. */
  hierarchies: number;
  /** The most cgroups any one controller reports. */
  cgroups: number;
  /** By cgroup count, busiest first. */
  busiest: Controller[];
}

export function summarize(controllers: readonly Controller[]): CgroupsSummary {
  return {
    controllers: controllers.length,
    enabled: controllers.filter((controller) => controller.enabled).length,
    disabled: controllers.filter((controller) => !controller.enabled),
    layout: layoutOf(controllers),
    hierarchies: hierarchies(controllers).length,
    cgroups: Math.max(0, ...controllers.map((controller) => controller.cgroups)),
    busiest: [...controllers].sort(
      (a, b) => b.cgroups - a.cgroups || a.name.localeCompare(b.name),
    ),
  };
}
