/**
 * Parser for `/proc/<pid>/stack` — the kernel stack of one task, frame by
 * frame.
 *
 * The fullest of three answers to *where is this process?* that `/proc` gives,
 * and the other two are pages here already: `/proc/<pid>/wchan` names **one**
 * frame, `/proc/<pid>/syscall` names the call it came in through, and this
 * names the whole chain between them. All three come off the same unwind.
 *
 *     [<0>] ep_poll+0x2f9/0x350
 *     [<0>] do_epoll_wait+0xb1/0xd0
 *     [<0>] __x64_sys_epoll_wait+0x6d/0x110
 *     [<0>] do_syscall_64+0x5c/0xc0
 *     [<0>] entry_SYSCALL_64_after_hwframe+0x44/0xae
 *
 * Five things it is read wrong for:
 *
 *  - **`[<0>]` is a literal zero, not an address.** The format string in
 *    `proc_pid_stack` is `"[<0>] %pB\n"` — the zero is typed into it. Older
 *    kernels printed the real return address there, which is why the brackets
 *    exist at all; printing it defeated KASLR, so the value went and the
 *    brackets stayed. A bracket holding anything else is a kernel address on
 *    display, which is worth saying out loud. See {@link PLACEHOLDER}.
 *  - **Innermost first.** The top line is where the task is *now* and the
 *    bottom is how it got into the kernel. A reader taking the first line as
 *    the entry point has the chain upside down.
 *  - **The offsets are already corrected.** `%pB` is the *backtrace* spelling
 *    of `%pS`: it looks the address up after subtracting one, because a return
 *    address points at the instruction **after** the call, which for a call in
 *    the last byte of a function resolves to the next function entirely. So
 *    every frame here names the function that was really called.
 *  - **It is a racy sample of a moving target.** The comment above the function
 *    says so in as many words: unwinding a *running* task is unsound, and the
 *    result may be frames that were never on the stack together. It is
 *    trustworthy for a task that is asleep and not much else — which is the
 *    same caveat `wchan` carries, for the same reason.
 *  - **Reading it from your own process shows you the read.** `/proc/self/stack`
 *    unwinds the task doing the unwinding, so what comes back is `seq_read`,
 *    `vfs_read` and the syscall that asked. It is not a bug and it is the same
 *    every time. See {@link isReadingItself}.
 *
 * The file needs `CONFIG_STACKTRACE`, is mode **0400**, and is guarded by
 * `lock_trace`, which demands `PTRACE_MODE_ATTACH_FSCREDS` — a **stricter**
 * test than the `PTRACE_MODE_READ` that `/proc/<pid>/io` and
 * `/proc/<pid>/environ` are behind. A refusal is `EPERM`, the 403 the page
 * reports; a task whose kernel stack has already been freed is `ENOENT`, the
 * 404. At most {@link MAX_DEPTH} frames are ever printed.
 */
import { describeSymbol, type WchanInfo } from './wchan';

/** What the kernel types into the format string where an address used to go. */
export const PLACEHOLDER = '0';

/** `MAX_STACK_TRACE_DEPTH` — frames past this are never printed. */
export const MAX_DEPTH = 64;

/** What a frame is doing in the chain. */
export type FrameRole =
  | 'scheduler'
  | 'wait'
  | 'syscall'
  | 'entry'
  | 'kthread'
  | 'other';

/** One line of the file. */
export interface Frame {
  /** 0 is the innermost frame — where the task is now. */
  depth: number;
  /** The symbol on its own. */
  name: string;
  /** Where in the function the return address points, or null where none was printed. */
  offset: number | null;
  /** The function's size, or null. */
  size: number | null;
  /** The module, for a symbol printed as `foo+0x1/0x2 [sunrpc]`. */
  module: string | null;
  /** What the brackets held. `'0'` on any kernel that is not leaking. */
  bracket: string;
  raw: string;
}

export interface KernelStack {
  frames: Frame[];
  /** Lines that were not a frame. */
  malformed: string[];
  /** What the file held, with the trailing newline off. */
  value: string;
  bytes: number;
}

/** `[<0>] ep_poll+0x2f9/0x350 [module]` — the one shape this file has. */
const FRAME =
  /^\[<([0-9a-fx]+)>\]\s+([A-Za-z_][\w.]*)(?:\+0x([0-9a-f]+)\/0x([0-9a-f]+))?(?:\s+\[(\w+)\])?$/i;

/**
 * Functions the kernel marks `__sched`, which `get_wchan` skips over.
 *
 * The real test is `in_sched_functions()`, an address-range check against the
 * `__sched_text` section — which this file does not give us, so this is the
 * names that section holds in practice. It decides {@link waitFrame}, and being
 * a list rather than a range it is a reading rather than a certainty.
 */
const SCHEDULER = new RegExp(
  '^(?:' +
    // The scheduler proper.
    '__sched(?:ule)?|schedule(?:_timeout(?:_interruptible|_uninterruptible|_killable)?' +
    '|_preempt_disabled|_idle|_hrtimeout(?:_range(?:_clock)?)?)?' +
    '|io_schedule(?:_timeout)?|preempt_schedule\\w*|__cond_resched|_cond_resched' +
    // The wait helpers in kernel/sched/ that carry the same annotation, which is
    // why `ps` shows a bash on a terminal as `n_tty_read` and not `wait_woken`.
    '|wait_woken|prepare_to_wait_event|bit_wait\\w*|out_of_line_wait_on_bit\\w*' +
    '|wait_for_common\\w*|wait_for_completion\\w*|do_wait_for_common' +
    // And the lock slowpaths, which are `__sched` for the same reason.
    '|__mutex_lock\\w*|mutex_lock\\w*|rwsem_down_\\w+_slowpath|down_read\\w*|down_write\\w*' +
  ')$',
);

/** The last frame in, where control crossed from userspace or from a kthread. */
const ENTRY =
  /^(?:entry_SYSCALL(?:_compat)?_64(?:_after_hwframe)?|do_syscall_64|ret_from_fork(?:_asm)?|el0t?_64_sync(?:_handler)?|el0_svc(?:_common|_handler)?|do_el0_svc|invoke_syscall|ret_fast_syscall)$/;

/** `__x64_sys_read`, `__arm64_sys_futex`, `__se_sys_openat` — the call itself. */
const SYSCALL = /^(?:__(?:x64|ia32|arm64|se|do)_)*sys_(\w+)$/;

/** A kernel thread's outer frames, which no userspace task has. */
const KTHREAD = /^(?:kthread|worker_thread|rescuer_thread|smpboot_thread_fn|kthreadd)$/;

export function parsePidStack(text: string): KernelStack {
  const bytes = new TextEncoder().encode(text).length;
  const value = text.replace(/\n+$/, '');
  const frames: Frame[] = [];
  const malformed: string[] = [];

  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;

    const match = FRAME.exec(trimmed);
    if (match === null) {
      malformed.push(trimmed);
      continue;
    }

    const [, bracket, name, offset, size, module] = match as unknown as (string | undefined)[];

    frames.push({
      depth: frames.length,
      name: name!,
      offset: offset === undefined ? null : Number.parseInt(offset, 16),
      size: size === undefined ? null : Number.parseInt(size, 16),
      module: module ?? null,
      bracket: bracket!,
      raw: trimmed,
    });
  }

  return { frames, malformed, value, bytes };
}

/** Whether the file held nothing at all. */
export function isEmpty(stack: KernelStack): boolean {
  return stack.value === '';
}

/** Where the task is right now, which is the first line. */
export function innermost(stack: KernelStack): Frame | null {
  return stack.frames[0] ?? null;
}

/** How it got into the kernel, which is the last. */
export function outermost(stack: KernelStack): Frame | null {
  return stack.frames[stack.frames.length - 1] ?? null;
}

/** What a frame is doing in the chain. */
export function roleOf(frame: Frame): FrameRole {
  if (SCHEDULER.test(frame.name)) return 'scheduler';
  if (ENTRY.test(frame.name)) return 'entry';
  if (SYSCALL.test(frame.name)) return 'syscall';
  if (KTHREAD.test(frame.name)) return 'kthread';
  return describeSymbol(frame.name) === null ? 'other' : 'wait';
}

/** What a wait in this frame means, from the table `wchan` reads with. */
export function describeFrame(frame: Frame): WchanInfo | null {
  return describeSymbol(frame.name);
}

/**
 * The frame `/proc/<pid>/wchan` would name: the innermost one that is not a
 * scheduler function, which is how `get_wchan` picks it.
 *
 * Null where every frame is scheduler internals, or where the task is not
 * asleep at all — in which case `wchan` prints `0` and this agrees with it.
 */
export function waitFrame(stack: KernelStack): Frame | null {
  if (!isSleeping(stack)) return null;
  return stack.frames.find((frame) => !SCHEDULER.test(frame.name)) ?? null;
}

/** Whether the innermost frame is the scheduler, i.e. the task is asleep. */
export function isSleeping(stack: KernelStack): boolean {
  const first = innermost(stack);
  return first !== null && SCHEDULER.test(first.name);
}

/** The frame naming the system call, where the task came in through one. */
export function syscallFrame(stack: KernelStack): Frame | null {
  return stack.frames.find((frame) => SYSCALL.test(frame.name)) ?? null;
}

/**
 * The system call by **name** — `read`, `epoll_wait` — which is the one thing
 * this file has that `/proc/<pid>/syscall` does not: that one gives a number,
 * and the number means different calls on different architectures.
 */
export function syscallName(stack: KernelStack): string | null {
  const frame = syscallFrame(stack);
  return frame === null ? null : (SYSCALL.exec(frame.name)?.[1] ?? null);
}

/**
 * Whether this is a kernel thread: it ends in a kthread frame and never came
 * through a system call, because there is no userspace under it to have made
 * one.
 */
export function isKernelThread(stack: KernelStack): boolean {
  return (
    stack.frames.length > 0 &&
    stack.frames.some((frame) => KTHREAD.test(frame.name)) &&
    syscallFrame(stack) === null
  );
}

/** Frames whose brackets hold something other than the frozen zero. */
export function leakedAddresses(stack: KernelStack): Frame[] {
  return stack.frames.filter((frame) => frame.bracket !== PLACEHOLDER);
}

/** The proc and VFS frames that reading this file puts on a task's own stack. */
const READ_PATH = /^(?:proc_pid_stack|proc_single_show|seq_read(?:_iter)?|vfs_read|ksys_read)$/;

/**
 * Whether this is a task unwinding itself: `/proc/self/stack` shows the read
 * that is asking, every time, because the unwinder runs in the reader.
 *
 * Not a fault and not interesting about the process — but it is the answer
 * people are surprised by, so it is worth naming rather than explaining.
 */
export function isReadingItself(stack: KernelStack): boolean {
  return stack.frames.some((frame) => READ_PATH.test(frame.name));
}

/**
 * Whether the trace may have been cut off. The kernel prints at most
 * {@link MAX_DEPTH} frames and says nothing when it stops, so a trace of
 * exactly that many is one that probably went further.
 */
export function isTruncated(stack: KernelStack): boolean {
  return stack.frames.length >= MAX_DEPTH;
}

/** The frames of one role, in the order they were printed. */
export function framesOfRole(stack: KernelStack, role: FrameRole): Frame[] {
  return stack.frames.filter((frame) => roleOf(frame) === role);
}

export interface StackSummary {
  frames: number;
  /** Where the task is now. */
  innermost: Frame | null;
  /** The frame `wchan` would name, where it is asleep. */
  waiting: Frame | null;
  /** What that wait is, from the shared table. */
  wait: WchanInfo | null;
  syscall: string | null;
  sleeping: boolean;
  kernelThread: boolean;
  readingItself: boolean;
  truncated: boolean;
  leaked: number;
}

export function summarize(stack: KernelStack): StackSummary {
  const waiting = waitFrame(stack);

  return {
    frames: stack.frames.length,
    innermost: innermost(stack),
    waiting,
    wait: waiting === null ? null : describeFrame(waiting),
    syscall: syscallName(stack),
    sleeping: isSleeping(stack),
    kernelThread: isKernelThread(stack),
    readingItself: isReadingItself(stack),
    truncated: isTruncated(stack),
    leaked: leakedAddresses(stack).length,
  };
}

/** `+0x2f9/0x350` — an offset into a function, as the kernel writes it. */
export function formatOffset(frame: Frame): string | null {
  if (frame.offset === null) return null;
  const size = frame.size === null ? '' : `/0x${frame.size.toString(16)}`;
  return `+0x${frame.offset.toString(16)}${size}`;
}

/** How far into the function the return address points, 0 to 1 — null if unknown. */
export function offsetShare(frame: Frame): number | null {
  if (frame.offset === null || frame.size === null || frame.size === 0) return null;
  return Math.min(1, frame.offset / frame.size);
}
