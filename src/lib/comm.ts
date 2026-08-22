/**
 * Parser for `/proc/<pid>/comm` — the thread's name, and nothing else.
 *
 * The smallest file this app reads: one string and the newline the kernel puts
 * after it. It is the same string as field 2 of `/proc/<pid>/stat`, and this is
 * the file to read it from — `stat` wraps the name in parentheses, which the
 * name itself may contain, so getting it back out of that line takes care that
 * getting it out of this one does not.
 *
 * Four things about it read wrong at first glance:
 *
 * - **A stored name is capped at 15 characters**, and nothing says when one was
 *   cut. A name of exactly that length may be the whole name or the front of a
 *   longer one; `pool-2-thread-1` from a Java thread pool is both shapes at
 *   once. But a **longer** name here is not a contradiction: for a workqueue
 *   worker, and on a 6.x kernel for any kernel thread, the kernel *builds* this
 *   string when the file is read rather than returning the 16 bytes the task
 *   stores — which is how `kworker/u29:2-events_freezable_pwr_efficient`, all
 *   44 characters of it, comes out of a field 16 bytes wide. See
 *   {@link COMM_MAX} and {@link isSynthesised}.
 * - **It is per *thread*, not per process.** `/proc/<pid>/comm` is the main
 *   thread's name and `/proc/<pid>/task/<tid>/comm` is each other thread's,
 *   which is why `top -H` and `ps -L` show names a process never had.
 * - **It is writable**, one of very few files under `/proc/<pid>` that are.
 *   `echo something > /proc/self/comm` renames the thread, so this is what a
 *   process calls itself rather than what it is — `/proc/<pid>/exe` is the only
 *   answer here that cannot be rewritten.
 * - **A kernel thread has one of these and no `cmdline` at all.** That pairing
 *   is how the two are told apart, and the names are structured:
 *   `kworker/u16:2` and `irq/128-nvme0q1` say which pool and which interrupt.
 *   See {@link describeKernelThread}.
 *
 * The trailing newline is the kernel's, not part of the name — comparing
 * without stripping it is the one bug this file is famous for.
 */

/**
 * Characters a task's *stored* name can hold: `TASK_COMM_LEN` less its NUL.
 * This is what `prctl(PR_SET_NAME)` writes and what an ordinary process shows.
 *
 * It is not a cap on this file. A workqueue worker's name — and on a 6.x kernel
 * any kernel thread's — is assembled when the file is read, into a buffer four
 * times this size, so those come out longer. See {@link isSynthesised}.
 */
export const COMM_MAX = 15;

export interface ThreadName {
  /** The name, without the newline the kernel writes after it. */
  name: string;
  /** Characters in the name itself. */
  length: number;
  /** Whether the file ended with that newline, as it always does in practice. */
  terminated: boolean;
  /** Bytes the file held, the newline included. */
  bytes: number;
  raw: string;
}

export function parseComm(text: string): ThreadName {
  const bytes = new TextEncoder().encode(text).length;
  const terminated = text.endsWith('\n');
  // Only the one the kernel wrote: a name cannot contain a newline, since the
  // write side stops at the first one.
  const name = terminated ? text.slice(0, -1) : text;

  return { name, length: name.length, terminated, bytes, raw: text };
}

/** Whether there is no name here at all, which a live thread always has. */
export function isEmpty(thread: ThreadName): boolean {
  return thread.name === '';
}

/**
 * Whether the name is exactly at the cap on a stored one, so it may be the
 * front of a longer one. There is no flag for this — the length is the only
 * tell. A name past the cap was never stored, so it was never cut.
 */
export function isTruncated(thread: ThreadName): boolean {
  return thread.length === COMM_MAX;
}

/**
 * Whether the kernel built this name when the file was read rather than
 * returning the task's stored one, which is the only way a name gets longer
 * than {@link COMM_MAX}. Workqueue workers always get one; so does every kernel
 * thread on a kernel new enough to keep their full names.
 */
export function isSynthesised(thread: ThreadName): boolean {
  return thread.length > COMM_MAX;
}

/** Whether the name holds a space, which is allowed and often surprising. */
export function hasSpaces(thread: ThreadName): boolean {
  return /\s/.test(thread.name);
}

/**
 * Whether the name holds a parenthesis. Harmless here, and the reason reading
 * this name out of `/proc/<pid>/stat` instead takes care: that file wraps it in
 * the same characters.
 */
export function hasParentheses(thread: ThreadName): boolean {
  return /[()]/.test(thread.name);
}

/**
 * Whether the name holds a character a terminal would not print. `prctl`
 * accepts anything but a NUL and a newline, so a name can carry escape
 * sequences — worth knowing before pasting one into a shell.
 */
export function hasControlCharacters(thread: ThreadName): boolean {
  return [...thread.name].some((character) => {
    const code = character.codePointAt(0)!;
    return code < 0x20 || code === 0x7f;
  });
}

export interface KernelThreadInfo {
  /** The family it belongs to. */
  kind: string;
  note: string;
  /** The CPU it is pinned to, where the name says so. */
  cpu?: number;
  /** Whatever else the name encodes, already taken apart. */
  detail?: string;
}

/**
 * What a kernel thread's name means, for the families whose names carry
 * structure. Null for anything that is not one of them — which includes every
 * ordinary process, so this doubles as the test for a kernel thread.
 *
 * Ordered most specific first: `kworker/` has to be tried before the bare
 * prefixes, and `rcuop/` before `rcu`.
 */
export function describeKernelThread(thread: ThreadName): KernelThreadInfo | null {
  const name = thread.name;

  const worker = /^kworker\/(u?)(\d+):(\d+)(H?)(?:-(.*))?$/.exec(name);
  if (worker !== null) {
    const unbound = worker[1] === 'u';
    const highpri = worker[4] === 'H';
    const queue = worker[5];

    return {
      kind: 'workqueue worker',
      note: `A thread the kernel runs deferred work on${
        unbound ? ', from a pool not tied to one CPU' : ', for one CPU'
      }${highpri ? ', at high priority' : ''}. There are as many as the work needs, and they come and go`,
      // For an unbound pool the number is the pool id, not a CPU.
      ...(unbound ? {} : { cpu: Number(worker[2]) }),
      detail: [
        unbound ? `unbound pool ${worker[2]}` : `cpu ${worker[2]}`,
        `worker ${worker[3]}`,
        highpri ? 'high priority' : null,
        queue === undefined ? null : `running ${queue}`,
      ]
        .filter((part) => part !== null)
        .join(', '),
    };
  }

  const rescuer = /^kworker\/R-(.+)$/.exec(name);
  if (rescuer !== null) {
    return {
      kind: 'workqueue rescuer',
      note: 'The one worker a workqueue keeps in reserve. When memory is too tight to create an ordinary worker, this is the thread that still gets the queue’s work done, so the system does not deadlock trying to free memory',
      detail: `workqueue ${rescuer[1]}`,
    };
  }

  const irq = /^irq\/(\d+)-(.+)$/.exec(name);
  if (irq !== null) {
    return {
      kind: 'threaded interrupt handler',
      note: 'The part of an interrupt handler that runs as a thread rather than in interrupt context, so it can sleep and be scheduled',
      detail: `irq ${irq[1]}, ${irq[2]}`,
    };
  }

  const perCpu = /^(ksoftirqd|migration|watchdog|cpuhp|idle_inject|irq_work)\/(\d+)$/.exec(name);
  if (perCpu !== null) {
    const notes: Record<string, string> = {
      ksoftirqd: 'Runs the softirq work a CPU could not finish in interrupt context — network and block completions land here under load',
      migration: 'Moves tasks off this CPU. It runs at the highest real-time priority there is, so seeing it use CPU means the scheduler is rebalancing',
      watchdog: 'The hard lockup detector for this CPU: if it stops being scheduled, the kernel says so',
      cpuhp: 'Brings this CPU online and offline',
      idle_inject: 'Forces idle time onto this CPU for thermal or power capping',
      irq_work: 'Runs work an interrupt handler deferred to the next safe moment',
    };

    return {
      kind: 'per-CPU kernel thread',
      note: notes[perCpu[1]!]!,
      cpu: Number(perCpu[2]),
      detail: `cpu ${perCpu[2]}`,
    };
  }

  const perNode = /^(kswapd|kcompactd)(\d+)$/.exec(name);
  if (perNode !== null) {
    return {
      kind: 'per-node memory thread',
      note:
        perNode[1] === 'kswapd'
          ? 'Reclaims memory in the background for one NUMA node, waking when free memory falls below the low watermark'
          : 'Compacts memory for one NUMA node, so large allocations can find contiguous pages',
      detail: `node ${perNode[2]}`,
    };
  }

  const journal = /^jbd2\/(.+)-(\d+)$/.exec(name);
  if (journal !== null) {
    return {
      kind: 'filesystem journal',
      note: 'Commits the ext4 journal for one device. A process blocked on it is waiting for the filesystem to make its writes durable',
      detail: `device ${journal[1]}`,
    };
  }

  const known: Readonly<Record<string, { kind: string; note: string }>> = {
    kthreadd: {
      kind: 'kernel thread parent',
      note: 'Pid 2, the thread every other kernel thread is forked from — which is why they all show it as their parent',
    },
    khugepaged: {
      kind: 'memory thread',
      note: 'Collapses ordinary pages into transparent hugepages in the background',
    },
    oom_reaper: {
      kind: 'memory thread',
      note: 'Takes memory back from a process the OOM killer has chosen, without waiting for it to finish dying',
    },
    khungtaskd: {
      kind: 'watchdog',
      note: 'Looks for tasks stuck in uninterruptible sleep for too long and complains about them in the log',
    },
    kauditd: { kind: 'audit', note: 'Carries audit records to whatever is listening for them' },
    kdevtmpfs: { kind: 'device thread', note: 'Maintains the device nodes under /dev' },
    writeback: {
      kind: 'writeback',
      note: 'Pushes dirty page cache out to disk in the background',
    },
    kblockd: { kind: 'block layer', note: 'Runs the block layer’s deferred work' },
    'nvme-wq': { kind: 'block layer', note: 'Deferred work for NVMe devices' },
    rcu_preempt: {
      kind: 'RCU',
      note: 'Runs the callbacks read-copy-update deferred until every reader was done with the old data',
    },
    rcu_sched: { kind: 'RCU', note: 'The same, on a kernel that names it this way' },
    rcu_tasks_kthre: {
      kind: 'RCU',
      note: 'The Tasks RCU grace period thread, on a kernel old enough to have cut its name off at fifteen characters',
    },
    rcu_tasks_kthread: {
      kind: 'RCU',
      note: 'The Tasks RCU grace period thread, which waits for every task to have been off a CPU at least once',
    },
    rcu_tasks_rude_kthread: {
      kind: 'RCU',
      note: 'Tasks Rude RCU, which forces the wait by interrupting every CPU rather than waiting for one to yield',
    },
    rcu_tasks_trace_kthread: {
      kind: 'RCU',
      note: 'Tasks Trace RCU, the variant BPF programs are freed behind',
    },
    rcu_exp_gp_kthread_worker: {
      kind: 'RCU',
      note: 'Drives an expedited grace period, which hurries RCU along at the cost of interrupting CPUs',
    },
    pool_workqueue_release: {
      kind: 'workqueue housekeeping',
      note: 'Frees workqueue pools once nothing is using them any more',
    },
    ksmd: {
      kind: 'memory thread',
      note: 'Same-page merging: scans anonymous memory for identical pages and collapses them into one, which is what the KSM figure in smaps counts',
    },
    watchdogd: {
      kind: 'watchdog',
      note: 'Pets the hardware watchdog device so it does not reset the machine — not the same thing as the per-CPU watchdog/N threads',
    },
    psimon: {
      kind: 'pressure stall monitor',
      note: 'Watches the PSI pressure figures and wakes whatever asked to be told when a threshold is crossed',
    },
    'kprobe-optimizer': {
      kind: 'kprobes',
      note: 'Replaces installed kprobes with a faster jump-based form once it is safe to do so',
    },
  };

  const entry = known[name];
  if (entry !== undefined) return { ...entry };

  const scsi = /^scsi_(eh|tmf)_(\d+)$/.exec(name);
  if (scsi !== null) {
    return {
      kind: 'SCSI',
      note:
        scsi[1] === 'eh'
          ? 'The error handler for one SCSI host. It only runs when a command has timed out, so a busy one means the storage is misbehaving'
          : 'Runs task-management requests — aborts and resets — for one SCSI host',
      detail: `host ${scsi[2]}`,
    };
  }

  const expedited = /^rcu_exp_par_gp_kthread_worker\/(\d+)$/.exec(name);
  if (expedited !== null) {
    return {
      kind: 'RCU',
      note: 'Drives one node’s share of an expedited grace period, in parallel with the others',
      detail: `group ${expedited[1]}`,
    };
  }

  const rcu = /^rcu(op|og|os)\/(\d+)$/.exec(name);
  if (rcu !== null) {
    return {
      kind: 'RCU',
      note: 'Offloads RCU callback work away from the CPU that queued it, which is what NO_HZ_FULL kernels do to keep a CPU undisturbed',
      detail: `group ${rcu[2]}`,
    };
  }

  return null;
}

/** Whether this name belongs to a kernel thread rather than a program. */
export function isKernelThread(thread: ThreadName): boolean {
  return describeKernelThread(thread) !== null;
}

export interface CommSummary {
  name: string;
  length: number;
  empty: boolean;
  truncated: boolean;
  terminated: boolean;
  spaces: boolean;
  parentheses: boolean;
  control: boolean;
  /** Built by the kernel at read time, which is why it can exceed the cap. */
  synthesised: boolean;
  kernel: KernelThreadInfo | null;
}

export function summarize(thread: ThreadName): CommSummary {
  return {
    name: thread.name,
    length: thread.length,
    empty: isEmpty(thread),
    truncated: isTruncated(thread),
    terminated: thread.terminated,
    spaces: hasSpaces(thread),
    parentheses: hasParentheses(thread),
    control: hasControlCharacters(thread),
    synthesised: isSynthesised(thread),
    kernel: describeKernelThread(thread),
  };
}
