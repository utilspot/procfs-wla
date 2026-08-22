/**
 * Parser for `/proc/<pid>/wchan` — the kernel function a process is asleep in.
 *
 * One symbol, and that is the whole file:
 *
 *   futex_wait_queue_me
 *
 * The kernel prints it with `%ps`, which resolves the address it unwound off
 * the task's kernel stack against `kallsyms`. This is what `ps` puts in its
 * `WCHAN` column, and what turns "the process is stuck" into "the process is
 * waiting for a page to come back off the disk".
 *
 * Four things about it read wrong at first glance:
 *
 * - **There is no trailing newline.** The kernel writes the symbol and stops,
 *   where `/proc/<pid>/comm` writes a newline after the name. Code that reads
 *   the two the same way gets one of them wrong. See {@link WchanSymbol.terminated}.
 * - **`0` is three different answers wearing one hat.** The task is on a CPU;
 *   or it is not sleeping anywhere with a frame worth naming; or **the reader
 *   is not allowed to look** — since Linux 4.0 this file needs the same access
 *   `ptrace` does, and a refusal is printed as `0` rather than raised as an
 *   error. Another user's process is indistinguishable from a busy one. See
 *   {@link isZero}.
 * - **A running task has no answer at all**, and since Linux 5.16 the kernel
 *   does not even try: `get_wchan` returns nothing for a task that is not
 *   blocked, so a `WCHAN` column that used to name something on an older
 *   kernel now often does not.
 * - **The symbol is a sample, not a fact.** It is the frame an unwinder picked
 *   at the moment of the read, off a stack the task may already have left — so
 *   it says where the task tends to wait, and a single reading of it proves
 *   very little.
 *
 * `/proc/<pid>/stat` field 35 is the same thing as a raw address, and has been
 * zeroed since Linux 4.9 for a reader who may not ptrace the process. This file
 * is the one to read.
 */

/** What the kernel prints where it has nothing to name. */
export const NOTHING = '0';

export interface WchanSymbol {
  /** The file's contents, with a trailing newline removed if one turned up. */
  symbol: string;
  /** The function on its own, without the module the kernel printed beside it. */
  name: string;
  /**
   * The module the symbol came from, where `%ps` printed one — `sunrpc` for
   * `rpc_wait_bit_killable [sunrpc]`. Null for a symbol in the kernel itself.
   */
  module: string | null;
  /**
   * Whether the file ended with a newline. The kernel writes none, so this is
   * false against a real one — and true is the tell that something in between
   * has been reformatting it.
   */
  terminated: boolean;
  /** Bytes the file held. */
  bytes: number;
  raw: string;
}

/** A symbol printed with its module, which is how `%ps` renders one. */
const MODULE = /^(\S+)\s+\[([\w-]+)\]$/;

export function parseWchan(text: string): WchanSymbol {
  const bytes = new TextEncoder().encode(text).length;
  const terminated = text.endsWith('\n');
  const symbol = (terminated ? text.slice(0, -1) : text).trim();

  const module = MODULE.exec(symbol);

  return {
    symbol,
    name: module === null ? symbol : module[1]!,
    module: module === null ? null : module[2]!,
    terminated,
    bytes,
    raw: text,
  };
}

/**
 * Whether the kernel had nothing to name. Which of the three reasons it was —
 * on a CPU, not blocked anywhere nameable, or a reader without ptrace access —
 * this file does not say, and nothing else will say it either.
 */
export function isZero(wchan: WchanSymbol): boolean {
  return wchan.symbol === NOTHING;
}

/** Whether there is no answer here at all, which a live process always has. */
export function isEmpty(wchan: WchanSymbol): boolean {
  return wchan.symbol === '';
}

/**
 * Whether the address did not resolve to a symbol, so `%ps` printed it as a
 * number: a kernel built without `CONFIG_KALLSYMS`, or a module whose symbols
 * are not in the table. Before Linux 4.0 this file was *always* a number, and
 * `ps` did the lookup itself against `System.map`.
 */
export function isUnresolved(wchan: WchanSymbol): boolean {
  return /^0x[0-9a-f]+$/i.test(wchan.symbol);
}

/** Whether the symbol came out of a loadable module rather than the kernel. */
export function isModuleSymbol(wchan: WchanSymbol): boolean {
  return wchan.module !== null;
}

export interface WchanInfo {
  /** The family of wait this is. */
  kind: string;
  note: string;
  /**
   * Whether the wait is the uninterruptible kind — `D` in `ps`, deaf to
   * signals, and counted in the load average whether or not a CPU is busy.
   * That last part is why a machine doing nothing can show a load of 40.
   */
  uninterruptible?: boolean;
  /** Where the task is a kernel thread sitting in its own main loop, idle. */
  idle?: boolean;
}

interface Matcher {
  test: RegExp;
  info: WchanInfo;
}

/**
 * The families worth naming, most specific first. These are the symbols that
 * actually turn up in a `WCHAN` column; the kernel has thousands more, and one
 * this table does not know is said to be unknown rather than guessed at.
 */
const FAMILIES: Matcher[] = [
  {
    test: /^(?:futex_wait(?:_queue(?:_me)?|_setup)?|do_futex|__futex_wait)$/,
    info: {
      kind: 'a futex',
      note: 'Blocked on a lock that lives in userspace — a mutex, a condition variable, a Java monitor, a Go channel. The kernel is only holding the queue; whatever the process is really waiting for is in the program, not in here',
    },
  },
  {
    test: /^(?:do_epoll_wait|ep_poll|do_sys_poll|do_poll|poll_schedule_timeout|do_select|core_sys_select|SyS_epoll_wait)$/,
    info: {
      kind: 'an event loop',
      note: 'Parked in poll, select or epoll with nothing ready. This is what an idle server looks like, and it is not a problem to be solved',
    },
  },
  {
    test: /^(?:io_schedule|io_schedule_timeout|folio_wait_bit(?:_common)?|wait_on_page_bit(?:_common)?|__lock_page|__folio_lock|wait_on_buffer|submit_bio_wait|wait_for_completion_io|blkdev_issue_flush)$/,
    info: {
      kind: 'disk I/O',
      note: 'Waiting for a block device to come back — a read that missed the page cache, or a write being made durable. This is what a process hung with no CPU to blame is usually waiting for',
      uninterruptible: true,
    },
  },
  {
    test: /^(?:jbd2_log_wait_commit|jbd2_journal_commit_transaction|jbd2_log_do_checkpoint|ext4_[a-z_]*wait[a-z_]*)$/,
    info: {
      kind: 'a filesystem journal',
      note: 'Waiting for ext4 to make its journal durable. One slow device holds up every process writing to that filesystem, which is how a single disk stalls a machine that has plenty of others',
      uninterruptible: true,
    },
  },
  {
    test: /^(?:rpc_wait_bit_killable|nfs_wait_[a-z_]+|nfs_lock_and_join_requests|__nfs_[a-z_]*wait[a-z_]*)$/,
    info: {
      kind: 'a network filesystem',
      note: 'Waiting for an NFS server to answer. A hard mount waits for as long as it takes — killable at best — so a server that has gone away leaves processes here indefinitely',
      uninterruptible: true,
    },
  },
  {
    test: /^(?:rwsem_down_read_slowpath|rwsem_down_write_slowpath|down_read|down_write|__mutex_lock(?:_slowpath)?|mutex_lock|percpu_rwsem_wait|inode_dio_wait|__lock_sock)$/,
    info: {
      kind: 'a kernel lock',
      note: 'Queued behind another task holding a lock inside the kernel — the mmap lock and an inode’s rwsem are the usual two. Several processes stopped at the same one is contention rather than a coincidence',
      uninterruptible: true,
    },
  },
  {
    test: /^(?:hrtimer_nanosleep|do_nanosleep|schedule_timeout(?:_interruptible|_uninterruptible|_killable)?|schedule_hrtimeout_range(?:_clock)?|msleep|usleep_range)$/,
    info: {
      kind: 'a clock',
      note: 'Asleep until a time rather than until an event — a sleep(), a poll interval, a retry backoff. Nothing is wrong with a process here; it asked to be left alone',
    },
  },
  {
    test: /^(?:pipe_read|pipe_write|pipe_wait|__pipe_lock)$/,
    info: {
      kind: 'a pipe',
      note: 'One end of a pipe waiting for the other. A pipeline stops here when the reader is slow, or when the writer never got around to writing',
    },
  },
  {
    test: /^(?:n_tty_read|tty_wait_until_sent|tty_read|read_chan)$/,
    info: {
      kind: 'a terminal',
      note: 'Waiting for a line to be typed. This is a shell at its prompt, and a shell at its prompt is not stuck',
    },
  },
  {
    test: /^(?:sk_wait_data|inet_csk_accept|unix_stream_(?:read_generic|data_wait)|sk_stream_wait_memory|skb_wait_for_more_packets|tcp_recvmsg|wait_woken)$/,
    info: {
      kind: 'a socket',
      note: 'Waiting on a socket — for a connection to arrive, for bytes to read, or for room to write. A server with all its workers here is idle; one with them all in sk_stream_wait_memory is being throttled by the far end',
    },
  },
  {
    test: /^(?:do_wait|kernel_wait4|wait_consider_task)$/,
    info: {
      kind: 'a child process',
      note: 'Waiting for a child to exit — wait(), waitpid(), or a shell that has run something in the foreground. The interesting process is the child, not this one',
    },
  },
  {
    test: /^(?:inotify_read|fanotify_read|signalfd_read|eventfd_read|do_sigtimedwait|pause|do_signal_stop)$/,
    info: {
      kind: 'a notification',
      note: 'Waiting to be told about something — a file event, a signal, an eventfd write. A watcher process lives here',
    },
  },
  {
    test: /^ptrace_stop$/,
    info: {
      kind: 'a debugger',
      note: 'Stopped under ptrace and waiting to be let go. A debugger has it, or something attached and died without detaching',
    },
  },
  {
    test: /^(?:worker_thread|rescuer_thread|kthreadd|smpboot_thread_fn|irq_thread|kswapd|kcompactd|khugepaged|ksm_scan_thread|rcu_gp_kthread|rcu_nocb_gp_kthread|kauditd_thread|devtmpfsd|watchdog|hub_event)$/,
    info: {
      kind: 'a kernel thread’s own loop',
      note: 'A kernel thread parked in the loop it spends its life in, waiting for work to be handed to it. This is the resting state of a kernel thread and says nothing is happening rather than that something is wrong',
      idle: true,
    },
  },
  {
    test: /^(?:wait_for_completion(?:_killable|_interruptible|_timeout)?|__wait_for_common|wait_for_common)$/,
    info: {
      kind: 'a completion',
      note: 'Waiting on the kernel’s generic "tell me when you are done" primitive. What it is waiting *for* is not in the name — the frame below this one would say, and this file only prints the one',
    },
  },
];

/**
 * What a wait in this kernel function means, by symbol name alone.
 *
 * Exported because `/proc/<pid>/stack` asks the same question of every frame it
 * prints — the symbol `wchan` names is one of them, picked by the same unwinder
 * — and what a family of wait means is one fact rather than two that have to
 * agree. See `src/lib/pid-stack.ts`.
 */
export function describeSymbol(name: string): WchanInfo | null {
  return FAMILIES.find((family) => family.test.test(name))?.info ?? null;
}

/**
 * What the process is waiting for, for the symbols that turn up in practice.
 * Null for anything else, including `0` and an unresolved address, which
 * {@link isZero} and {@link isUnresolved} answer for instead.
 */
export function describeWchan(wchan: WchanSymbol): WchanInfo | null {
  if (isZero(wchan) || isEmpty(wchan) || isUnresolved(wchan)) return null;

  return describeSymbol(wchan.name);
}

/**
 * Whether this is the sleep that ignores signals and counts towards the load
 * average — `D` in `ps`, and the state behind a load of 40 on a machine whose
 * CPUs are idle.
 */
export function isUninterruptible(wchan: WchanSymbol): boolean {
  return describeWchan(wchan)?.uninterruptible === true;
}

export interface WchanSummary {
  symbol: string;
  name: string;
  module: string | null;
  /** The kernel had nothing to name: on a CPU, not blocked, or not ours to read. */
  zero: boolean;
  /** Nothing in the file at all, which is not a state a live process has. */
  empty: boolean;
  /** An address rather than a symbol, so nothing resolved it. */
  unresolved: boolean;
  /** The symbol came out of a loadable module. */
  fromModule: boolean;
  /** The kernel writes no newline here, so this being true is the odd case. */
  terminated: boolean;
  info: WchanInfo | null;
  /** The wait ignores signals and is counted in the load average. */
  uninterruptible: boolean;
}

export function summarize(wchan: WchanSymbol): WchanSummary {
  const info = describeWchan(wchan);

  return {
    symbol: wchan.symbol,
    name: wchan.name,
    module: wchan.module,
    zero: isZero(wchan),
    empty: isEmpty(wchan),
    unresolved: isUnresolved(wchan),
    fromModule: isModuleSymbol(wchan),
    terminated: wchan.terminated,
    info,
    uninterruptible: info?.uninterruptible === true,
  };
}
