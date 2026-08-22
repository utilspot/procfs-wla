import { describe, expect, it } from 'vitest';
import { readTtyLdiscsFixture as fixture } from '../test/fixtures';
import {
  constantFor,
  describeLdisc,
  isDefault,
  isUnknown,
  parseLdiscs,
  removed,
  removedIn,
  TOTAL,
} from './tty-ldiscs';

describe('parseLdiscs — an ordinary machine', () => {
  const ldiscs = parseLdiscs(fixture('desktop'));

  it('reads the name and the number', () => {
    expect(ldiscs).toEqual([
      { name: 'n_tty', number: 0 },
      { name: 'n_null', number: 27 },
    ]);
  });

  /**
   * The number is the `N_*` constant rather than a position, so the gap between
   * 0 and 27 is the normal case and not a sign of anything missing.
   */
  it('keeps the numbers as the kernel gives them, gap and all', () => {
    expect(ldiscs.map((ldisc) => ldisc.number)).toEqual([0, 27]);
    expect(constantFor(0)).toBe('N_TTY');
    expect(constantFor(27)).toBe('N_NULL');
  });

  it('knows which one every tty starts on', () => {
    expect(ldiscs.filter(isDefault)).toEqual([{ name: 'n_tty', number: 0 }]);
    expect(describeLdisc(0)).toMatch(/canonical mode/);
  });

  it('finds nothing removed and nothing unrecognised', () => {
    expect(removed(ldiscs)).toEqual([]);
    expect(ldiscs.some(isUnknown)).toBe(false);
  });
});

describe('parseLdiscs — the other machines', () => {
  it('reads the HCI discipline a UART Bluetooth adapter needs', () => {
    const hci = parseLdiscs(fixture('bluetooth-serial')).find((ldisc) => ldisc.number === 15)!;

    expect(hci.name).toBe('n_hci');
    expect(constantFor(hci.number)).toBe('N_HCI');
    expect(describeLdisc(hci.number)).toMatch(/Bluetooth HCI/);
  });

  it('reads four disciplines registered at once on a radio station', () => {
    const ldiscs = parseLdiscs(fixture('packet-radio'));

    expect(ldiscs.map((ldisc) => ldisc.name)).toEqual([
      'n_tty',
      'n_slip',
      'n_ppp',
      'n_ax25',
      'n_6pack',
      'n_null',
    ]);
    expect(ldiscs.map((ldisc) => ldisc.number)).toEqual([0, 1, 3, 5, 7, 27]);
  });

  /**
   * The numbers stay allocated after Linux deletes the driver behind them, so
   * finding one registered dates the kernel rather than reporting a fault.
   */
  it('finds the disciplines Linux has since deleted', () => {
    const ldiscs = parseLdiscs(fixture('legacy-2.6'));

    expect(removed(ldiscs).map((ldisc) => ldisc.name)).toEqual(['n_strip', 'n_irda']);
    expect(removedIn({ name: 'n_strip', number: 4 })).toBe('2.6.28');
    expect(removedIn({ name: 'n_irda', number: 11 })).toBe('4.17');
    // Still an ordinary entry otherwise, with a description like any other.
    expect(describeLdisc(11)).toMatch(/IrDA/);
  });

  it('reads a kernel from before n_null existed', () => {
    const ldiscs = parseLdiscs(fixture('legacy-2.6'));

    expect(ldiscs.some((ldisc) => ldisc.number === 27)).toBe(false);
    expect(ldiscs.filter(isDefault)).toHaveLength(1);
  });

  it('keeps a discipline registered under a number it does not know', () => {
    const vendor = parseLdiscs(fixture('out-of-tree')).find((ldisc) => ldisc.number === 31)!;

    expect(vendor.name).toBe('n_vendor');
    expect(isUnknown(vendor)).toBe(true);
    expect(constantFor(vendor.number)).toBeNull();
    expect(describeLdisc(vendor.number)).toBeNull();
    expect(removedIn(vendor)).toBeNull();
  });
});

describe('the numbers', () => {
  it('covers every N_* the ABI allocates', () => {
    expect(TOTAL).toBe(31);
    expect(constantFor(30)).toBe('N_CAN327');
    expect(constantFor(31)).toBeNull();
  });

  it('describes every number it claims to know', () => {
    for (let number = 0; number < TOTAL; number += 1) {
      expect(constantFor(number), String(number)).not.toBeNull();
      expect(describeLdisc(number), String(number)).not.toBeNull();
    }
  });
});

describe('parseLdiscs — lines it cannot read', () => {
  it('skips a line that is not a name and a number', () => {
    expect(parseLdiscs('n_tty\n\n  \nnot a number: here\n')).toEqual([]);
  });

  it('reads a file served with CRLF line endings', () => {
    expect(parseLdiscs('n_tty       0\r\nn_null     27\r\n')).toEqual([
      { name: 'n_tty', number: 0 },
      { name: 'n_null', number: 27 },
    ]);
  });

  it('reads an empty file as no disciplines rather than failing', () => {
    expect(parseLdiscs('')).toEqual([]);
    expect(removed([])).toEqual([]);
  });
});
