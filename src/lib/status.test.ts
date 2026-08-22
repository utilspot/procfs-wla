import { describe, expect, it } from 'vitest';
import { readStatusFixture as fixture } from '../test/fixtures';
import {
  bytes,
  CAPABILITIES,
  CAP_SYS_ADMIN,
  capabilitiesIn,
  capabilityName,
  decodeField,
  describeField,
  find,
  formatCapabilities,
  formatSignals,
  idSet,
  innermostPid,
  isFullSet,
  isNamespaceInit,
  isSetuid,
  mask,
  namespaceDepth,
  num,
  numbers,
  parseStatus,
  signalName,
  signalsIn,
  state,
  summarize,
  UNBLOCKABLE,
  value,
} from './status';

describe('parseStatus', () => {
  const status = parseStatus(fixture('desktop', 'self'));

  it('reads a label and its value off every line, in the kernel’s order', () => {
    expect(status.entries[0]).toMatchObject({ name: 'Name', value: 'bash', line: 1 });
    expect(value(status, 'State')).toBe('S (sleeping)');
    expect(find(status, 'VmRSS')?.value).toBe('5568 kB');
    expect(status.malformed).toEqual([]);
  });

  /** The kernel pads the memory lines to eight columns; the padding is not data. */
  it('trims the padding off a value', () => {
    expect(value(status, 'VmPeak')).toBe('14172 kB');
    expect(num(status, 'VmPeak')).toBe(14172);
    expect(bytes(status, 'VmPeak')).toBe(14172 * 1024);
  });

  it('keeps a line with no label rather than inventing a field', () => {
    const odd = parseStatus('Name:\tbash\nnot a field at all\nThreads:\t1\n');

    expect(odd.entries).toHaveLength(2);
    expect(odd.malformed).toEqual(['not a field at all']);
  });

  it('has nothing to say about a label this kernel did not print', () => {
    const legacy = parseStatus(fixture('legacy-3.x', 'self'));

    expect(find(legacy, 'Umask')).toBeNull();
    expect(value(legacy, 'Umask')).toBeNull();
    expect(num(legacy, 'Umask')).toBeNull();
    expect(numbers(legacy, 'NSpid')).toEqual([]);
  });
});

/**
 * Four ids, not one: real, effective, saved-set and filesystem. The effective
 * one is what every access check uses.
 */
describe('the id quad', () => {
  it('is read in the order the kernel prints it', () => {
    const ids = idSet(parseStatus(fixture('setuid', 'self')), 'Uid');

    expect(ids).toEqual({ real: 1000, effective: 0, saved: 0, filesystem: 0 });
  });

  it('says a setuid binary is running where the real and effective ids differ', () => {
    expect(isSetuid(idSet(parseStatus(fixture('setuid', 'self')), 'Uid'))).toBe(true);
    expect(isSetuid(idSet(parseStatus(fixture('desktop', 'self')), 'Uid'))).toBe(false);
  });

  it('is nothing where the line is not four ids', () => {
    expect(idSet(parseStatus('Uid:\t1000\t1000\n'), 'Uid')).toBeNull();
    expect(isSetuid(null)).toBe(false);
  });
});

/**
 * The masks are 64 bits and the signals are numbered from one, so bit n is
 * signal n+1 — the off-by-one everything reading them gets wrong once.
 */
describe('signalsIn', () => {
  it('reads bit 0 as signal 1', () => {
    expect(signalsIn(0x1n)).toEqual([1]);
    expect(signalsIn(0x2n)).toEqual([2]);
    expect(signalsIn(0x100n)).toEqual([9]);
  });

  it('finds every signal a mask holds', () => {
    // SIGINT, SIGTERM and SIGCHLD: bits 1, 14 and 16.
    expect(signalsIn(0x1_4002n)).toEqual([2, 15, 17]);
  });

  it('finds none in an empty mask', () => {
    expect(signalsIn(0n)).toEqual([]);
    expect(formatSignals([])).toBe('none');
  });

  it('reaches the real-time signals at the top of the word', () => {
    expect(signalsIn(1n << 63n)).toEqual([64]);
  });

  it('reads the handlers a shell installs out of its own file', () => {
    const caught = mask(parseStatus(fixture('desktop', 'self')), 'SigCgt');

    expect(formatSignals(signalsIn(caught!))).toBe('INT TERM CHLD TSTP WINCH');
  });
});

describe('signalName', () => {
  it('names the standard signals', () => {
    expect(signalName(1)).toBe('HUP');
    expect(signalName(9)).toBe('KILL');
    expect(signalName(15)).toBe('TERM');
    expect(signalName(31)).toBe('SYS');
  });

  /** The two the C library takes before a program sees any. */
  it('marks the pair glibc keeps for itself', () => {
    expect(signalName(32)).toContain('glibc');
    expect(signalName(33)).toContain('glibc');
  });

  it('numbers the real-time signals from RTMIN', () => {
    expect(signalName(34)).toBe('RTMIN');
    expect(signalName(38)).toBe('RTMIN+4');
    expect(signalName(64)).toBe('RTMIN+30');
  });

  /** Nine and nineteen, which no mask may ever block, catch or ignore. */
  it('knows the two that cannot be caught', () => {
    expect(UNBLOCKABLE.map(signalName)).toEqual(['KILL', 'STOP']);
  });
});

/**
 * Real root's mask is an unbroken run of ones from bit 0, however many the
 * kernel has. A set with a hole in it was assembled by something.
 */
describe('isFullSet', () => {
  it('is true for every capability, on a kernel of any vintage', () => {
    expect(isFullSet((1n << 41n) - 1n)).toBe(true);
    expect(isFullSet((1n << 38n) - 1n)).toBe(true);
    expect(isFullSet((1n << 36n) - 1n)).toBe(true);
  });

  it('is false for a set somebody picked, however many bits it holds', () => {
    // Docker's default: fourteen capabilities, and not root.
    expect(isFullSet(0xa80425fbn)).toBe(false);
    expect(isFullSet(0n)).toBe(false);
    expect(isFullSet(0x2000n)).toBe(false);
  });

  /** A run of ones too short to be any kernel's full set is not one. */
  it('is false for a handful of low capabilities', () => {
    expect(isFullSet(0xffn)).toBe(false);
  });
});

describe('capabilitiesIn', () => {
  it('reads each set bit as the capability it stands for', () => {
    expect(capabilitiesIn(0n)).toEqual([]);
    expect(capabilitiesIn(0x1n)).toEqual([0]);
    expect(capabilityName(0)).toBe('CAP_CHOWN');
    expect(capabilityName(CAP_SYS_ADMIN)).toBe('CAP_SYS_ADMIN');
  });

  /** Docker's default set, which is the one worth recognising on sight. */
  it('takes a container’s set apart', () => {
    const set = mask(parseStatus(fixture('container', 'self')), 'CapEff');

    expect(formatCapabilities(capabilitiesIn(set!))).toBe(
      'CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER CAP_FSETID CAP_KILL CAP_SETGID CAP_SETUID ' +
        'CAP_SETPCAP CAP_NET_BIND_SERVICE CAP_NET_RAW CAP_SYS_CHROOT CAP_MKNOD ' +
        'CAP_AUDIT_WRITE CAP_SETFCAP',
    );
    // And not the one that would have given most of root back.
    expect(capabilitiesIn(set!)).not.toContain(CAP_SYS_ADMIN);
  });

  it('names a bit past the end of the table rather than dropping it', () => {
    expect(capabilityName(CAPABILITIES.length)).toContain(`bit ${CAPABILITIES.length}`);
  });
});

describe('state', () => {
  it('takes the letter and the kernel’s own name for it apart', () => {
    expect(state(parseStatus(fixture('desktop', 'self')))).toEqual({
      letter: 'S',
      name: 'sleeping',
    });
    expect(state(parseStatus(fixture('traced', 'self')))).toEqual({
      letter: 't',
      name: 'tracing stop',
    });
  });

  it('is nothing where the line is missing', () => {
    expect(state(parseStatus('Name:\tbash\n'))).toBeNull();
  });
});

/** One entry per namespace the process is nested in, outermost first. */
describe('the namespace lists', () => {
  const container = parseStatus(fixture('container', 'self'));

  it('read a second entry as the pid seen from inside', () => {
    expect(numbers(container, 'NSpid')).toEqual([3390, 1]);
    expect(namespaceDepth(container)).toBe(2);
    expect(innermostPid(container)).toBe(1);
  });

  it('read a single entry as a process in no namespace of its own', () => {
    const desktop = parseStatus(fixture('desktop', 'self'));

    expect(namespaceDepth(desktop)).toBe(1);
    expect(innermostPid(desktop)).toBe(3117);
    expect(isNamespaceInit(desktop)).toBe(false);
  });

  /**
   * Pid 1 of a namespace has a signal with no handler discarded rather than
   * taking its default action, which is why a shell as a container's pid 1
   * ignores the SIGTERM a stop sends.
   */
  it('spot the pid 1 of a namespace, which signals treat differently', () => {
    expect(isNamespaceInit(container)).toBe(true);
    // Pid 1 on the host is not this: it is not nested in anything.
    expect(isNamespaceInit(parseStatus(fixture('desktop', '1')))).toBe(false);
    // Nor is another process in the same container.
    expect(isNamespaceInit(parseStatus(fixture('container', '5150')))).toBe(false);
  });
});

describe('describeField', () => {
  it('has a note for the lines that read wrong', () => {
    expect(describeField('FDSize')?.note).toContain('not the number of open descriptors');
    expect(describeField('VmRSS')?.note).toContain('overcounts');
    expect(describeField('ShdPnd')?.note).toContain('kill(2)');
    expect(describeField('CapBnd')?.note).toContain('only shrinks');
  });

  it('says which kernel a recent line arrived in', () => {
    expect(describeField('Umask')?.since).toBe('4.7');
    expect(describeField('CapAmb')?.since).toBe('4.3');
    expect(describeField('Kthread')?.since).toBe('6.9');
  });

  it('has nothing for a line it does not know', () => {
    expect(describeField('SomethingNewInSixEight')).toBeNull();
  });
});

describe('decodeField', () => {
  it('turns a kilobyte figure into what it is', () => {
    expect(decodeField('VmRSS', '5568 kB')).toBe('5.4 MiB');
    // Nothing to add to a zero.
    expect(decodeField('VmSwap', '0 kB')).toBeNull();
  });

  it('turns a signal mask into names', () => {
    expect(decodeField('SigCgt', '0000000000010002')).toBe('INT CHLD');
  });

  it('turns a capability mask into names', () => {
    expect(decodeField('CapEff', '0000000000200000')).toBe('CAP_SYS_ADMIN');
    expect(decodeField('CapEff', '0000000000000000')).toBe('none');
  });

  /** Naming all forty-one says less than saying it is all of them. */
  it('sums a full set up rather than listing it', () => {
    expect(decodeField('CapEff', '000001ffffffffff')).toBe(
      'every capability there is — 41 on this kernel',
    );
  });

  it('labels the four ids on a quad', () => {
    expect(decodeField('Uid', '1000\t0\t0\t0')).toBe(
      'real 1000, effective 0, saved set 0, filesystem 0',
    );
  });

  it('says which way round a namespace list reads', () => {
    expect(decodeField('NSpid', '3390\t1')).toBe('1 in the innermost namespace, 3390 outside it');
    // A single entry says nothing worth adding.
    expect(decodeField('NSpid', '3117')).toBeNull();
  });

  it('names the seccomp mode a number stands for', () => {
    expect(decodeField('Seccomp', '2')).toContain('filter');
    expect(decodeField('Seccomp', '0')).toBe('off');
  });

  it('reads the flags as yes and no', () => {
    expect(decodeField('NoNewPrivs', '1')).toBe('yes');
    expect(decodeField('CoreDumping', '0')).toBe('no');
  });

  it('has nothing to add to a line it has no note for', () => {
    expect(decodeField('SomethingNewInSixEight', '1')).toBeNull();
  });
});

describe('summarize', () => {
  it('reads an ordinary process off the desktop', () => {
    const summary = summarize(parseStatus(fixture('desktop', 'self')));

    expect(summary).toMatchObject({
      name: 'bash',
      pid: 3117,
      ppid: 3116,
      threads: 1,
      tracer: 0,
      setuid: false,
      fullCapabilities: false,
      sysAdmin: false,
      depth: 1,
      namespaceInit: false,
    });
    expect(summary.rssBytes).toBe(5568 * 1024);
    expect(summary.state?.name).toBe('sleeping');
    expect(summary.unknown).toEqual([]);
  });

  /** Uid 0 and an empty effective set is a process that gave its privilege away. */
  it('tells holding every capability from merely being root', () => {
    const root = summarize(parseStatus(fixture('desktop', '1')));
    const container = summarize(parseStatus(fixture('container', 'self')));

    expect(root.uid?.effective).toBe(0);
    expect(root.fullCapabilities).toBe(true);
    expect(root.sysAdmin).toBe(true);

    // A container's set has holes in it, so it is not root however many bits
    // it holds — it is everything the bounding set was left with.
    expect(container.uid?.effective).toBe(0);
    expect(container.fullCapabilities).toBe(false);
    expect(container.atCeiling).toBe(true);
    expect(container.sysAdmin).toBe(false);
  });

  it('notices a debugger holding the process', () => {
    const summary = summarize(parseStatus(fixture('traced', 'self')));

    expect(summary.tracer).toBe(7780);
    expect(summary.state?.letter).toBe('t');
    // Sent to the process rather than to one of its threads.
    expect(summary.pendingShared).toEqual([15]);
  });

  it('carries the context switch counts, which say what a process is short of', () => {
    const summary = summarize(parseStatus(fixture('desktop', '12282')));

    expect(summary.voluntary).toBe(4128843);
    expect(summary.nonvoluntary).toBe(918224);
    expect(summary.threads).toBe(214);
    expect(summary.swapBytes).toBe(214880 * 1024);
  });

  it('reads a kernel that printed half of these lines', () => {
    const summary = summarize(parseStatus(fixture('legacy-3.x', 'self')));

    expect(summary.name).toBe('sshd');
    expect(summary.count).toBeLessThan(summarize(parseStatus(fixture('desktop', 'self'))).count);
    // Nothing invented for what it did not print.
    expect(summary.depth).toBe(0);
    expect(summary.innerPid).toBeNull();
    expect(summary.noNewPrivs).toBe(false);
    expect(summary.unknown).toEqual([]);
  });
});

// Any of these can turn up on a given server run, so every one is parsed here.
describe.each([
  { fixture: 'desktop', pid: 'self', name: 'bash' },
  { fixture: 'desktop', pid: '1', name: 'systemd' },
  { fixture: 'desktop', pid: '12282', name: 'Isolated Web Co' },
  { fixture: 'setuid', pid: 'self', name: 'sudo' },
  { fixture: 'setuid', pid: '901', name: 'ping' },
  { fixture: 'container', pid: 'self', name: 'sh' },
  { fixture: 'container', pid: '5150', name: 'nginx' },
  { fixture: 'traced', pid: 'self', name: 'a.out' },
  { fixture: 'traced', pid: '7780', name: 'gdb' },
  { fixture: 'legacy-3.x', pid: 'self', name: 'sshd' },
])('every fixture: $fixture, pid $pid', ({ fixture: set, pid, name }) => {
  const status = parseStatus(fixture(set, pid));

  it(`reads ${name}, with every line accounted for`, () => {
    expect(value(status, 'Name')).toBe(name);
    expect(status.malformed).toEqual([]);
    expect(summarize(status).unknown).toEqual([]);
  });

  /** VmRSS is the sum of the three lines under it, where a kernel prints them. */
  it('adds its resident memory up the way the kernel does', () => {
    const rss = num(status, 'VmRSS');
    const anon = num(status, 'RssAnon');
    if (rss === null || anon === null) return;

    expect(anon + num(status, 'RssFile')! + num(status, 'RssShmem')!).toBe(rss);
  });
});
