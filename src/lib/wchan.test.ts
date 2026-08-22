import { describe, expect, it } from 'vitest';
import { readWchanFixture as fixture } from '../test/fixtures';
import {
  describeWchan,
  isEmpty,
  isModuleSymbol,
  isUninterruptible,
  isUnresolved,
  isZero,
  NOTHING,
  parseWchan,
  summarize,
} from './wchan';

describe('parseWchan', () => {
  const wchan = parseWchan(fixture('desktop', 'self'));

  /** The kernel writes the symbol and stops — no newline, unlike comm. */
  it('reads the symbol out of a file with no trailing newline', () => {
    expect(wchan.symbol).toBe('n_tty_read');
    expect(wchan.name).toBe('n_tty_read');
    expect(wchan.terminated).toBe(false);
    expect(wchan.bytes).toBe(10);
    expect(wchan.raw).toBe('n_tty_read');
  });

  /**
   * Nothing writes one, so a newline here came from something in between. Take
   * it off rather than carrying it into every comparison.
   */
  it('takes a trailing newline off, and says one was there', () => {
    const padded = parseWchan('n_tty_read\n');

    expect(padded.symbol).toBe('n_tty_read');
    expect(padded.terminated).toBe(true);
    expect(padded.bytes).toBe(11);
  });

  it('reads an empty file as no answer at all', () => {
    expect(isEmpty(parseWchan(''))).toBe(true);
    expect(isEmpty(parseWchan('\n'))).toBe(true);
    expect(isEmpty(parseWchan(fixture('running', 'self')))).toBe(false);
  });
});

/**
 * The one value that is not a symbol, and it stands for three different things
 * — on a CPU, not blocked anywhere nameable, or a read the kernel refused.
 */
describe('isZero', () => {
  it('is true for the 0 the kernel prints where it has nothing to name', () => {
    expect(isZero(parseWchan(fixture('running', 'self')))).toBe(true);
    expect(isZero(parseWchan(fixture('running', '901')))).toBe(true);
    expect(NOTHING).toBe('0');
  });

  it('is false for a symbol', () => {
    expect(isZero(parseWchan(fixture('desktop', 'self')))).toBe(false);
  });

  /** There is nothing to say about a task the kernel would not name. */
  it('leaves the wait undescribed', () => {
    expect(describeWchan(parseWchan(fixture('running', 'self')))).toBeNull();
  });
});

describe('a symbol from a module', () => {
  const wchan = parseWchan(fixture('module-symbol', 'self'));

  it('is split from the module %ps printed beside it', () => {
    expect(wchan.symbol).toBe('rpc_wait_bit_killable [sunrpc]');
    expect(wchan.name).toBe('rpc_wait_bit_killable');
    expect(wchan.module).toBe('sunrpc');
    expect(isModuleSymbol(wchan)).toBe(true);
  });

  /** The family is matched on the function, not on the module beside it. */
  it('is still described by the family its function belongs to', () => {
    expect(describeWchan(wchan)?.kind).toBe('a network filesystem');
    expect(isUninterruptible(wchan)).toBe(true);
  });

  it('leaves a kernel symbol without a module', () => {
    const kernel = parseWchan(fixture('desktop', 'self'));

    expect(kernel.module).toBeNull();
    expect(isModuleSymbol(kernel)).toBe(false);
  });
});

/**
 * `%ps` falls back to the address where nothing resolves it — a kernel without
 * CONFIG_KALLSYMS, or a module missing from the table.
 */
describe('isUnresolved', () => {
  it('is true for an address printed instead of a name', () => {
    const wchan = parseWchan(fixture('module-symbol', '5150'));

    expect(wchan.symbol).toBe('0xffffffffc0a13f20');
    expect(isUnresolved(wchan)).toBe(true);
    expect(describeWchan(wchan)).toBeNull();
  });

  it('is false for a symbol, and for the bare zero', () => {
    expect(isUnresolved(parseWchan(fixture('desktop', 'self')))).toBe(false);
    expect(isUnresolved(parseWchan(fixture('running', 'self')))).toBe(false);
  });
});

describe('describeWchan', () => {
  const describe_ = (symbol: string) => describeWchan(parseWchan(symbol));

  it('reads a futex as a lock that lives in userspace', () => {
    expect(describe_('futex_wait_queue_me')?.kind).toBe('a futex');
    // Renamed in 6.3, and the same wait either way.
    expect(describe_('futex_wait_queue')?.kind).toBe('a futex');
    expect(describe_('do_futex')?.kind).toBe('a futex');
    expect(describe_('futex_wait_queue_me')?.note).toContain('in the program');
  });

  it('reads poll, select and epoll as one idle event loop', () => {
    for (const symbol of ['do_sys_poll', 'do_epoll_wait', 'ep_poll', 'do_select']) {
      expect(describe_(symbol)?.kind, symbol).toBe('an event loop');
    }
  });

  it('reads a terminal read as a shell at its prompt', () => {
    expect(describe_('n_tty_read')?.kind).toBe('a terminal');
    expect(describe_('n_tty_read')?.note).toContain('not stuck');
  });

  it('reads a wait for a child as the shell it usually is', () => {
    expect(describe_('do_wait')?.kind).toBe('a child process');
  });

  it('has no note for a symbol it does not know, rather than a guess', () => {
    expect(describe_('some_kernel_function_nobody_charted')).toBeNull();
  });
});

/** D in ps: deaf to signals, and counted in the load average while it waits. */
describe('isUninterruptible', () => {
  it.each([
    ['folio_wait_bit', 'disk I/O'],
    ['io_schedule', 'disk I/O'],
    ['wait_on_buffer', 'disk I/O'],
    ['jbd2_log_wait_commit', 'a filesystem journal'],
    ['rwsem_down_write_slowpath', 'a kernel lock'],
    ['__mutex_lock', 'a kernel lock'],
  ])('is true for %s, which is %s', (symbol, kind) => {
    const wchan = parseWchan(symbol);

    expect(describeWchan(wchan)?.kind).toBe(kind);
    expect(isUninterruptible(wchan)).toBe(true);
  });

  it.each(['futex_wait_queue_me', 'do_epoll_wait', 'n_tty_read', 'hrtimer_nanosleep'])(
    'is false for %s, which a signal can end',
    (symbol) => {
      expect(isUninterruptible(parseWchan(symbol))).toBe(false);
    },
  );

  it('is false for a symbol with no note, since that is not something to guess', () => {
    expect(isUninterruptible(parseWchan('some_kernel_function_nobody_charted'))).toBe(false);
  });
});

/** A kernel thread parked in its own loop is resting, not stalled. */
describe('an idle kernel thread', () => {
  it.each(['worker_thread', 'kthreadd', 'rescuer_thread', 'smpboot_thread_fn'])(
    'reads %s as the loop it spends its life in',
    (symbol) => {
      const info = describeWchan(parseWchan(symbol));

      expect(info?.idle).toBe(true);
      expect(info?.uninterruptible).toBeUndefined();
    },
  );
});

describe('summarize', () => {
  it('carries the symbol, its family and the state it implies', () => {
    expect(summarize(parseWchan(fixture('blocked-io', 'self')))).toMatchObject({
      symbol: 'folio_wait_bit',
      name: 'folio_wait_bit',
      module: null,
      zero: false,
      empty: false,
      unresolved: false,
      fromModule: false,
      terminated: false,
      uninterruptible: true,
    });
  });

  it('says a zero is a zero and nothing more', () => {
    const summary = summarize(parseWchan(fixture('running', 'self')));

    expect(summary).toMatchObject({ zero: true, info: null, uninterruptible: false });
  });

  it('does not call an unknown symbol uninterruptible', () => {
    expect(summarize(parseWchan('nothing_charted_here'))).toMatchObject({
      info: null,
      uninterruptible: false,
      zero: false,
      unresolved: false,
    });
  });
});

// Any of these can turn up on a given server run, so every one is parsed here.
describe.each([
  { fixture: 'desktop', pid: 'self', name: 'n_tty_read' },
  { fixture: 'desktop', pid: '3117', name: 'do_epoll_wait' },
  { fixture: 'desktop', pid: '12282', name: 'futex_wait_queue_me' },
  { fixture: 'running', pid: 'self', name: '0' },
  { fixture: 'blocked-io', pid: 'self', name: 'folio_wait_bit' },
  { fixture: 'blocked-io', pid: '4242', name: 'jbd2_log_wait_commit' },
  { fixture: 'blocked-io', pid: '88', name: 'rwsem_down_write_slowpath' },
  { fixture: 'kernel-threads', pid: 'self', name: 'worker_thread' },
  { fixture: 'kernel-threads', pid: '2', name: 'kthreadd' },
  { fixture: 'module-symbol', pid: 'self', name: 'rpc_wait_bit_killable' },
  { fixture: 'module-symbol', pid: '5150', name: '0xffffffffc0a13f20' },
])('every fixture: $fixture, pid $pid', ({ fixture: set, pid, name }) => {
  it(`reads ${name}, with no newline after it`, () => {
    const wchan = parseWchan(fixture(set, pid));

    expect(wchan.name).toBe(name);
    // The kernel writes none, and neither does any capture of one.
    expect(wchan.terminated).toBe(false);
    expect(isEmpty(wchan)).toBe(false);
  });
});
