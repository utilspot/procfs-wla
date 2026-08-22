import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPidStackFixture as fixture } from '../test/fixtures';
import {
  describeFrame,
  formatOffset,
  framesOfRole,
  innermost,
  isEmpty,
  isKernelThread,
  isReadingItself,
  isSleeping,
  isTruncated,
  leakedAddresses,
  MAX_DEPTH,
  offsetShare,
  outermost,
  parsePidStack,
  PLACEHOLDER,
  roleOf,
  summarize,
  syscallName,
  waitFrame,
} from './pid-stack';
import { isZero, parseWchan } from './wchan';

describe('parsePidStack — a shell waiting for a keystroke', () => {
  const stack = parsePidStack(fixture('tty-read'));

  it('reads a frame per line, innermost first', () => {
    expect(stack.frames).toHaveLength(11);
    expect(innermost(stack)!.name).toBe('__schedule');
    expect(innermost(stack)!.depth).toBe(0);
    expect(outermost(stack)!.name).toBe('entry_SYSCALL_64_after_hwframe');
    expect(stack.malformed).toEqual([]);
  });

  it('takes the symbol, the offset and the size off each frame', () => {
    const frame = stack.frames[4]!;

    expect(frame).toMatchObject({ name: 'n_tty_read', offset: 0x4f1, size: 0x870, module: null });
    expect(formatOffset(frame)).toBe('+0x4f1/0x870');
    expect(offsetShare(frame)).toBeCloseTo(0x4f1 / 0x870, 6);
  });

  /** The zero is typed into the format string; it is not an address. */
  it('reads every bracket as the placeholder it is', () => {
    expect(stack.frames.every((frame) => frame.bracket === PLACEHOLDER)).toBe(true);
    expect(leakedAddresses(stack)).toEqual([]);
  });

  /** get_wchan skips the __sched frames and names the first one that says why. */
  it('picks the frame wchan would name', () => {
    expect(isSleeping(stack)).toBe(true);
    // Not `schedule_timeout` or `wait_woken`: both carry `__sched` too, which
    // is why `ps` shows a shell on a terminal as `n_tty_read`.
    expect(waitFrame(stack)!.name).toBe('n_tty_read');
    expect(framesOfRole(stack, 'scheduler').map((f) => f.name)).toEqual([
      '__schedule',
      'schedule',
      'schedule_timeout',
      'wait_woken',
    ]);
  });

  /** The one thing this file has that /proc/<pid>/syscall does not: a name. */
  it('names the system call rather than numbering it', () => {
    expect(syscallName(stack)).toBe('read');
    expect(framesOfRole(stack, 'entry').map((f) => f.name)).toEqual([
      'do_syscall_64',
      'entry_SYSCALL_64_after_hwframe',
    ]);
    expect(isKernelThread(stack)).toBe(false);
  });
});

describe('parsePidStack — blocked on a userspace lock', () => {
  const stack = parsePidStack(fixture('futex', '12282'));

  it('reads the wait out of the shared symbol table', () => {
    const waiting = waitFrame(stack)!;

    expect(waiting.name).toBe('futex_wait_queue_me');
    expect(describeFrame(waiting)!.kind).toBe('a futex');
    expect(describeFrame(waiting)!.uninterruptible).toBeUndefined();
    expect(syscallName(stack)).toBe('futex');
  });
});

/** The kind of sleep that ignores signals and still counts in the load average. */
describe('parsePidStack — waiting on a disk', () => {
  const stack = parsePidStack(fixture('disk-io', '4242'));

  it('marks the wait as the uninterruptible kind', () => {
    const info = describeFrame(waitFrame(stack)!)!;

    expect(info.uninterruptible).toBe(true);
    expect(info.kind).toBe('disk I/O');
    expect(syscallName(stack)).toBe('pread64');
  });
});

/** No userspace under it, so no system call anywhere in the chain. */
describe('parsePidStack — a kernel thread', () => {
  const stack = parsePidStack(fixture('kworker', '901'));

  it('reads a chain with no system call as a kernel thread', () => {
    expect(isKernelThread(stack)).toBe(true);
    expect(syscallName(stack)).toBeNull();
    expect(outermost(stack)!.name).toBe('ret_from_fork');
    expect(roleOf(stack.frames[2]!)).toBe('kthread');
  });

  it('still names the frame wchan would', () => {
    expect(waitFrame(stack)!.name).toBe('worker_thread');
    expect(isSleeping(stack)).toBe(true);
  });
});

/** The unwinder runs in the reader, so this is the read that is asking. */
describe('parsePidStack — a task unwinding itself', () => {
  const stack = parsePidStack(fixture('reading-itself'));

  it('recognises the proc read path', () => {
    expect(isReadingItself(stack)).toBe(true);
    expect(innermost(stack)!.name).toBe('proc_pid_stack');
    // Not asleep: the task is on a CPU, running the read.
    expect(isSleeping(stack)).toBe(false);
    expect(waitFrame(stack)).toBeNull();
    expect(syscallName(stack)).toBe('read');
  });
});

describe('parsePidStack — what is not this file', () => {
  it('reads an empty file as empty', () => {
    const stack = parsePidStack('');

    expect(isEmpty(stack)).toBe(true);
    expect(stack.frames).toEqual([]);
    expect(summarize(stack)).toMatchObject({ frames: 0, innermost: null, syscall: null });
  });

  it('keeps a line that is not a frame aside', () => {
    const stack = parsePidStack('[<0>] schedule+0x1/0x2\nnot a frame\n');

    expect(stack.malformed).toEqual(['not a frame']);
    expect(stack.frames).toHaveLength(1);
  });

  /** A real address in the brackets is a KASLR leak, not a formatting quirk. */
  it('names brackets holding an address rather than the frozen zero', () => {
    const stack = parsePidStack(
      '[<ffffffff810a2b3c>] schedule+0x1/0x2\n[<0>] do_syscall_64+0x5/0x6\n',
    );

    expect(leakedAddresses(stack).map((frame) => frame.name)).toEqual(['schedule']);
    expect(summarize(stack).leaked).toBe(1);
  });

  it('reads a frame with no offset, and one from a module', () => {
    const stack = parsePidStack('[<0>] rpc_wait_bit_killable+0x1a/0x30 [sunrpc]\n[<0>] schedule\n');

    expect(stack.frames[0]!.module).toBe('sunrpc');
    expect(describeFrame(stack.frames[0]!)!.kind).toBe('a network filesystem');
    expect(stack.frames[1]).toMatchObject({ offset: null, size: null });
    expect(formatOffset(stack.frames[1]!)).toBeNull();
  });

  /** The kernel stops at MAX_STACK_TRACE_DEPTH without saying it has. */
  it('reads a trace at the cap as one that probably went further', () => {
    const deep = Array.from({ length: MAX_DEPTH }, (_, i) => `[<0>] frame_${i}+0x1/0x2`).join('\n');

    expect(isTruncated(parsePidStack(deep))).toBe(true);
    expect(isTruncated(parsePidStack(fixture('tty-read')))).toBe(false);
  });

  it('gives no wait frame for a task that is not asleep', () => {
    const stack = parsePidStack('[<0>] vfs_read+0x1/0x2\n[<0>] do_syscall_64+0x3/0x4\n');

    expect(isSleeping(stack)).toBe(false);
    expect(waitFrame(stack)).toBeNull();
  });
});

/**
 * `wchan` is a frame the kernel picked off this very stack, so a capture that
 * has both files has one unwind seen twice — and the machine captures are
 * generated from the `wchan` beside them so the pair cannot drift apart.
 */
describe('the machine captures, against the wchan beside them', () => {
  const root = resolve(process.cwd(), 'server/machines');
  const machines = ['container', 'desktop', 'raspberry-pi', 'server', 'vm'];
  const pids = ['1', '12282', 'self'];
  const all = machines.flatMap((machine) => pids.map((pid) => ({ machine, pid })));

  const dirOf = (machine: string, pid: string) => resolve(root, machine, 'proc', pid);
  const stackOf = (machine: string, pid: string) =>
    parsePidStack(readFileSync(resolve(dirOf(machine, pid), 'stack'), 'utf8'));

  const paired = all.filter(({ machine, pid }) =>
    existsSync(resolve(dirOf(machine, pid), 'wchan')),
  );

  it('has a stack beside every per-process capture', () => {
    for (const { machine, pid } of all) {
      expect(existsSync(resolve(dirOf(machine, pid), 'stack')), `${machine}/${pid}`).toBe(true);
    }
  });

  it.each(paired)('$machine/$pid holds the frame its own wchan names', ({ machine, pid }) => {
    const stack = stackOf(machine, pid);
    const wchan = parseWchan(readFileSync(resolve(dirOf(machine, pid), 'wchan'), 'utf8'));

    if (isZero(wchan)) {
      // wchan says nothing, so the task is not asleep — and neither is the stack.
      expect(isSleeping(stack)).toBe(false);
    } else {
      expect(stack.frames.map((frame) => frame.name)).toContain(wchan.name);
      expect(waitFrame(stack)!.name).toBe(wchan.name);
    }
  });

  it.each(all)('$machine/$pid is a chain the kernel could have printed', ({ machine, pid }) => {
    const stack = stackOf(machine, pid);

    expect(stack.malformed).toEqual([]);
    expect(leakedAddresses(stack)).toEqual([]);
    expect(isTruncated(stack)).toBe(false);
    expect(stack.frames.length).toBeGreaterThan(0);
    // A userspace task came in through a syscall; a kernel thread did not.
    expect(syscallName(stack) === null).toBe(isKernelThread(stack));
  });

  /** The Pi is arm64, so its entry frames are arm64's rather than x86's. */
  it('gives the raspberry-pi captures arm64 entry frames', () => {
    for (const pid of pids) {
      const names = stackOf('raspberry-pi', pid).frames.map((frame) => frame.name);

      expect(names).not.toContain('entry_SYSCALL_64_after_hwframe');
      expect(names.some((name) => /^(?:el0t?_64_sync|ret_from_fork)/.test(name))).toBe(true);
    }
  });
});
