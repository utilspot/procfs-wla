/**
 * Parser for `/proc/<pid>/autogroup` — the scheduling group a process shares
 * with everything else in its session, and the nice level of that group.
 *
 * One line, and that is the whole file:
 *
 *   /autogroup-42 nice 0
 *
 * `proc_sched_autogroup_show_task` in `kernel/sched/autogroup.c` prints it as
 * `"/autogroup-%ld nice %d\n"`. **An empty file is the other answer**, not a
 * failure — see {@link isDefaultGroup}.
 *
 * What autogrouping is: `setsid()` puts a task into a scheduling group of its
 * own, and the scheduler then divides CPU time between *groups* before dividing
 * it inside one. So a `make -j64` in one terminal is one competitor rather than
 * sixty-four, and the video player in another terminal keeps its half. Every
 * terminal, every login, every daemon that daemonises gets one, because each of
 * those is a `setsid()`.
 *
 * Four things read wrong at first glance.
 *
 * **The number is neither a pid nor a session id.** It is a global counter the
 * kernel bumps for each group it creates, so it only goes up, it is never
 * reused, and a machine that has been up for weeks shows a large one. What it
 * is good for is *comparison*: two processes showing the same id are in the
 * same group and are competing with each other rather than with the rest of the
 * machine — see {@link sameGroup}.
 *
 * **`nice` here is the group's, not the process's.** It is set by writing a
 * number to this file, it scales the whole group's weight against other groups,
 * and it has nothing to do with the process's own nice in field 19 of
 * `/proc/<pid>/stat`. Renicing a process does not touch this, and writing here
 * does not touch that.
 *
 * **An empty file means the default group.** A task that never called
 * `setsid()` is still in `autogroup_default`, whose task group *is* the root
 * one, and `proc_sched_autogroup_show_task` prints nothing for it rather than
 * naming a group. Kernel threads are like this, and so is pid 1: the init task
 * is put in the default group by `autogroup_init` at boot, and it cannot leave
 * by calling `setsid()` because it already leads its session.
 *
 * **The line does not mean the scheduler is using it.** Nothing about this file
 * changes when `/proc/sys/kernel/sched_autogroup_enabled` goes to 0 — the group
 * is still created by `setsid()` and still printed here, and only
 * `autogroup_task_group` consults the sysctl. The same goes for a task in a
 * non-root CPU cgroup: `task_wants_autogroup` returns false for one, so on a
 * machine where the `cpu` controller is enabled over the user's slice the
 * autogroup named here is ignored in favour of the cgroup. The file reports
 * which group a task *has*, never which one is deciding its CPU time.
 */

/** `/autogroup-42 nice 0` */
const LINE = /^\/autogroup-(-?\d+)\s+nice\s+(-?\d+)\s*$/;

/** What the kernel will accept as a nice level, `MIN_NICE` to `MAX_NICE`. */
export const MIN_NICE = -20;
export const MAX_NICE = 19;

/**
 * `sched_prio_to_weight` from `kernel/sched/core.c`, indexed by `nice + 20`.
 *
 * This is what a nice level *is* to the scheduler: a weight, and CPU time
 * shared out in proportion to it. Writing to this file sets the autogroup's
 * share to `scale_load(sched_prio_to_weight[nice + 20])`, so the table is how a
 * number in the file turns into an amount of machine. Each step is about 1.25×
 * the one before, which is what makes a nice level worth roughly 10%.
 */
export const WEIGHTS: readonly number[] = [
  /* -20 */ 88761, 71755, 56483, 46273, 36291,
  /* -15 */ 29154, 23254, 18705, 14949, 11916,
  /* -10 */ 9548, 7620, 6100, 4904, 3906,
  /*  -5 */ 3121, 2501, 1991, 1586, 1277,
  /*   0 */ 1024, 820, 655, 526, 423,
  /*   5 */ 335, 272, 215, 172, 137,
  /*  10 */ 110, 87, 70, 56, 45,
  /*  15 */ 36, 29, 23, 18, 15,
];

/** The weight of a group at nice 0, which every other weight is read against. */
export const DEFAULT_WEIGHT = 1024;

export interface Autogroup {
  /** The file exactly as it was read. */
  raw: string;
  /** The group as named, e.g. `/autogroup-42`, or null where none was named. */
  name: string | null;
  /** The counter in that name, or null. Not a pid and not a session id. */
  id: number | null;
  /** The group's nice level, or null. Not the process's own. */
  nice: number | null;
  /** Whether the file ended with a newline. The kernel writes one. */
  terminated: boolean;
  /** Bytes the file held, which is 0 for the default group. */
  bytes: number;
}

export function parseAutogroup(text: string): Autogroup {
  const bytes = new TextEncoder().encode(text).length;
  const terminated = text.endsWith('\n');
  const match = LINE.exec(text.trim());

  if (match === null) {
    return { raw: text, name: null, id: null, nice: null, terminated, bytes };
  }

  const [, id, nice] = match;
  return {
    raw: text,
    name: `/autogroup-${id}`,
    id: Number(id),
    nice: Number(nice),
    terminated,
    bytes,
  };
}

/**
 * Whether this task is in `autogroup_default` — the root task group, which is
 * not an autogroup, so the kernel prints nothing at all.
 *
 * It is the ordinary answer for a kernel thread and for pid 1, not a fault and
 * not a permission problem. A task leaves the default group by calling
 * `setsid()`, and nothing else puts it back.
 */
export function isDefaultGroup(autogroup: Autogroup): boolean {
  return autogroup.raw.trim() === '';
}

/** Whether the file held something that is not the line the kernel writes. */
export function isUnreadable(autogroup: Autogroup): boolean {
  return autogroup.id === null && !isDefaultGroup(autogroup);
}

/**
 * Whether two processes are in the same autogroup, which is the question the id
 * exists to answer: they are competing with each other for their group's share
 * rather than with the rest of the machine.
 */
export function sameGroup(a: Autogroup, b: Autogroup): boolean {
  return a.id !== null && a.id === b.id;
}

/** The scheduler's weight for this nice level, or null for one out of range. */
export function weightFor(nice: number): number | null {
  return WEIGHTS[nice - MIN_NICE] ?? null;
}

/**
 * How much of a default group this one counts as: 1 at nice 0, about 3 at
 * nice −5, about a tenth at nice 10.
 *
 * The scheduler shares CPU time between groups in proportion to their weights,
 * so this is the ratio two groups' shares would be in if they were the only two
 * competing — and roughly what it is worth in the crowd of groups a real
 * machine has.
 */
export function timesDefault(nice: number): number | null {
  const weight = weightFor(nice);
  return weight === null ? null : weight / DEFAULT_WEIGHT;
}

/** That ratio as something to read: `3.0× a default group`, `a tenth of one`. */
export function describeWeight(nice: number): string | null {
  const times = timesDefault(nice);
  if (times === null) return null;
  if (nice === 0) return 'the same as any other group';
  if (times >= 1) return `${times.toFixed(times >= 10 ? 0 : 1)}× a default group`;

  return `${fraction(1 / times)} of a default group`;
}

/**
 * `1 / 9.3` as `a ninth`, for the side of the table below nice 0 — and as
 * `1/68` past the point where English has a word for it, which the far end of
 * the table reaches.
 */
function fraction(denominator: number): string {
  const names: Record<number, string> = {
    2: 'a half',
    3: 'a third',
    4: 'a quarter',
    5: 'a fifth',
    6: 'a sixth',
    7: 'a seventh',
    8: 'an eighth',
    9: 'a ninth',
    10: 'a tenth',
  };

  const rounded = Math.round(denominator);
  return names[rounded] ?? `1/${rounded}`;
}

/** Whether anything has written to this file, i.e. the group is not at nice 0. */
export function isReniced(autogroup: Autogroup): boolean {
  return autogroup.nice !== null && autogroup.nice !== 0;
}
