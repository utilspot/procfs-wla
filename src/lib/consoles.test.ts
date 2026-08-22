import { describe, expect, it } from 'vitest';
import { readConsolesFixture as fixture } from '../test/fixtures';
import {
  bootConsoles,
  describeFlag,
  hasFlag,
  isEnabled,
  nameFlag,
  operations,
  parseConsoles,
  preferred,
  summarize,
} from './consoles';

describe('parseConsoles — an ordinary desktop', () => {
  const consoles = parseConsoles(fixture('desktop-vt'));

  it('reads the name, operations, flags and device', () => {
    expect(consoles).toHaveLength(1);
    expect(consoles[0]).toEqual({
      name: 'tty0',
      read: false,
      write: true,
      unblank: true,
      flags: ['E', 'C', 'p'],
      device: { major: 4, minor: 1 },
    });
  });

  it('spells the operations back the way the kernel does', () => {
    expect(operations(consoles[0]!)).toBe('-WU');
  });

  /**
   * The kernel pads the flags field to six characters with spaces for the
   * unset ones. A space is not a flag, and must not become one.
   */
  it('drops the spaces that stand for unset flags', () => {
    expect(consoles[0]!.flags).not.toContain(' ');
    expect(consoles[0]!.flags).toHaveLength(3);
  });

  it('knows which console /dev/console refers to', () => {
    expect(preferred(consoles)?.name).toBe('tty0');
    expect(hasFlag(consoles[0]!, 'C')).toBe(true);
  });
});

describe('parseConsoles — a serial-console server', () => {
  const consoles = parseConsoles(fixture('serial-server'));

  // Both are enabled; only one is what /dev/console points at.
  it('picks the preferred console out of several enabled ones', () => {
    const summary = summarize(consoles);

    expect(summary.enabled).toBe(2);
    expect(summary.preferred?.name).toBe('ttyS0');
    expect(hasFlag(consoles.find((c) => c.name === 'tty0')!, 'C')).toBe(false);
  });
});

describe('parseConsoles — an early boot console', () => {
  const consoles = parseConsoles(fixture('boot-console'));

  it('marks the boot console, which is normally handed over', () => {
    expect(bootConsoles(consoles).map((c) => c.name)).toEqual(['uart8250']);
    expect(summarize(consoles).boot).toHaveLength(1);
  });

  // A boot console has no device node, so the line simply ends after the flags.
  it('reads a line that ends without a device number', () => {
    const boot = consoles.find((c) => c.name === 'uart8250')!;

    expect(boot.device).toBeNull();
    expect(boot.flags).toEqual(['E', 'B', 'p']);
    expect(summarize(consoles).withoutDevice.map((c) => c.name)).toEqual(['uart8250']);
  });

  it('still reads the preferred console on the same file', () => {
    expect(preferred(consoles)?.name).toBe('ttyS0');
  });
});

describe('parseConsoles — netconsole', () => {
  const consoles = parseConsoles(fixture('netconsole'));

  it('reads a console with no device and the any-context flag', () => {
    const netcon = consoles.find((c) => c.name === 'netcon0')!;

    expect(netcon.device).toBeNull();
    expect(netcon.flags).toEqual(['E', 'a']);
    expect(hasFlag(netcon, 'a')).toBe(true);
    // Not a boot console, despite also having no device.
    expect(hasFlag(netcon, 'B')).toBe(false);
  });
});

describe('parseConsoles — braille and a disabled console', () => {
  const consoles = parseConsoles(fixture('braille-and-disabled'));
  const console_ = (name: string) => consoles.find((c) => c.name === name)!;

  // Registered but not enabled: it is listed and receives nothing.
  it('reads a console with no E flag as disabled', () => {
    const summary = summarize(consoles);

    expect(isEnabled(console_('ttyS1'))).toBe(false);
    expect(summary.enabled).toBe(2);
    expect(summary.disabled.map((c) => c.name)).toEqual(['ttyS1']);
  });

  it('reads a console that implements read', () => {
    expect(console_('ttyS1')).toMatchObject({ read: true, write: true, unblank: false });
    expect(operations(console_('ttyS1'))).toBe('RW-');
  });

  it('reads the braille flag', () => {
    expect(console_('brltty').flags).toEqual(['E', 'b']);
    expect(nameFlag('b')).toBe('braille');
  });
});

describe('flag names', () => {
  it('explains each letter the kernel prints', () => {
    expect(nameFlag('E')).toBe('enabled');
    expect(nameFlag('C')).toBe('preferred');
    expect(nameFlag('B')).toBe('boot');
    expect(nameFlag('p')).toBe('print-buffer');
    expect(nameFlag('a')).toBe('any-context');
    expect(describeFlag('C')).toBe('this is the console /dev/console refers to');
  });

  it('does not invent a meaning for a letter it does not know', () => {
    expect(nameFlag('Z')).toBe('Z');
    expect(describeFlag('Z')).toBe('unknown flag');
  });
});

describe('parseConsoles — every fixture', () => {
  const names = [
    'desktop-vt',
    'serial-server',
    'boot-console',
    'netconsole',
    'braille-and-disabled',
  ];

  it.each(names)('parses %s into consistent consoles', (name) => {
    const consoles = parseConsoles(fixture(name));
    const summary = summarize(consoles);

    expect(consoles.length).toBeGreaterThan(0);

    for (const console of consoles) {
      expect(console.name).not.toBe('');
      expect(operations(console)).toMatch(/^[R-][W-][U-]$/);
      // Every flag is one the kernel actually prints.
      for (const flag of console.flags) {
        expect(nameFlag(flag)).not.toBe(flag);
      }
      if (console.device !== null) {
        expect(console.device.major).toBeGreaterThan(0);
        expect(console.device.minor).toBeGreaterThanOrEqual(0);
      }
    }

    // At most one console is the preferred one.
    expect(consoles.filter((c) => hasFlag(c, 'C')).length).toBeLessThanOrEqual(1);
    expect(summary.enabled + summary.disabled.length).toBe(summary.total);
  });
});

describe('parseConsoles — awkward input', () => {
  it('returns nothing for a file that is not /proc/consoles', () => {
    expect(parseConsoles('')).toEqual([]);
    expect(parseConsoles('processor\t: 0\n')).toEqual([]);
  });

  it('reads a console with no flags set at all', () => {
    const [console_] = parseConsoles('tty0                 -WU (      )    4:1\n');

    expect(console_?.flags).toEqual([]);
    expect(isEnabled(console_!)).toBe(false);
  });

  it('reads a console that implements every operation', () => {
    const [console_] = parseConsoles('tty0                 RWU (E     )    4:1\n');

    expect(console_).toMatchObject({ read: true, write: true, unblank: true });
    expect(operations(console_!)).toBe('RWU');
  });

  it('skips a line whose operations field is malformed', () => {
    expect(parseConsoles('tty0                 XYZ (E     )    4:1\n')).toEqual([]);
  });

  it('skips a line with no parenthesised flags', () => {
    expect(parseConsoles('tty0                 -WU     4:1\n')).toEqual([]);
  });

  it('has no preferred console when none is marked', () => {
    const consoles = parseConsoles('tty0                 -WU (E     )    4:1\n');

    expect(preferred(consoles)).toBeUndefined();
    expect(summarize(consoles).preferred).toBeUndefined();
  });

  it('reads a minor of zero', () => {
    expect(parseConsoles('ttyS0                -W- (E     )    4:0\n')[0]?.device).toEqual({
      major: 4,
      minor: 0,
    });
  });
});
