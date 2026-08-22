import { describe, expect, it } from 'vitest';
import { readCommFixture as fixture } from '../test/fixtures';
import {
  COMM_MAX,
  describeKernelThread,
  hasControlCharacters,
  hasParentheses,
  hasSpaces,
  isEmpty,
  isKernelThread,
  isSynthesised,
  isTruncated,
  parseComm,
  summarize,
} from './comm';

describe('parseComm', () => {
  const thread = parseComm(fixture('desktop', 'self'));

  it('reads the name without the newline the kernel wrote after it', () => {
    expect(thread.name).toBe('bash');
    expect(thread.length).toBe(4);
    expect(thread.terminated).toBe(true);
    // The newline is in the file, and not in the name.
    expect(thread.bytes).toBe(5);
    expect(thread.raw).toBe('bash\n');
  });

  /** A name cannot contain a newline, so there is only ever the one to strip. */
  it('strips exactly one newline, not a run of them', () => {
    expect(parseComm('bash\n\n').name).toBe('bash\n');
  });

  it('takes a file with no trailing newline as it finds it', () => {
    const bare = parseComm('bash');

    expect(bare.name).toBe('bash');
    expect(bare.terminated).toBe(false);
    expect(bare.bytes).toBe(4);
  });

  it('counts bytes rather than JavaScript’s UTF-16 units', () => {
    expect(parseComm('café\n').bytes).toBe(6);
    expect(parseComm('café\n').length).toBe(4);
  });

  it('reads an empty file as no name at all', () => {
    expect(isEmpty(parseComm(''))).toBe(true);
    expect(isEmpty(parseComm('\n'))).toBe(true);
    expect(isEmpty(parseComm('bash\n'))).toBe(false);
  });
});

/**
 * Fifteen characters is the cap on a name a task *stores*, and there is no flag
 * saying one was cut, so a name of exactly that length is the only tell there
 * is. A longer name was never stored at all — see the synthesised names below.
 */
describe('isTruncated', () => {
  it('is true at the cap, where the name may be the front of a longer one', () => {
    expect(COMM_MAX).toBe(15);
    expect(parseComm(fixture('truncated', 'self')).name).toBe('pool-2-thread-1');
    expect(isTruncated(parseComm(fixture('truncated', 'self')))).toBe(true);
    expect(isTruncated(parseComm(fixture('truncated', '901')))).toBe(true);
  });

  it('is false for a name that fits', () => {
    expect(isTruncated(parseComm(fixture('desktop', 'self')))).toBe(false);
    expect(isTruncated(parseComm(fixture('renamed', '3390')))).toBe(false);
  });

  /**
   * The correction this page needed: a name past the cap is not a truncated
   * one, it is one the kernel never truncated because it never stored it.
   */
  it('is false past the cap, where the name was not stored to begin with', () => {
    const long = parseComm(fixture('kernel-threads', '451'));

    expect(long.length).toBe(44);
    expect(isTruncated(long)).toBe(false);
    expect(isSynthesised(long)).toBe(true);
  });
});

/**
 * A workqueue worker's name — and on a 6.x kernel any kernel thread's — is
 * assembled when the file is read rather than returned from the 16 bytes the
 * task stores, which is the only way one gets longer than the cap.
 */
describe('isSynthesised', () => {
  it('is true for a name longer than a task could have stored', () => {
    expect(parseComm(fixture('kernel-threads', '451')).name).toBe(
      'kworker/u29:2-events_freezable_pwr_efficient',
    );
    expect(isSynthesised(parseComm(fixture('kernel-threads', '451')))).toBe(true);
    expect(isSynthesised(parseComm(fixture('kernel-threads', '93')))).toBe(true);
  });

  it('is false for anything that would fit in the stored name', () => {
    expect(isSynthesised(parseComm(fixture('desktop', 'self')))).toBe(false);
    expect(isSynthesised(parseComm(fixture('truncated', 'self')))).toBe(false);
    // Short enough to have been stored, even though it is a kernel thread's.
    expect(isSynthesised(parseComm(fixture('kernel-threads', '142')))).toBe(false);
  });

  it('still takes a long name apart', () => {
    const info = describeKernelThread(parseComm(fixture('kernel-threads', '451')))!;

    expect(info.kind).toBe('workqueue worker');
    expect(info.detail).toBe(
      'unbound pool 29, worker 2, running events_freezable_pwr_efficient',
    );
  });
});

describe('what a name may hold', () => {
  it('takes a name with spaces in it', () => {
    const thread = parseComm(fixture('truncated', '901'));

    expect(thread.name).toBe('Isolated Web Co');
    expect(hasSpaces(thread)).toBe(true);
  });

  /**
   * Harmless here, and the reason reading this same string out of
   * `/proc/<pid>/stat` takes care: that file wraps it in these characters.
   */
  it('takes a name with parentheses in it', () => {
    const thread = parseComm(fixture('renamed', 'self'));

    expect(thread.name).toBe('(sd-pam)');
    expect(hasParentheses(thread)).toBe(true);
    expect(hasParentheses(parseComm(fixture('desktop', 'self')))).toBe(false);
  });

  it('spots a character a terminal would not print', () => {
    expect(hasControlCharacters(parseComm('evil\u001b[2Jname\n'))).toBe(true);
    expect(hasControlCharacters(parseComm(fixture('desktop', 'self')))).toBe(false);
    expect(hasControlCharacters(parseComm(fixture('truncated', '901')))).toBe(false);
  });
});

/**
 * A kernel thread has a name here and no `cmdline` at all, and the names carry
 * structure rather than being arbitrary.
 */
describe('describeKernelThread', () => {
  it('takes a per-CPU workqueue worker apart', () => {
    const info = describeKernelThread(parseComm('kworker/3:1H\n'))!;

    expect(info.kind).toBe('workqueue worker');
    expect(info.cpu).toBe(3);
    expect(info.detail).toContain('cpu 3');
    expect(info.detail).toContain('worker 1');
    expect(info.detail).toContain('high priority');
  });

  /** For an unbound pool the number is a pool id, not a CPU. */
  it('does not read an unbound pool’s number as a CPU', () => {
    const info = describeKernelThread(parseComm(fixture('kernel-threads', '142')))!;

    expect(info.kind).toBe('workqueue worker');
    expect(info.cpu).toBeUndefined();
    expect(info.detail).toContain('unbound pool 16');
    expect(info.note).toContain('not tied to one CPU');
  });

  it('reads the workqueue a worker is currently running', () => {
    expect(describeKernelThread(parseComm('kworker/0:0-events\n'))!.detail).toContain(
      'running events',
    );
  });

  it('takes a threaded interrupt handler apart', () => {
    const info = describeKernelThread(parseComm(fixture('kernel-threads', '311')))!;

    expect(info.kind).toBe('threaded interrupt handler');
    expect(info.detail).toBe('irq 128, nvme0q1');
  });

  it('reads the CPU out of a per-CPU thread’s name', () => {
    const info = describeKernelThread(parseComm(fixture('kernel-threads', '88')))!;

    expect(info.kind).toBe('per-CPU kernel thread');
    expect(info.cpu).toBe(0);
    expect(info.note).toContain('softirq');
    expect(describeKernelThread(parseComm('migration/7\n'))!.cpu).toBe(7);
  });

  it('reads the NUMA node out of a per-node thread’s name', () => {
    expect(describeKernelThread(parseComm(fixture('kernel-threads', '96')))!.detail).toBe('node 0');
    expect(describeKernelThread(parseComm('kcompactd1\n'))!.detail).toBe('node 1');
  });

  it('reads the device out of a journal thread’s name', () => {
    const info = describeKernelThread(parseComm('jbd2/nvme0n1p2-8\n'))!;

    expect(info.kind).toBe('filesystem journal');
    expect(info.detail).toBe('device nvme0n1p2');
  });

  it('knows the threads whose names carry no parameters', () => {
    expect(describeKernelThread(parseComm(fixture('kernel-threads', '2')))!.kind).toBe(
      'kernel thread parent',
    );
    expect(describeKernelThread(parseComm('khugepaged\n'))!.kind).toBe('memory thread');
    expect(describeKernelThread(parseComm('rcu_preempt\n'))!.kind).toBe('RCU');
  });

  /** The reserve worker, and the one kworker shape with no CPU or pool in it. */
  it('takes a workqueue rescuer apart', () => {
    const info = describeKernelThread(parseComm(fixture('kernel-threads', '93')))!;

    expect(info.kind).toBe('workqueue rescuer');
    expect(info.detail).toBe('workqueue ipv6_addrconf');
    expect(info.cpu).toBeUndefined();
    expect(info.note).toContain('reserve');
  });

  it('reads an RCU offload thread’s group', () => {
    expect(describeKernelThread(parseComm('rcuop/12\n'))!.detail).toBe('group 12');
  });

  it('takes a SCSI host thread apart', () => {
    const info = describeKernelThread(parseComm('scsi_eh_2\n'))!;

    expect(info.kind).toBe('SCSI');
    expect(info.detail).toBe('host 2');
    expect(describeKernelThread(parseComm('scsi_tmf_2\n'))!.note).toContain('task-management');
  });

  it('knows the RCU variants a current kernel names in full', () => {
    for (const name of ['rcu_tasks_kthread', 'rcu_tasks_rude_kthread', 'ksmd', 'psimon']) {
      expect(describeKernelThread(parseComm(`${name}\n`)), name).not.toBeNull();
    }
    expect(describeKernelThread(parseComm('rcu_exp_par_gp_kthread_worker/3\n'))!.detail).toBe(
      'group 3',
    );
  });

  it('says nothing about a name that is not a kernel thread’s', () => {
    for (const pid of ['self', '12282', '3117']) {
      expect(describeKernelThread(parseComm(fixture('desktop', pid))), pid).toBeNull();
    }
    expect(isKernelThread(parseComm(fixture('renamed', 'self')))).toBe(false);
    expect(isKernelThread(parseComm(fixture('kernel-threads', '2')))).toBe(true);
  });

  /** A kernel thread's own name can be cut off like anyone else's. */
  it('knows one whose name did not fit in fifteen characters', () => {
    const thread = parseComm(fixture('kernel-threads', '17'));

    expect(thread.name).toBe('rcu_tasks_kthre');
    expect(isTruncated(thread)).toBe(true);
    expect(describeKernelThread(thread)!.kind).toBe('RCU');
  });
});

describe('summarize', () => {
  it('summarizes an ordinary name', () => {
    expect(summarize(parseComm(fixture('desktop', 'self')))).toEqual({
      name: 'bash',
      length: 4,
      empty: false,
      truncated: false,
      terminated: true,
      spaces: false,
      parentheses: false,
      control: false,
      synthesised: false,
      kernel: null,
    });
  });

  it('summarizes a name that was cut off, with spaces in it', () => {
    expect(summarize(parseComm(fixture('truncated', '901')))).toMatchObject({
      name: 'Isolated Web Co',
      length: 15,
      truncated: true,
      spaces: true,
    });
  });

  it('summarizes a kernel thread', () => {
    const summary = summarize(parseComm(fixture('kernel-threads', '142')));

    expect(summary.name).toBe('kworker/u16:2');
    expect(summary.kernel?.kind).toBe('workqueue worker');
  });
});
