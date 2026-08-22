/**
 * Parser for `/proc/<pid>/cgroup` — which cgroup this process is in, on every
 * hierarchy the machine has.
 *
 * One line per hierarchy, three fields deep:
 *
 *   3:devices:/user.slice
 *   2:memory:/user.slice/user-1000.slice/session-1.scope
 *   0::/user.slice/user-1000.slice/session-1.scope
 *
 * `proc_cgroup_show` in `kernel/cgroup/cgroup.c` writes the hierarchy id, the
 * controllers on it, and the cgroup this task sits in — and not the file at
 * `/proc/cgroups`, which is the machine's table of controllers rather than one
 * process's place in them.
 *
 * Five things read wrong at first glance.
 *
 * **`0::` is cgroup v2, and the empty middle field is what says so.** The
 * unified hierarchy prints no controllers, because on v2 they are not attached
 * to hierarchies of their own — the `0` follows from that rather than being the
 * mark itself. A machine with nothing but v2 has exactly one line here.
 *
 * **The path is not a filesystem path.** It is relative to that hierarchy's
 * root, so `/user.slice/...` is `/sys/fs/cgroup/user.slice/...` wherever that
 * hierarchy happens to be mounted, and `/` means the root cgroup rather than
 * the root directory.
 *
 * **The path is written from the reader's point of view, not the process's.**
 * `proc_cgroup_show` resolves it against `current->nsproxy->cgroup_ns` — the
 * *reading* task's cgroup namespace. A process inside a container with a cgroup
 * namespace of its own therefore reads `/` for itself, while the same process
 * read from the host shows the whole path. Neither is wrong; the file answers
 * "where is it, relative to where you are standing".
 *
 * **A zombie's v1 lines say `/`.** `proc_cgroup_show` prints the root for an
 * exiting task on a traditional hierarchy, because that is where zombies show
 * up there — and on the unified hierarchy it keeps reporting the cgroup the
 * task was in. So a dying process can show two different answers in one file,
 * and neither is stale.
 *
 * **A cgroup name may contain a colon**, so the path cannot be found by
 * splitting the line on `:`. Only the first two are separators; everything
 * after the second belongs to the path. See {@link LINE}.
 */

/**
 * `id:controllers:path`, where the path takes the rest of the line — a cgroup
 * directory may be named with a colon in it, and splitting on every `:` would
 * cut such a path in half.
 */
const LINE = /^(\d+):([^:]*):(.*)$/;

export interface CgroupLine {
  /** The hierarchy id. 0 is the unified hierarchy; the rest are v1 mounts. */
  id: number;
  /** The controllers on this hierarchy, empty on v2 and on a named-only mount. */
  controllers: string[];
  /** The name of a named v1 hierarchy — `systemd` from `name=systemd`. */
  name: string | null;
  /** The cgroup, relative to this hierarchy's root. */
  path: string;
  /** Whether this is the unified (v2) hierarchy, i.e. it named no controllers. */
  unified: boolean;
  raw: string;
}

export interface PidCgroup {
  lines: CgroupLine[];
  /** Lines that are not `id:controllers:path`, which the kernel writes none of. */
  unread: string[];
}

export function parseCgroup(text: string): PidCgroup {
  const lines: CgroupLine[] = [];
  const unread: string[] = [];

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;

    const match = LINE.exec(raw);
    if (match === null) {
      unread.push(raw);
      continue;
    }

    const [, id, field, path] = match;
    const parts = field === '' ? [] : field!.split(',');
    const named = parts.find((part) => part.startsWith('name='));

    lines.push({
      id: Number(id),
      controllers: parts.filter((part) => !part.startsWith('name=')),
      name: named === undefined ? null : named.slice('name='.length),
      path: path!,
      // The unified hierarchy is the one that names nothing: on v2 the
      // controllers are not attached to a hierarchy of their own, so there is
      // nothing for the kernel to print between the colons.
      unified: field === '',
      raw,
    });
  }

  return { lines, unread };
}

/** How this machine has its hierarchies arranged, as this file shows them. */
export type Layout = 'unified (cgroup v2)' | 'legacy (cgroup v1)' | 'hybrid (v1 and v2)';

export function layoutOf(cgroup: PidCgroup): Layout | null {
  if (cgroup.lines.length === 0) return null;

  const hasUnified = cgroup.lines.some((line) => line.unified);
  const hasLegacy = cgroup.lines.some((line) => !line.unified);

  if (hasUnified && hasLegacy) return 'hybrid (v1 and v2)';
  return hasUnified ? 'unified (cgroup v2)' : 'legacy (cgroup v1)';
}

/** The unified hierarchy's line, which is the one that matters on a v2 machine. */
export function unifiedLine(cgroup: PidCgroup): CgroupLine | null {
  return cgroup.lines.find((line) => line.unified) ?? null;
}

/** Whether a line puts the process in the root cgroup of its hierarchy. */
export function atRoot(line: CgroupLine): boolean {
  return line.path === '/';
}

/**
 * Whether every line here says the root cgroup — what a process in a cgroup
 * namespace of its own reads, since the path is resolved against the reader's
 * namespace and everything it can see is at or below its own root.
 */
export function allAtRoot(cgroup: PidCgroup): boolean {
  return cgroup.lines.length > 0 && cgroup.lines.every(atRoot);
}

/**
 * The lines that disagree with the unified one about where this process is.
 *
 * On a healthy hybrid machine every hierarchy usually puts a task in the same
 * place, since systemd creates the same tree on each. Where they differ, the
 * process really is in two different cgroups — or it is a zombie, whose v1
 * lines are printed as the root while the v2 line keeps the real path.
 */
export function disagreeing(cgroup: PidCgroup): CgroupLine[] {
  const unified = unifiedLine(cgroup);
  if (unified === null) return [];

  return cgroup.lines.filter((line) => !line.unified && line.path !== unified.path);
}

/** What a systemd unit's suffix says it is. */
export type UnitKind = 'slice' | 'service' | 'scope' | 'other';

export interface Unit {
  /** The last segment of the path, e.g. `session-1.scope`. */
  name: string;
  kind: UnitKind;
}

/**
 * The cgroup itself, which on a systemd machine is a unit: a `.slice` groups
 * others and holds the limits, a `.service` is something systemd started, and a
 * `.scope` is something it only adopted — a login session, a container, a
 * program launched from the desktop.
 */
export function unitOf(line: CgroupLine): Unit | null {
  const segments = line.path.split('/').filter((segment) => segment !== '');
  const name = segments.at(-1);
  if (name === undefined) return null;

  const kind: UnitKind = name.endsWith('.slice')
    ? 'slice'
    : name.endsWith('.service')
      ? 'service'
      : name.endsWith('.scope')
        ? 'scope'
        : 'other';

  return { name, kind };
}

/** What each kind of unit is, for the one at the end of a path. */
export const UNIT_KINDS: Record<UnitKind, string> = {
  slice: 'a group of other units, which is where a limit covering all of them is set',
  service: 'a process systemd started and manages',
  scope: 'a process systemd did not start but has taken charge of — a login session, a container, a program launched from the desktop',
  other: 'a cgroup made by something other than systemd, which names them as it likes',
};

interface KnownController {
  description: string;
}

/**
 * What each v1 controller is for. Only the ones a machine actually mounts on a
 * hierarchy of its own turn up here; the full table of what the kernel has is
 * `/proc/cgroups`, which is a different page.
 */
const CONTROLLERS: Record<string, KnownController> = {
  cpu: { description: 'how much CPU time this group gets against its siblings' },
  cpuacct: { description: 'CPU time used, counted per group — merged into cpu on v2' },
  cpuset: { description: 'which CPUs and memory nodes the group may run on' },
  memory: { description: 'how much memory the group may use, and what happens when it asks for more' },
  blkio: { description: 'block I/O weight and limits — io on v2' },
  io: { description: 'block I/O weight and limits' },
  devices: { description: 'which device nodes the group may open — replaced on v2 by a BPF hook' },
  freezer: { description: 'stopping and restarting every task in the group at once' },
  net_cls: { description: 'tags the group’s packets with a class id for the traffic shaper' },
  net_prio: { description: 'the priority the group’s packets get per interface' },
  perf_event: { description: 'lets perf record the group as a unit' },
  hugetlb: { description: 'how many huge pages the group may hold' },
  pids: { description: 'how many processes the group may have, which is what stops a fork bomb' },
  rdma: { description: 'RDMA resources the group may pin' },
  misc: { description: 'counted resources that fit nowhere else, such as encrypted-VM slots' },
  debug: { description: 'internals for debugging the cgroup code itself' },
};

/** What this controller limits, or null for one this page does not know. */
export function describeController(name: string): string | null {
  return CONTROLLERS[name]?.description ?? null;
}

/** Every controller named across all hierarchies, in the order they appear. */
export function controllersIn(cgroup: PidCgroup): string[] {
  return [...new Set(cgroup.lines.flatMap((line) => line.controllers))];
}

/** Whether there is nothing in the file at all. */
export function isEmpty(cgroup: PidCgroup): boolean {
  return cgroup.lines.length === 0 && cgroup.unread.length === 0;
}
