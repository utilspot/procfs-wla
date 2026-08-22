import { describe, expect, it } from 'vitest';
import { readSysvipcMsgFixture as fixture } from '../test/fixtures';
import {
  averageMessageOf,
  fillShareOf,
  formatBytes,
  formatPermissions,
  formatTime,
  hasRaisedLimit,
  isAtDefaultLimit,
  isBackedUp,
  isOverflowId,
  isPidVisible,
  isPrivate,
  keyHex,
  MSGMNB_DEFAULT,
  ownerChanged,
  parseMsg,
  permissionsOf,
  sequenceOf,
  slotOf,
  summarize,
  wasNeverReceived,
  wasNeverUsed,
} from './sysvipc-msg';

describe('parseMsg — a queue in steady use', () => {
  const info = parseMsg(fixture('legacy-app'));

  it('reads every field of a line', () => {
    expect(info.queues[0]).toEqual({
      key: 1094795585,
      msqid: 0,
      mode: 0o660,
      cbytes: 0,
      qnum: 0,
      lspid: 3312,
      lrpid: 3319,
      uid: 1000,
      gid: 1000,
      cuid: 1000,
      cgid: 1000,
      stime: 1786706430,
      rtime: 1786706431,
      ctime: 1786674033,
    });
  });

  it('leaves the header out of the queues', () => {
    expect(info.queues).toHaveLength(3);
  });

  /**
   * An empty queue with a recent send and receive is one doing its job — which
   * is the state worth telling from a backlog.
   */
  it('reads an empty queue as empty rather than as unused', () => {
    const working = info.queues[0]!;

    expect(isBackedUp(working)).toBe(false);
    expect(wasNeverUsed(working)).toBe(false);
    expect(wasNeverReceived(working)).toBe(false);
    expect(averageMessageOf(working)).toBeNull();
  });

  it('reads what is waiting on a queue that has some', () => {
    const waiting = info.queues.find((queue) => queue.msqid === 2)!;

    expect(waiting.qnum).toBe(2);
    expect(waiting.cbytes).toBe(96);
    expect(isBackedUp(waiting)).toBe(true);
    expect(averageMessageOf(waiting)).toBe(48);
  });

  it('reads perms as octal, and as permissions alone', () => {
    const queue = info.queues[0]!;

    expect(queue.mode).toBe(0o660);
    // Unlike a segment's, a queue's mode carries no flags above the permissions.
    expect(permissionsOf(queue)).toBe(queue.mode);
    expect(formatPermissions(queue)).toBe('rw-rw----');
  });

  it('tells a private queue from a keyed one', () => {
    expect(isPrivate(info.queues.find((queue) => queue.msqid === 2)!)).toBe(true);
    expect(isPrivate(info.queues[0]!)).toBe(false);
    expect(keyHex(info.queues[0]!)).toBe('0x41414141');
  });

  /** The id is a sequence number above a slot, as it is for every IPC object. */
  it('reads the id as the slot and the sequence in it', () => {
    expect(slotOf(info.queues[0]!)).toBe(0);
    expect(sequenceOf(info.queues[0]!)).toBe(0);
    expect(slotOf(info.queues[1]!)).toBe(1);
    expect(sequenceOf(info.queues[1]!)).toBe(1);
  });

  it('summarizes what is waiting across the queues', () => {
    const summary = summarize(info);

    expect(summary.queues).toBe(3);
    expect(summary.messages).toBe(2);
    expect(summary.bytes).toBe(96);
    expect(summary.backedUp).toHaveLength(1);
    expect(summary.neverReceived).toEqual([]);
    expect(summary.atLimit).toEqual([]);
    expect(summary.unused).toBe(0);
  });
});

describe('parseMsg — a legacy middleware host', () => {
  const info = parseMsg(fixture('middleware'));

  /** 12 KiB of the 16 KiB a queue holds by default: a consumer falling behind. */
  it('reads a queue filling up against the default limit', () => {
    const behind = info.queues.find((queue) => queue.msqid === 98307)!;

    expect(behind.cbytes).toBe(12288);
    expect(behind.qnum).toBe(96);
    expect(fillShareOf(behind)).toBeCloseTo(0.75);
    expect(isAtDefaultLimit(behind)).toBe(false);
    expect(averageMessageOf(behind)).toBe(128);
  });

  /**
   * Past the default is only possible with a raised `q_qbytes`, which this file
   * does not print — so it is read as the limit having moved.
   */
  it('reads a queue past the default as one whose own limit was raised', () => {
    const raised = info.queues.find((queue) => queue.msqid === 131076)!;

    expect(raised.cbytes).toBe(65536);
    expect(raised.cbytes).toBeGreaterThan(MSGMNB_DEFAULT);
    expect(hasRaisedLimit(raised)).toBe(true);
    expect(isAtDefaultLimit(raised)).toBe(true);
    expect(fillShareOf(raised)).toBe(4);
  });

  /** `key_t` is signed, so a key with its top bit set prints negative. */
  it('reads a signed key back as the bit pattern it is', () => {
    const raised = info.queues.find((queue) => queue.msqid === 131076)!;

    expect(raised.key).toBe(-1910767613);
    expect(keyHex(raised)).toBe('0x8e1c0003');
  });

  it('sums what is waiting over every queue', () => {
    const summary = summarize(info);

    expect(summary.queues).toBe(5);
    expect(summary.messages).toBe(6 + 96 + 512);
    expect(summary.bytes).toBe(480 + 12288 + 65536);
    expect(summary.backedUp).toHaveLength(3);
    expect(summary.atLimit.map((queue) => queue.msqid)).toEqual([131076]);
  });
});

describe('parseMsg — a queue that has filled up', () => {
  const info = parseMsg(fixture('backlog'));

  /** At `msgmnb` a sender blocks, which is the state to notice. */
  it('reads a queue holding as much as the default allows', () => {
    const full = info.queues[0]!;

    expect(full.cbytes).toBe(MSGMNB_DEFAULT);
    expect(isAtDefaultLimit(full)).toBe(true);
    // At the limit is not past it: nothing here says the limit was raised.
    expect(hasRaisedLimit(full)).toBe(false);
    expect(fillShareOf(full)).toBe(1);
  });

  it('reads one nearly there as not there yet', () => {
    const nearly = info.queues[1]!;

    expect(isAtDefaultLimit(nearly)).toBe(false);
    expect(fillShareOf(nearly)).toBeCloseTo(0.969, 3);
  });

  it('counts the queues at the limit', () => {
    expect(summarize(info).atLimit.map((queue) => queue.msqid)).toEqual([0]);
    expect(summarize(info).messages).toBe(128 + 124);
  });
});

describe('parseMsg — sent to and never read from', () => {
  const info = parseMsg(fixture('never-received'));

  /** An rtime of 0 with messages waiting: a consumer that never started. */
  it('tells never received from merely behind', () => {
    const orphaned = info.queues[0]!;

    expect(orphaned.rtime).toBe(0);
    expect(orphaned.qnum).toBe(24);
    expect(wasNeverReceived(orphaned)).toBe(true);
    expect(wasNeverUsed(orphaned)).toBe(false);
    expect(summarize(info).neverReceived).toHaveLength(1);
  });

  /** And a queue nothing has touched from either end is neither of those. */
  it('reads a queue nothing has ever used as unused', () => {
    const untouched = info.queues[1]!;

    expect(wasNeverUsed(untouched)).toBe(true);
    // There is nothing to have gone unreceived, so it is not that either.
    expect(wasNeverReceived(untouched)).toBe(false);
    expect(isPidVisible(untouched.lspid)).toBe(false);
    expect(summarize(info).unused).toBe(1);
  });
});

describe('parseMsg — an IPC namespace of its own', () => {
  const info = parseMsg(fixture('ipc-namespace'));

  /**
   * A pid of 0 beside times that are set is a process this namespace cannot
   * see — not nothing having sent.
   */
  it('reads a pid of 0 with a time beside it as a process it cannot see', () => {
    const outside = info.queues[0]!;

    expect(isPidVisible(outside.lspid)).toBe(false);
    expect(outside.stime).toBeGreaterThan(0);
    expect(wasNeverUsed(outside)).toBe(false);
    // And the one this namespace made itself keeps both pids.
    expect(isPidVisible(info.queues[1]!.lspid)).toBe(true);
  });

  it('reads the two pids independently', () => {
    const mixed = info.queues.find((queue) => queue.msqid === 65538)!;

    expect(isPidVisible(mixed.lspid)).toBe(false);
    expect(isPidVisible(mixed.lrpid)).toBe(true);
  });

  it('sees the overflow id an unmapped owner reads as', () => {
    const unmapped = info.queues.find((queue) => queue.msqid === 65538)!;

    expect(unmapped.uid).toBe(65534);
    expect(isOverflowId(unmapped.uid)).toBe(true);
    expect(isOverflowId(info.queues[0]!.uid)).toBe(false);
    expect(ownerChanged(unmapped)).toBe(false);
  });
});

describe('parseMsg — a machine with no queues', () => {
  const info = parseMsg(fixture('no-queues'));

  it('reads the header and no queues', () => {
    expect(info.queues).toEqual([]);
  });

  it('summarizes nothing as nothing', () => {
    const summary = summarize(info);

    expect(summary.queues).toBe(0);
    expect(summary.messages).toBe(0);
    expect(summary.bytes).toBe(0);
    expect(summary.backedUp).toEqual([]);
  });
});

describe('parseMsg — shapes the fixtures do not have', () => {
  it('reads an empty file as no queues rather than as a failure', () => {
    expect(parseMsg('')).toEqual({ queues: [] });
    expect(parseMsg('\n\n')).toEqual({ queues: [] });
  });

  it('skips a line that is not a queue', () => {
    const text = [
      '       key      msqid perms      cbytes       qnum lspid lrpid   uid   gid  cuid  cgid      stime      rtime      ctime',
      'this is not a queue',
      '      4242          0   660           0          0  3312  3319  1000  1000  1000  1000 1786706430 1786706431 1786674033',
      '      4242          0   660           0',
      '',
    ].join('\n');

    expect(parseMsg(text).queues).toHaveLength(1);
  });

  /**
   * A key wide enough to overflow its `%10d` pushes the rest of the line right,
   * which is why nothing here reads by column.
   */
  it('reads a line a wide key has pushed right', () => {
    const text = [
      '       key      msqid perms      cbytes       qnum lspid lrpid   uid   gid  cuid  cgid      stime      rtime      ctime',
      '-1910767613     131076   600       65536        512  4102  4231  1001  1001  1001  1001 1786658746 1786658735 1784844347',
      '',
    ].join('\n');

    const queue = parseMsg(text).queues[0]!;

    expect(queue.key).toBe(-1910767613);
    expect(queue.msqid).toBe(131076);
    expect(queue.cbytes).toBe(65536);
    expect(queue.ctime).toBe(1784844347);
  });

  /** `msgctl(IPC_SET)` moves the owner and leaves the creator alone. */
  it('sees ownership that has been handed on', () => {
    const text = [
      '       key      msqid perms      cbytes       qnum lspid lrpid   uid   gid  cuid  cgid      stime      rtime      ctime',
      '      4242          0   660           0          0  3312  3319  1000    44     0     0 1786706430 1786706431 1786674033',
      '',
    ].join('\n');

    expect(ownerChanged(parseMsg(text).queues[0]!)).toBe(true);
  });
});

describe('formatting', () => {
  it('writes the byte figures in the units msgmnb is quoted in', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(96)).toBe('96 B');
    expect(formatBytes(12288)).toBe('12 KiB');
    expect(formatBytes(MSGMNB_DEFAULT)).toBe('16 KiB');
    expect(formatBytes(65536)).toBe('64 KiB');
    // A queue nearly full has to read differently from a full one, which is
    // most of what this page is saying about either of them.
    expect(formatBytes(15872)).toBe('15.5 KiB');
    expect(formatBytes(15360)).toBe('15 KiB');
  });

  it('writes the permission bits the way ipcs does', () => {
    const queue = (mode: number) => ({ mode }) as never;

    expect(formatPermissions(queue(0o660))).toBe('rw-rw----');
    expect(formatPermissions(queue(0o622))).toBe('rw--w--w-');
    expect(formatPermissions(queue(0o600))).toBe('rw-------');
  });

  /** A time of 0 is never rather than 1970, for all three of these columns. */
  it('writes a timestamp as the moment it is, and never as never', () => {
    expect(formatTime(1786706430)).toBe('2026-08-14 11:20:30 UTC');
    expect(formatTime(0)).toBeNull();
  });
});
