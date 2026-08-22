import { describe, expect, it } from 'vitest';
import { readSgDebugFixture as fixture } from '../test/fixtures';
import {
  activeRequests,
  DETACHING,
  formatOpcode,
  inheritedReserve,
  opcodeName,
  parseSgDebug,
  summarize,
  timeoutUse,
} from './scsi-sg-debug';

describe('parseSgDebug — an idle machine', () => {
  const debug = parseSgDebug(fixture('idle'));

  /** A device nothing has open prints nothing, so the header is the whole file. */
  it('reads the header alone as the ordinary state it is', () => {
    expect(debug.header).toEqual({ maxActiveDevice: 2, defReservedSize: 32768 });
    expect(debug.devices).toEqual([]);
    expect(summarize(debug)).toMatchObject({ headerOnly: true, devices: 0, fds: 0, active: 0 });
  });

  /** The second number is the file next door, printed again here. */
  it('reads the default reserve the header carries', () => {
    expect(debug.header?.defReservedSize).toBe(32768);
  });
});

describe('parseSgDebug — one descriptor open', () => {
  const debug = parseSgDebug(fixture('one-open'));
  const device = debug.devices[0]!;

  it('reads the device block and what it says about the host', () => {
    expect(device).toMatchObject({
      name: 'sg0',
      address: '0:0:0:0',
      detaching: false,
      emulated: true,
      tablesize: 127,
      exclusive: false,
      openCount: 1,
    });
  });

  it('reads the descriptor under it', () => {
    expect(device.fds).toHaveLength(1);
    expect(device.fds[0]).toMatchObject({
      index: 1,
      timeoutMs: 60000,
      bufflen: 32768,
      reserveSgat: 1,
      lowDma: 0,
      cmdQ: false,
      forcePackId: false,
      keepOrphan: false,
      closed: 0,
      idle: true,
    });
    expect(device.fds[0]!.requests).toEqual([]);
  });

  /** The descriptor took its reserve from the default when it opened. */
  it('reads the reserve against the default the header names', () => {
    expect(inheritedReserve(device.fds[0]!, debug.header)).toBe(true);
    expect(summarize(debug).oldReserve).toEqual([]);
  });

  it('counts one device in use where the machine has two', () => {
    expect(summarize(debug)).toMatchObject({ headerOnly: false, devices: 1, fds: 1 });
    expect(debug.header?.maxActiveDevice).toBe(2);
  });
});

describe('parseSgDebug — descriptors with work in flight', () => {
  const debug = parseSgDebug(fixture('busy'));
  const [first, second] = debug.devices;

  it('reads every device block and every descriptor under each', () => {
    expect(debug.devices.map((device) => device.name)).toEqual(['sg0', 'sg4']);
    expect(first!.fds.map((fd) => fd.index)).toEqual([1, 2]);
    expect(second!.fds).toHaveLength(1);
    expect(second!.exclusive).toBe(true);
  });

  /** The prefix says which buffer a request is using, and the tag its state. */
  it('reads the buffer and the state of each request', () => {
    const requests = first!.fds[0]!.requests;

    expect(requests.map((request) => [request.buffer, request.state])).toEqual([
      ['reserved', 'active'],
      ['direct', 'active'],
      ['reserved', 'received'],
    ]);
    expect(first!.fds[1]!.requests[0]).toMatchObject({ buffer: 'ordinary', state: 'finished' });
  });

  /** A request in flight has a timeout and an elapsed; a done one has a duration. */
  it('reads the two shapes a request line takes', () => {
    const [inFlight, , done] = first!.fds[0]!.requests;

    expect(inFlight).toMatchObject({
      packId: 17,
      bytes: 262144,
      timeoutMs: 60000,
      elapsedMs: 1240,
      durationMs: null,
      sgat: 4,
      opcode: 0x88,
    });
    expect(done).toMatchObject({ packId: 16, durationMs: 3, timeoutMs: null, elapsedMs: null });
    expect(timeoutUse(inFlight!)).toBeCloseTo(1240 / 60000);
    expect(timeoutUse(done!)).toBeNull();
  });

  it('names the commands the opcodes stand for', () => {
    expect(opcodeName(0x88)).toBe('READ(16)');
    expect(opcodeName(0x8a)).toBe('WRITE(16)');
    expect(opcodeName(0x12)).toBe('INQUIRY');
    expect(opcodeName(0xff)).toBeNull();
    expect(formatOpcode(0x08)).toBe('0x08');
  });

  /** The second descriptor kept the reserve it opened with, which is now the old one. */
  it('finds a descriptor holding a reserve the default has moved past', () => {
    const summary = summarize(debug);

    expect(inheritedReserve(first!.fds[0]!, debug.header)).toBe(true);
    expect(inheritedReserve(first!.fds[1]!, debug.header)).toBe(false);
    expect(summary.oldReserve).toHaveLength(1);
    expect(summary.oldReserve[0]!.bufflen).toBe(32768);
  });

  it('counts what is in flight and what is done and unread', () => {
    expect(summarize(debug)).toMatchObject({ devices: 2, fds: 3, active: 2, waiting: 1 });
    expect(activeRequests(first!.fds[0]!)).toHaveLength(2);
  });
});

describe('parseSgDebug — a device going away', () => {
  const debug = parseSgDebug(fixture('detaching'));
  const device = debug.devices[0]!;

  /** The third spelling of the absence its two neighbours spell differently. */
  it('reads the detaching line, and nothing else out of it', () => {
    expect(device).toMatchObject({
      name: 'sg1',
      detaching: true,
      address: null,
      emulated: null,
      tablesize: null,
      openCount: null,
    });
    expect(device.raw).toContain(DETACHING);
    expect(summarize(debug).detaching).toHaveLength(1);
  });

  /** Its descriptor is still there, and so is what it was doing. */
  it('keeps the descriptor and the request under it', () => {
    expect(device.fds).toHaveLength(1);
    expect(device.fds[0]!.requests[0]).toMatchObject({ packId: 4, opcode: 0x12, state: 'active' });
    expect(timeoutUse(device.fds[0]!.requests[0]!)).toBeCloseTo(58210 / 60000);
  });
});

describe('parseSgDebug — files of other shapes', () => {
  it('reads an empty file as no header and no devices', () => {
    expect(parseSgDebug('')).toEqual({ header: null, devices: [], unread: [] });
  });

  it('keeps a line it cannot place rather than dropping it', () => {
    const debug = parseSgDebug('max_active_device=1  def_reserved_size=32768\nwhat is this\n');

    expect(debug.header).not.toBeNull();
    expect(debug.unread).toEqual(['what is this']);
    expect(summarize(debug).headerOnly).toBe(false);
  });

  /** A block with no header above it is still a block. */
  it('reads a device block without a header', () => {
    const debug = parseSgDebug(
      ' >>> device=sg0 0:0:0:0   em=0 sg_tablesize=64 excl=0 open_cnt=1\n',
    );

    expect(debug.header).toBeNull();
    expect(debug.devices[0]).toMatchObject({ name: 'sg0', tablesize: 64 });
    expect(inheritedReserve({ bufflen: 4096 } as never, null)).toBe(true);
  });
});
