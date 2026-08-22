import { describe, expect, it } from 'vitest';
import { readNetConnectorFixture as fixture } from '../test/fixtures';
import {
  ALLOCATED,
  allocationOf,
  constantFor,
  describeConnector,
  idOf,
  isAllocatedIndex,
  isKnown,
  isOverlong,
  isProcEvents,
  NAME_WIDTH,
  parseConnectors,
  PROC_EVENTS,
  removed,
  removedIn,
  summarize,
} from './net-connector';

describe('parseConnectors — an ordinary machine', () => {
  const connectors = parseConnectors(fixture('desktop'));

  it('reads the name and the address, and skips the header', () => {
    expect(connectors).toEqual([{ name: 'cn_proc', idx: 1, val: 1 }]);
  });

  it('knows the one line nearly every machine has', () => {
    const proc = connectors[0]!;

    expect(isProcEvents(proc)).toBe(true);
    expect(idOf(proc)).toBe(PROC_EVENTS);
    expect(constantFor(proc)).toBe('CN_IDX_PROC / CN_VAL_PROC');
    expect(describeConnector(proc)).toMatch(/fork, exec, exit/);
    expect(removedIn(proc)).toBeNull();
  });

  it('summarises a table with nothing unusual in it', () => {
    expect(summarize(connectors)).toEqual({
      total: 1,
      procEvents: { name: 'cn_proc', idx: 1, val: 1 },
      known: connectors,
      outOfTree: [],
      removed: [],
      overlong: [],
    });
  });
});

describe('parseConnectors — the other machines', () => {
  it('reads the 1-wire bus registered beside the process events', () => {
    const connectors = parseConnectors(fixture('one-wire'));

    expect(connectors.map((connector) => connector.name)).toEqual(['cn_proc', 'w1']);
    expect(idOf(connectors[1]!)).toBe('3:1');
    expect(constantFor(connectors[1]!)).toBe('CN_W1_IDX / CN_W1_VAL');
    expect(describeConnector(connectors[1]!)).toMatch(/1-wire/);
  });

  /**
   * The address stays allocated after Linux deletes the driver behind it, so
   * this dates the kernel rather than faulting it — the same rule the line
   * discipline numbers follow.
   */
  it('names a registration whose driver Linux has since deleted', () => {
    const connectors = parseConnectors(fixture('storage-server'));
    const drbd = connectors.find((connector) => connector.name === 'cn_drbd')!;

    expect(idOf(drbd)).toBe('8:1');
    expect(removedIn(drbd)).toBe('3.2');
    expect(removed(connectors)).toEqual([drbd]);
    expect(isKnown(drbd)).toBe(true);
    // Device-mapper's log is on the same machine and is not going anywhere.
    expect(removedIn(connectors.find((connector) => connector.name === 'dmlogusr')!)).toBeNull();
  });

  it('reads a bus with nothing registered on it', () => {
    const connectors = parseConnectors(fixture('no-events'));

    expect(connectors).toEqual([]);
    expect(summarize(connectors).procEvents).toBeUndefined();
  });

  it('reads a module holding an index the ABI never allocated', () => {
    const connectors = parseConnectors(fixture('out-of-tree'));
    const summary = summarize(connectors);
    const acme = connectors.find((connector) => connector.idx === 42)!;

    expect(acme).toEqual({ name: 'acme_telemetry_bus', idx: 42, val: 3 });
    expect(isAllocatedIndex(acme)).toBe(false);
    expect(constantFor(acme)).toBeNull();
    expect(describeConnector(acme)).toMatch(/out of tree/);
    expect(summary.outOfTree).toEqual([acme]);
  });

  /**
   * `cn_proc_show` pads with `%-15s` and nothing truncates — `CN_CBQ_NAMELEN`
   * is 32 — so a longer name shifts the ID on its own line and the file stops
   * lining up. It still parses: the columns are whitespace, not positions.
   */
  it('reads a name that ran past the column it is padded to', () => {
    const connectors = parseConnectors(fixture('out-of-tree'));
    const acme = connectors.find((connector) => connector.idx === 42)!;

    expect(acme.name.length).toBeGreaterThan(NAME_WIDTH);
    expect(isOverlong(acme)).toBe(true);
    expect(summarize(connectors).overlong).toEqual([acme]);
    expect(connectors.filter(isOverlong)).not.toContain(connectors[0]);
  });
});

describe('the addresses the ABI allocates', () => {
  it('reads an index inside the range with a value nothing claims', () => {
    const [odd] = parseConnectors('Name            ID\nsomething       3:9\n');

    expect(isAllocatedIndex(odd!)).toBe(true);
    expect(isKnown(odd!)).toBe(false);
    expect(allocationOf(odd!)).toBeNull();
    expect(describeConnector(odd!)).toMatch(/nothing in Linux claims/);
  });

  it('draws the line at CN_NETLINK_USERS', () => {
    const inside = { name: 'x', idx: ALLOCATED - 1, val: 1 };
    const outside = { name: 'x', idx: ALLOCATED, val: 1 };

    expect(ALLOCATED).toBe(11);
    expect(isAllocatedIndex(inside)).toBe(true);
    expect(isAllocatedIndex(outside)).toBe(false);
  });

  it('names the Hyper-V pair a guest registers', () => {
    const kvp = { name: 'KVP', idx: 9, val: 1 };
    const vss = { name: 'VSS', idx: 10, val: 1 };

    expect(constantFor(kvp)).toBe('CN_KVP_IDX / CN_KVP_VAL');
    expect(describeConnector(kvp)).toMatch(/key-value pair/);
    expect(describeConnector(vss)).toMatch(/shadow copy/);
  });
});

describe('parseConnectors — what is not a table', () => {
  it('reads a file holding only the header as nothing registered', () => {
    expect(parseConnectors('Name            ID\n')).toEqual([]);
  });

  it('reads nothing out of an empty file', () => {
    expect(parseConnectors('')).toEqual([]);
  });

  it('skips a line that does not end in an address', () => {
    expect(parseConnectors('Name            ID\ncn_proc\nnonsense 1\n')).toEqual([]);
  });

  it('reads a line however much whitespace the column padding left', () => {
    expect(parseConnectors('a 1:1\nb\t\t2:3\n')).toEqual([
      { name: 'a', idx: 1, val: 1 },
      { name: 'b', idx: 2, val: 3 },
    ]);
  });
});
