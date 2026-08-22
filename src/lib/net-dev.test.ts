import { describe, expect, it } from 'vitest';
import { readNetDevFixture as fixture } from '../test/fixtures';
import {
  BUCKETS,
  errorRate,
  errorsOf,
  formatBytes,
  hasCollisions,
  hasErrors,
  isCompressing,
  isIdle,
  isLoopback,
  isNameGlued,
  NAME_WIDTH,
  parseNetDev,
  summarize,
} from './net-dev';

describe('parseNetDev — an ordinary laptop', () => {
  const interfaces = parseNetDev(fixture('desktop'));

  it('reads all sixteen counters off a line', () => {
    expect(interfaces[0]).toEqual({
      name: 'lo',
      rx: {
        bytes: 43472605,
        packets: 23758,
        errs: 0,
        drop: 0,
        fifo: 0,
        frame: 0,
        compressed: 0,
        multicast: 0,
      },
      tx: {
        bytes: 43472605,
        packets: 23758,
        errs: 0,
        drop: 0,
        fifo: 0,
        colls: 0,
        carrier: 0,
        compressed: 0,
      },
    });
  });

  /** Neither header line has a colon with sixteen numbers after it. */
  it('leaves the two header lines out of the table', () => {
    expect(interfaces.map((iface) => iface.name)).toEqual([
      'lo',
      'enp0s31f6',
      'wlp3s0',
      'docker0',
    ]);
  });

  it('reads a wired port that has never been plugged in as idle', () => {
    const wired = interfaces.find((iface) => iface.name === 'enp0s31f6')!;

    expect(isIdle(wired)).toBe(true);
    expect(hasErrors(wired)).toBe(false);
    expect(errorRate(wired)).toBe(0);
    expect(summarize(interfaces).idle).toEqual([wired]);
  });

  it('finds the busiest interface, loopback aside', () => {
    const summary = summarize(interfaces);

    // Loopback moves 43 MB each way and would otherwise outrank docker0.
    expect(summary.busiest!.name).toBe('wlp3s0');
    expect(summary.loopback!.name).toBe('lo');
    expect(isLoopback(summary.loopback!)).toBe(true);
  });

  it('counts multicast without counting it as an error', () => {
    const wifi = interfaces.find((iface) => iface.name === 'wlp3s0')!;

    expect(wifi.rx.multicast).toBe(184726);
    expect(hasErrors(wifi)).toBe(false);
    expect(errorsOf(wifi)).toBe(0);
  });

  it('adds the bytes up across every interface', () => {
    const summary = summarize(interfaces);

    expect(summary.rxBytes).toBe(43472605 + 0 + 48219847113 + 1284736);
    expect(summary.txBytes).toBe(43472605 + 0 + 3921884472 + 8472913);
    expect(summary.faulty).toEqual([]);
  });
});

describe('parseNetDev — a network namespace of its own', () => {
  it('reads a container process a table with none of the host in it', () => {
    const guest = parseNetDev(fixture('desktop', '12282'));
    const host = parseNetDev(fixture('desktop', '1'));

    expect(guest.map((iface) => iface.name)).toEqual(['lo', 'eth0']);
    expect(host.map((iface) => iface.name)).toContain('wlp3s0');
    expect(guest.some((iface) => iface.name === 'wlp3s0')).toBe(false);
    // Its loopback is its own, and has barely been used.
    expect(guest[0]!.rx.bytes).toBe(8472);
  });
});

describe('parseNetDev — a link with something wrong with it', () => {
  const interfaces = parseNetDev(fixture('flaky-link'));
  const eth0 = interfaces.find((iface) => iface.name === 'eth0')!;

  it('reads the error columns apart from the traffic', () => {
    expect(eth0.rx.errs).toBe(4821);
    expect(eth0.rx.drop).toBe(1928);
    expect(eth0.rx.fifo).toBe(372);
    expect(eth0.rx.frame).toBe(4449);
    expect(eth0.tx.errs).toBe(218);
    expect(eth0.tx.carrier).toBe(218);
    expect(hasErrors(eth0)).toBe(true);
  });

  /** The number worth reading is the share, not the count. */
  it('works out bad frames as a share of what arrived', () => {
    expect(errorRate(eth0)).toBeCloseTo((4821 + 4449) / (19284736 + 4821 + 4449), 10);
    expect(errorRate(eth0)).toBeLessThan(0.001);
    expect(errorsOf(eth0)).toBe(4821 + 1928 + 372 + 4449 + 218 + 84 + 0 + 1472 + 218);
  });

  it('spots the collisions only a half-duplex link can have', () => {
    expect(eth0.tx.colls).toBe(1472);
    expect(hasCollisions(eth0)).toBe(true);
    expect(interfaces.filter(hasCollisions)).toEqual([eth0]);
  });

  it('names what the bucket columns are made of', () => {
    expect(BUCKETS['rx frame']).toEqual([
      'rx_length_errors',
      'rx_over_errors',
      'rx_crc_errors',
      'rx_frame_errors',
    ]);
    expect(BUCKETS['rx drop']).toEqual(['rx_dropped', 'rx_missed_errors']);
    expect(BUCKETS['tx carrier']).toHaveLength(4);
  });

  it('leaves the healthy interfaces out of the faulty list', () => {
    const summary = summarize(interfaces);

    expect(summary.faulty).toEqual([eth0]);
    expect(summary.total).toBe(3);
  });
});

describe('parseNetDev — names that run into the colon', () => {
  const interfaces = parseNetDev(fixture('long-names'));

  /**
   * The name is printed `%6s:`, so anything six characters or longer leaves no
   * space before the colon, and a bridge name runs the whole way over the
   * column and pushes the rest of its line right. Nothing is lost by it — the
   * format still separates every counter with a space — so what breaks is
   * reading the file by fixed columns, which is why this splits on the colon.
   */
  it('reads a name that left no space before the colon', () => {
    expect(interfaces.map((iface) => iface.name)).toEqual([
      'lo',
      'enp0s31f6',
      'br-1a2b3c4d5e6f',
      'veth3f81c2a',
      'virbr0-nic',
    ]);

    const bridge = interfaces.find((iface) => iface.name === 'br-1a2b3c4d5e6f')!;
    expect(bridge.rx.bytes).toBe(1847263);
    expect(bridge.tx.packets).toBe(28471);
  });

  it('knows which names the column could not hold, and the longest of them', () => {
    const summary = summarize(interfaces);

    expect(NAME_WIDTH).toBe(6);
    expect(summary.glued.map((iface) => iface.name)).toEqual([
      'enp0s31f6',
      'br-1a2b3c4d5e6f',
      'veth3f81c2a',
      'virbr0-nic',
    ]);
    expect(summary.widest!.name).toBe('br-1a2b3c4d5e6f');
    // `lo` is two characters, so it is padded and keeps its space.
    expect(isNameGlued(interfaces[0]!)).toBe(false);
  });

  /**
   * All sixteen counters survive a whitespace split too — the colon just comes
   * along on the name — so the claim this parser makes is about fixed columns,
   * not about losing data.
   */
  it('keeps every counter on a line whose name overran the column', () => {
    const bridge = interfaces.find((iface) => iface.name === 'br-1a2b3c4d5e6f')!;
    const raw = fixture('long-names')
      .split('\n')
      .find((line) => line.startsWith('br-'))!;

    expect(raw).not.toMatch(/\sbr-1a2b3c4d5e6f:/);
    expect(raw.trim().split(/\s+/)).toHaveLength(17);
    expect(bridge.tx.compressed).toBe(0);
    expect(bridge.rx.packets).toBe(18472);
  });
});

describe('parseNetDev — a dial-up link', () => {
  const interfaces = parseNetDev(fixture('dialup'));
  const ppp = interfaces.find((iface) => iface.name === 'ppp0')!;

  it('reads the two columns nothing else on a machine uses', () => {
    expect(ppp.rx.compressed).toBe(3918);
    expect(ppp.tx.compressed).toBe(2841);
    expect(isCompressing(ppp)).toBe(true);
    expect(isCompressing(interfaces[0]!)).toBe(false);
  });

  /** Compressed is not an error, and sits in the middle of the ones that are. */
  it('keeps the compressed counters out of the error total', () => {
    expect(errorsOf(ppp)).toBe(12 + 3);
    expect(hasErrors(ppp)).toBe(true);
  });
});

describe('parseNetDev — what is not a table', () => {
  it('reads a file holding only the two headers as no interfaces', () => {
    const headers =
      'Inter-|   Receive                                                |  Transmit\n' +
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n';

    expect(parseNetDev(headers)).toEqual([]);
  });

  it('reads nothing out of an empty file', () => {
    expect(parseNetDev('')).toEqual([]);
  });

  it('skips a line without the full sixteen counters', () => {
    expect(parseNetDev('eth0: 1 2 3\n')).toEqual([]);
  });

  it('skips a line whose counters are not numbers', () => {
    expect(parseNetDev(`eth0: ${'x '.repeat(16)}\n`)).toEqual([]);
  });

  it('reads a line with no name at all as nothing', () => {
    expect(parseNetDev(`: ${'0 '.repeat(16)}\n`)).toEqual([]);
  });

  it('summarises an empty table without inventing anything', () => {
    expect(summarize([])).toEqual({
      total: 0,
      rxBytes: 0,
      txBytes: 0,
      busiest: undefined,
      idle: [],
      faulty: [],
      glued: [],
      widest: undefined,
      loopback: undefined,
    });
  });
});

describe('formatBytes', () => {
  it('reads a counter at the scale it is at', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(43472605)).toBe('43 MB');
    expect(formatBytes(48219847113)).toBe('48 GB');
    expect(formatBytes(1500)).toBe('1.5 kB');
  });
});
