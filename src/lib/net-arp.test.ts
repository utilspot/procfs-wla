import { describe, expect, it } from 'vitest';
import { readNetArpFixture as fixture } from '../test/fixtures';
import {
  ATF_COM,
  ATF_PERM,
  ATF_PUBL,
  describeFlag,
  flagNames,
  hasMask,
  hwTypeHex,
  hwTypeName,
  isComplete,
  isCrowded,
  isIncomplete,
  isLocallyAdministered,
  isMulticastHw,
  isPermanent,
  isProxy,
  isUnresolved,
  parseNetArp,
  summarize,
  unexpectedFlags,
} from './net-arp';

describe('parseNetArp — an ordinary laptop', () => {
  const entries = parseNetArp(fixture('desktop'));

  it('reads the six columns of an entry', () => {
    expect(entries[0]).toEqual({
      ip: '192.168.1.1',
      hwType: 1,
      flags: ATF_COM,
      hwAddress: '3c:22:fb:1a:2b:3c',
      mask: '*',
      device: 'wlan0',
    });
  });

  /** The header cannot start with a dotted quad, which is how it is skipped. */
  it('leaves the header line out of the table', () => {
    expect(entries).toHaveLength(5);
    expect(entries.some((entry) => entry.ip.startsWith('IP'))).toBe(false);
  });

  it('tells an address that resolved from one nothing answered for', () => {
    const asleep = entries.find((entry) => entry.ip === '192.168.1.77')!;

    expect(isComplete(asleep)).toBe(false);
    expect(isIncomplete(asleep)).toBe(true);
    expect(isUnresolved(asleep)).toBe(true);
    expect(flagNames(asleep.flags)).toEqual([]);
  });

  it('reads a static entry as permanent as well as complete', () => {
    const nas = entries.find((entry) => entry.ip === '192.168.1.31')!;

    expect(nas.flags).toBe(ATF_PERM | ATF_COM);
    expect(flagNames(nas.flags)).toEqual(['ATF_COM', 'ATF_PERM']);
    expect(isPermanent(nas)).toBe(true);
  });

  /**
   * The bit that says the address was made up rather than assigned, which is
   * every randomised phone and every virtual interface.
   */
  it('spots a locally-administered hardware address', () => {
    const phone = entries.find((entry) => entry.ip === '192.168.1.24')!;

    expect(isLocallyAdministered(phone)).toBe(true);
    expect(isMulticastHw(phone)).toBe(false);
    // The all-zero address of an unresolved entry is not "assigned by nobody".
    expect(entries.filter(isLocallyAdministered).map((entry) => entry.ip)).toEqual([
      '192.168.1.24',
      '169.254.98.3',
    ]);
  });

  it('summarises the table by interface', () => {
    const summary = summarize(entries);

    expect(summary.total).toBe(5);
    expect(summary.complete).toBe(4);
    expect(summary.incomplete).toBe(1);
    expect(summary.permanent).toBe(1);
    expect(summary.proxy).toBe(0);
    expect(summary.devices).toEqual([
      { device: 'wlan0', count: 4, incomplete: 1 },
      { device: 'eth0', count: 1, incomplete: 0 },
    ]);
    expect(summary.hwTypes).toEqual([{ type: 1, count: 5 }]);
    expect(summary.shared).toEqual([]);
    expect(summary.masked).toEqual([]);
  });
});

describe('parseNetArp — a host and a container in it', () => {
  const host = parseNetArp(fixture('container-host', '1'));
  const guest = parseNetArp(fixture('container-host', '12282'));

  /**
   * The whole reason this page reads a pid: the file belongs to a network
   * namespace, so the two answers share nothing.
   */
  it('reads a different table for a process in another namespace', () => {
    expect(host).toHaveLength(6);
    expect(guest).toHaveLength(2);
    expect(guest.map((entry) => entry.ip)).toEqual(['172.17.0.1', '172.17.0.5']);
    expect(host.some((entry) => entry.device === 'wlan0')).toBe(false);
    expect(guest.every((entry) => entry.device === 'eth0')).toBe(true);
  });

  it('reads the same table for two processes sharing a namespace', () => {
    expect(parseNetArp(fixture('container-host', 'self'))).toEqual(host);
  });

  it('counts the veth and bridge interfaces the containers hang off', () => {
    expect(summarize(host).devices.map((device) => device.device)).toEqual([
      'eno1',
      'docker0',
      'veth3f81c2a',
    ]);
  });
});

describe('parseNetArp — a rack server', () => {
  const entries = parseNetArp(fixture('busy-server'));
  const summary = summarize(entries);

  it('spreads the neighbours over the tagged interfaces', () => {
    expect(summary.total).toBe(14);
    expect(summary.devices).toEqual([
      { device: 'bond0', count: 5, incomplete: 1 },
      // Three each, so they fall back to their names for an order.
      { device: 'bond0.40', count: 3, incomplete: 1 },
      { device: 'bond0.50', count: 3, incomplete: 0 },
      { device: 'eno2', count: 3, incomplete: 1 },
    ]);
  });

  /**
   * One switch answering on three VLANs at once. The addresses differ, the
   * hardware address does not, which is the shape of proxy ARP — and of two
   * machines fighting over an address.
   */
  it('finds the hardware address several neighbours share', () => {
    expect(summary.shared).toEqual([
      {
        hwAddress: '00:1c:73:aa:bb:01',
        ips: ['10.20.0.1', '10.20.4.1', '10.30.0.1'],
        devices: ['bond0', 'bond0.40', 'bond0.50'],
      },
    ]);
  });

  /** Every unresolved entry holds the same zeroes, which is not a shared machine. */
  it('does not read the all-zero address as one machine on four addresses', () => {
    expect(summary.incomplete).toBe(3);
    expect(summary.shared.map((group) => group.hwAddress)).not.toContain('00:00:00:00:00:00');
  });

  it('is nowhere near the table cap', () => {
    expect(isCrowded(entries)).toBe(false);
  });
});

describe('parseNetArp — a router publishing addresses', () => {
  const entries = parseNetArp(fixture('proxy-arp'));
  const summary = summarize(entries);

  it('reads a published entry as neither resolved nor unresolved', () => {
    const published = entries.find((entry) => entry.ip === '10.0.8.20')!;

    expect(published.flags).toBe(ATF_PUBL | ATF_PERM);
    expect(isProxy(published)).toBe(true);
    expect(isUnresolved(published)).toBe(true);
    // It answers with this machine's own address, so there is nothing missing
    // here to hide behind the "unresolved" filter.
    expect(isIncomplete(published)).toBe(false);
    expect(summary.proxy).toBe(4);
    expect(summary.incomplete).toBe(0);
  });

  it('reads a proxy entry bound to no interface', () => {
    expect(entries.find((entry) => entry.ip === '10.0.8.22')!.device).toBe('*');
  });

  it('reads the entry that publishes a refusal', () => {
    const refused = entries.find((entry) => entry.ip === '10.0.8.30')!;

    expect(flagNames(refused.flags)).toEqual(['ATF_PERM', 'ATF_PUBL', 'ATF_DONTPUB']);
    expect(unexpectedFlags(refused)).toEqual(['ATF_DONTPUB']);
    expect(describeFlag('ATF_DONTPUB')).toMatch(/do not answer/);
  });
});

describe('parseNetArp — a kernel old enough to mean the Mask column', () => {
  const entries = parseNetArp(fixture('legacy-netmask'));
  const summary = summarize(entries);

  it('keeps a netmask the column actually holds', () => {
    const proxied = entries.find((entry) => entry.ip === '10.1.2.0')!;

    expect(proxied.mask).toBe('255.255.255.0');
    expect(hasMask(proxied)).toBe(true);
    expect(summary.masked).toHaveLength(1);
    expect(entries.filter(hasMask)).toEqual(summary.masked);
  });

  it('names the flags no neighbour state can produce', () => {
    const trailers = entries.find((entry) => entry.ip === '10.1.1.4')!;

    expect(unexpectedFlags(trailers)).toEqual(['ATF_USETRAILERS']);
    expect(describeFlag('ATF_USETRAILERS')).toMatch(/4\.3BSD/);
    expect([...new Set(entries.flatMap(unexpectedFlags))]).toEqual([
      'ATF_USETRAILERS',
      'ATF_NETMASK',
    ]);
  });

  /** Twenty bytes of address on a link that is not Ethernet. */
  it('reads an InfiniBand entry, address and all', () => {
    const ib = entries.find((entry) => entry.device === 'ib0')!;

    expect(ib.hwType).toBe(32);
    expect(hwTypeName(ib.hwType)).toBe('InfiniBand');
    expect(hwTypeHex(ib.hwType)).toBe('0x20');
    expect(ib.hwAddress).toHaveLength(59);
    expect(summary.hwTypes).toEqual([
      { type: 1, count: 3 },
      { type: 32, count: 1 },
    ]);
  });
});

describe('parseNetArp — what is not a table', () => {
  it('reads a file holding only the header as an empty table', () => {
    const header = 'IP address       HW type     Flags       HW address            Mask     Device\n';

    expect(parseNetArp(header)).toEqual([]);
    expect(summarize([])).toMatchObject({ total: 0, devices: [], hwTypes: [], shared: [] });
  });

  it('reads nothing out of an empty file', () => {
    expect(parseNetArp('')).toEqual([]);
  });

  it('skips a line that is not six columns of neighbour', () => {
    expect(parseNetArp('192.168.1.1 0x1 0x2\nnot an entry at all\n')).toEqual([]);
  });

  it('reads an address the kernel wrote in capitals', () => {
    const line = '10.0.0.1         0x1         0x2         AA:BB:CC:DD:EE:FF     *        eth0\n';

    expect(parseNetArp(line)[0]!.hwAddress).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('has no name for a hardware type it has no name for', () => {
    expect(hwTypeName(4242)).toBeNull();
    expect(hwTypeName(1)).toBe('Ethernet');
  });

  it('says so plainly for a flag it has no name for', () => {
    expect(describeFlag('ATF_NOTHING')).toMatch(/no name for/);
  });

  /** The cap the kernel logs "neighbour table overflow" against. */
  it('calls a table crowded as it approaches gc_thresh3', () => {
    const many = Array.from({ length: 800 }, (_unused, index) => ({
      ip: `10.0.${Math.floor(index / 256)}.${index % 256}`,
      hwType: 1,
      flags: ATF_COM,
      hwAddress: '00:00:5e:00:53:01',
      mask: '*',
      device: 'eth0',
    }));

    expect(isCrowded(many)).toBe(true);
    expect(isCrowded(many.slice(0, 700))).toBe(false);
  });
});
