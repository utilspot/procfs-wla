import { describe, expect, it } from 'vitest';
import { readSyscallFixture as fixture } from '../test/fixtures';
import {
  asSigned,
  COMMON_FROM,
  decimal,
  describeSyscall,
  isAddress,
  isCommonNumber,
  namesDiffer,
  namesFor,
  paramsAt,
  parseSyscall,
  summarize,
  syscallName,
} from './syscall';

describe('parseSyscall — a process in a system call', () => {
  const sample = parseSyscall(fixture('desktop', 'self'));

  it('reads the number, the six registers, and the two pointers', () => {
    expect(sample.state).toBe('in-syscall');
    expect(sample.nr).toBe(0);
    expect(sample.args).toEqual(['0x0', '0x7ffd3c4f2a10', '0x2000', '0x0', '0x0', '0x0']);
    expect(sample.sp).toBe('0x7ffd3c4f29c8');
    expect(sample.ip).toBe('0x7f8e2a0f4b52');
  });

  it('keeps the line as it was read', () => {
    expect(sample.raw).toBe(
      '0 0x0 0x7ffd3c4f2a10 0x2000 0x0 0x0 0x0 0x7ffd3c4f29c8 0x7f8e2a0f4b52',
    );
  });
});

describe('parseSyscall — the three shapes the kernel prints', () => {
  /** Not an error: the task is on a CPU, so its registers cannot be sampled. */
  it('reads `running` as the answer it is', () => {
    const sample = parseSyscall(fixture('running', 'self'));

    expect(sample.state).toBe('running');
    expect(sample.nr).toBeNull();
    expect(sample.args).toBeNull();
    expect(sample.sp).toBeNull();
  });

  /** Three fields, not nine — which is what catches a parser that counts. */
  it('reads the `-1` line as a process in userspace, with no arguments', () => {
    const sample = parseSyscall(fixture('userspace', 'self'));

    expect(sample.state).toBe('not-in-syscall');
    expect(sample.nr).toBe(-1);
    expect(sample.args).toBeNull();
    expect(sample.sp).toBe('0x7ffc8e2a1b30');
    expect(sample.ip).toBe('0x7f2c4d1e8a41');
  });

  it('reads a call with an argument of -1 without losing it', () => {
    const sample = parseSyscall(fixture('desktop', '12282'));

    expect(sample.nr).toBe(232);
    expect(sample.args?.[3]).toBe('0xffffffffffffffff');
  });

  it('reads nothing out of a file that is not this one', () => {
    for (const text of ['', 'nonsense', '0 1 2', '0x1 0x2']) {
      expect(parseSyscall(text).state, text).toBe('unreadable');
    }
  });

  it('takes uppercase hex, which some architectures print', () => {
    const sample = parseSyscall('1 0x1 0xDEADBEEF 0x0 0x0 0x0 0x0 0x7FFF0000 0x400000');

    expect(sample.state).toBe('in-syscall');
    expect(sample.args?.[1]).toBe('0xDEADBEEF');
  });
});

/**
 * The file says nothing about the architecture, and the same number is a
 * different call on each — which is why the page shows both rather than one.
 */
describe('the number against the architecture', () => {
  it('names a number under each architecture it knows', () => {
    expect(syscallName(0, 'x86_64')).toBe('read');
    expect(syscallName(0, 'arm64')).toBe('io_setup');
    expect(syscallName(63, 'arm64')).toBe('read');
    expect(syscallName(63, 'x86_64')).toBe('uname');
  });

  /** The example worth knowing: 202 is a lock wait on one and a socket on the other. */
  it('says when the two disagree', () => {
    expect(namesFor(202)).toEqual([
      { abi: 'x86_64', label: 'x86-64', name: 'futex' },
      { abi: 'arm64', label: 'arm64', name: 'accept' },
    ]);
    expect(namesDiffer(202)).toBe(true);
  });

  /** Every syscall since pidfd_send_signal takes the same number everywhere. */
  it('says when a number means the same thing everywhere', () => {
    expect(isCommonNumber(426)).toBe(true);
    expect(isCommonNumber(COMMON_FROM - 1)).toBe(false);
    expect(syscallName(426, 'x86_64')).toBe('io_uring_enter');
    expect(syscallName(426, 'arm64')).toBe('io_uring_enter');
    expect(namesDiffer(426)).toBe(false);
  });

  it('has no name for a number outside its tables', () => {
    expect(syscallName(9999, 'x86_64')).toBeNull();
    expect(namesFor(9999).every((entry) => entry.name === null)).toBe(true);
    // Two nulls are not a disagreement.
    expect(namesDiffer(9999)).toBe(false);
  });

  /**
   * A number this page happens not to have on one architecture is a gap in the
   * table, not the architectures disagreeing — saying otherwise would put
   * "architecture-dependent" on a page that simply has not been filled in.
   */
  it('does not call a gap in its own table a disagreement', () => {
    // 34 is `pause` on x86-64 and nothing this page lists on arm64.
    expect(syscallName(34, 'x86_64')).toBe('pause');
    expect(syscallName(34, 'arm64')).toBeNull();
    expect(namesDiffer(34)).toBe(false);
  });
});

describe('describeSyscall', () => {
  /**
   * Six registers are always printed; only the first few carry an argument,
   * and the rest hold whatever was left in them.
   */
  it('says how many of the six registers are really arguments', () => {
    expect(describeSyscall('read')!.params).toEqual(['fd', 'buf', 'count']);
    expect(describeSyscall('mmap')!.params).toHaveLength(6);
    expect(describeSyscall('pause')!.params).toEqual([]);
  });

  it('has nothing to say about a call it does not know, or no call at all', () => {
    expect(describeSyscall('some_new_syscall')).toBeNull();
    expect(describeSyscall(null)).toBeNull();
  });
});

describe('reading a register', () => {
  it('gives a small value as the number it is', () => {
    expect(decimal('0x0')).toBe('0');
    expect(decimal('0x4')).toBe('4');
    expect(decimal('0x2000')).toBe('8192');
    expect(isAddress('0x4')).toBe(false);
  });

  /** A timeout of "forever" is -1, which is printed as sixteen f's. */
  it('gives an all-ones register as the -1 it stands for', () => {
    expect(asSigned('0xffffffffffffffff')).toBe(-1n);
    expect(decimal('0xffffffffffffffff')).toBe('-1');
  });

  it('leaves an address alone rather than printing it as a decimal', () => {
    expect(decimal('0x7ffd3c4f2a10')).toBeNull();
    expect(isAddress('0x7ffd3c4f2a10')).toBe(true);
  });

  it('reads a 64-bit value without losing precision', () => {
    expect(asSigned('0x7fffffffffffffff')).toBe(9223372036854775807n);
    expect(asSigned('0x8000000000000000')).toBe(-9223372036854775808n);
  });
});

describe('summarize', () => {
  it('summarizes a process blocked in a call it knows', () => {
    const summary = summarize(parseSyscall(fixture('desktop', 'self')));

    expect(summary).toMatchObject({ state: 'in-syscall', nr: 0, ambiguous: true, common: false });
    expect(summary.calls.map((call) => call.name)).toEqual(['read', 'io_setup']);
    expect(summary.calls[0]!.info?.params).toEqual(['fd', 'buf', 'count']);
  });

  /**
   * Where the architectures name the number differently there are two calls to
   * explain, and each is — describing neither would lose the answer in exactly
   * the case the reader needs it.
   */
  it('describes each architecture’s call where they disagree', () => {
    const summary = summarize(parseSyscall(fixture('futex-parked', 'self')));

    expect(summary.nr).toBe(202);
    expect(summary.ambiguous).toBe(true);
    expect(summary.calls.map((call) => call.name)).toEqual(['futex', 'accept']);
    expect(summary.calls[0]!.info?.note).toMatch(/parked on a lock/);
    expect(summary.calls[1]!.info?.note).toMatch(/next connection/);
  });

  /** The arity is the most any candidate takes, so nothing usable is greyed out. */
  it('takes the arity from the longest of the candidate calls', () => {
    // futex takes six, accept three, so no register is called a leftover.
    expect(summarize(parseSyscall(fixture('futex-parked', 'self'))).arity).toBe(6);
    // read takes three and io_setup two.
    expect(summarize(parseSyscall(fixture('desktop', 'self'))).arity).toBe(3);
  });

  it('names a register under each architecture that knows the call', () => {
    const summary = summarize(parseSyscall(fixture('futex-parked', 'self')));

    expect(paramsAt(summary, 0)).toEqual([
      { abi: 'x86_64', label: 'x86-64', name: 'uaddr' },
      { abi: 'arm64', label: 'arm64', name: 'sockfd' },
    ]);
    // accept takes three, so the fourth register is futex's alone.
    expect(paramsAt(summary, 3)).toEqual([
      { abi: 'x86_64', label: 'x86-64', name: 'timeout' },
    ]);
  });

  /** Where they agree, one name — not the same word once per architecture. */
  it('names a register once where the architectures agree on the call', () => {
    const summary = summarize(parseSyscall(fixture('io-uring', 'self')));

    expect(paramsAt(summary, 0)).toEqual([{ abi: 'x86_64', label: 'x86-64', name: 'fd' }]);
    expect(paramsAt(summary, 5)).toHaveLength(1);
  });

  it('describes a call whose number every architecture agrees on', () => {
    const summary = summarize(parseSyscall(fixture('io-uring', 'self')));

    expect(summary).toMatchObject({ nr: 426, ambiguous: false, common: true, arity: 6 });
    expect(summary.calls.every((call) => call.name === 'io_uring_enter')).toBe(true);
  });

  it('has no number to summarize for a running task', () => {
    expect(summarize(parseSyscall(fixture('running', 'self')))).toMatchObject({
      state: 'running',
      nr: null,
      calls: [],
      arity: null,
    });
  });

  it('has no call to name for a task in userspace', () => {
    expect(summarize(parseSyscall(fixture('userspace', 'self')))).toMatchObject({
      state: 'not-in-syscall',
      nr: -1,
      calls: [],
      arity: null,
    });
  });
});
