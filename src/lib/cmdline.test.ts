import { describe, expect, it } from 'vitest';
import { readCmdlineFixture as fixture } from '../test/fixtures';
import {
  byModule,
  duplicates,
  find,
  parseCmdline,
  relaxations,
  summarize,
} from './cmdline';

describe('parseCmdline — an Ubuntu desktop', () => {
  const cmdline = parseCmdline(fixture('ubuntu-desktop'));

  it('reads every parameter in order', () => {
    expect(cmdline.parameters).toHaveLength(7);
    expect(cmdline.parameters.map((parameter) => parameter.key)).toEqual([
      'BOOT_IMAGE',
      'root',
      'ro',
      'quiet',
      'splash',
      'vt.handoff',
      'i915.enable_psr',
    ]);
  });

  // `root=UUID=1b9f…` splits on the first `=` only.
  it('splits a value that itself contains an equals sign', () => {
    expect(find(cmdline, 'root')).toMatchObject({
      key: 'root',
      value: 'UUID=1b9f3a7c-5d2e-4f81-9a6b-0c3d8e7f2a41',
    });
  });

  it('reads a bare flag as having no value', () => {
    expect(find(cmdline, 'quiet')).toMatchObject({ key: 'quiet', value: null, module: null });
    expect(summarize(cmdline).flags).toBe(3);
  });

  it('splits a dotted key into module and name', () => {
    expect(find(cmdline, 'i915.enable_psr')).toMatchObject({
      module: 'i915',
      name: 'enable_psr',
      value: '0',
    });
    expect(byModule(cmdline).map((group) => group.module)).toEqual(['i915', 'vt']);
  });

  it('calls out what the machine booted', () => {
    const notable = summarize(cmdline).notable;

    expect(notable.map((entry) => entry.label)).toEqual(['kernel', 'root device']);
    expect(notable[0]?.parameter.value).toBe('/boot/vmlinuz-6.8.0-45-generic');
  });

  it('has nothing given twice and no protection turned off', () => {
    expect(duplicates(cmdline)).toEqual([]);
    expect(relaxations(cmdline)).toEqual([]);
  });
});

describe('parseCmdline — a serial-console server', () => {
  const cmdline = parseCmdline(fixture('server-serial'));

  // The kernel takes the last `console=`, so `find` has to look from the end.
  it('resolves a repeated parameter to the last one given', () => {
    expect(find(cmdline, 'console')?.value).toBe('ttyS0,115200n8');
  });

  it('reports what was given twice, with every value', () => {
    expect(duplicates(cmdline)).toEqual([
      { key: 'console', values: ['tty0', 'ttyS0,115200n8'] },
    ]);
  });

  it('does not mistake audit=1 for audit being off', () => {
    expect(relaxations(cmdline)).toEqual([]);
  });
});

describe('parseCmdline — a rescue boot', () => {
  const cmdline = parseCmdline(fixture('rescue-shell'));

  it('points out every protection that was switched off', () => {
    expect(relaxations(cmdline).map((entry) => entry.parameter.raw)).toEqual([
      'init=/bin/bash',
      'mitigations=off',
      'nokaslr',
      'selinux=0',
      'module.sig_enforce=0',
    ]);
  });

  it('explains each one', () => {
    const notes = relaxations(cmdline).map((entry) => entry.note);

    expect(notes).toContain('kernel address randomisation disabled');
    expect(notes).toContain('unsigned modules allowed');
    expect(notes).toContain('init is a shell');
  });
});

describe('parseCmdline — a Raspberry Pi', () => {
  const cmdline = parseCmdline(fixture('rpi-boot'));

  it('groups six modules worth of parameters', () => {
    expect(byModule(cmdline).map((group) => group.module)).toEqual([
      '8250',
      'fsck',
      'plymouth',
      'smsc95xx',
      'snd_bcm2835',
      'vc_mem',
    ]);
  });

  it('reads a dotted flag with no value', () => {
    expect(find(cmdline, 'plymouth.ignore-serial-consoles')).toMatchObject({
      module: 'plymouth',
      name: 'ignore-serial-consoles',
      value: null,
    });
  });

  it('has no BOOT_IMAGE, since the firmware loads the kernel', () => {
    expect(find(cmdline, 'BOOT_IMAGE')).toBeUndefined();
    expect(summarize(cmdline).notable.map((entry) => entry.label)).toEqual([
      'root device',
      'root filesystem',
      'console',
    ]);
  });

  it('keeps a value holding colons and an at sign', () => {
    expect(find(cmdline, 'video')?.value).toBe('HDMI-A-1:1920x1080M@60');
    expect(find(cmdline, 'smsc95xx.macaddr')?.value).toBe('DC:A6:32:1E:4B:07');
  });
});

describe('parseCmdline — arguments for init', () => {
  const cmdline = parseCmdline(fixture('custom-init'));

  it('keeps a quoted value with spaces in one piece', () => {
    expect(find(cmdline, 'dyndbg')?.value).toBe('module nvme +p');
    // The quotes stay in `raw` but the kernel drops them from the value.
    expect(find(cmdline, 'dyndbg')?.raw).toBe('dyndbg="module nvme +p"');
  });

  it('separates what comes after -- from the kernel parameters', () => {
    expect(cmdline.initArgs).toEqual(['--system', '--unit=rescue.target']);
    expect(cmdline.parameters).toHaveLength(6);
    expect(cmdline.parameters.map((parameter) => parameter.key)).not.toContain('--system');
  });
});

describe('parseCmdline — every fixture', () => {
  const names = ['ubuntu-desktop', 'server-serial', 'rescue-shell', 'rpi-boot', 'custom-init'];

  it.each(names)('parses %s into usable parameters', (name) => {
    const cmdline = parseCmdline(fixture(name));

    expect(cmdline.parameters.length).toBeGreaterThan(0);
    expect(cmdline.raw).not.toContain('\n');

    for (const parameter of cmdline.parameters) {
      expect(parameter.key).not.toBe('');
      expect(parameter.raw).not.toBe('');
      // A dotted key always yields both halves.
      if (parameter.module !== null) {
        expect(parameter.module).not.toBe('');
        expect(parameter.name).not.toBe('');
        expect(parameter.key).toBe(`${parameter.module}.${parameter.name}`);
      }
    }

    // Every parameter has a root device to boot from, one way or another.
    expect(find(cmdline, 'root')).toBeDefined();
  });
});

describe('parseCmdline — awkward input', () => {
  it('reads an empty file as no parameters', () => {
    expect(parseCmdline('')).toEqual({ raw: '', parameters: [], initArgs: [] });
    expect(parseCmdline('\n\n')).toEqual({ raw: '', parameters: [], initArgs: [] });
  });

  it('collapses runs of whitespace between parameters', () => {
    const cmdline = parseCmdline('  ro   quiet\tsplash  ');

    expect(cmdline.parameters.map((parameter) => parameter.key)).toEqual([
      'ro',
      'quiet',
      'splash',
    ]);
  });

  it('reads a value that is empty', () => {
    expect(find(parseCmdline('crashkernel='), 'crashkernel')).toMatchObject({ value: '' });
  });

  it('takes the first line of a file with a trailing newline', () => {
    expect(parseCmdline('ro quiet\n').parameters).toHaveLength(2);
  });

  it('handles a -- with nothing after it', () => {
    const cmdline = parseCmdline('ro quiet --');

    expect(cmdline.parameters).toHaveLength(2);
    expect(cmdline.initArgs).toEqual([]);
  });

  it('does not treat a doubled dash inside a token as the separator', () => {
    const cmdline = parseCmdline('foo=--bar baz');

    expect(cmdline.parameters).toHaveLength(2);
    expect(cmdline.initArgs).toEqual([]);
  });

  it('keeps a quoted run of spaces from splitting the line', () => {
    const cmdline = parseCmdline('a="one two three" b=plain');

    expect(cmdline.parameters).toHaveLength(2);
    expect(find(cmdline, 'a')?.value).toBe('one two three');
  });
});
