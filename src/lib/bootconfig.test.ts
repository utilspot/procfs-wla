import { describe, expect, it } from 'vitest';
import { readBootConfigFixture as fixture } from '../test/fixtures';
import {
  destinationOf,
  find,
  isFlag,
  parseBootConfig,
  sections,
  summarize,
} from './bootconfig';

describe('parseBootConfig — a boot-time tracing config', () => {
  const entries = parseBootConfig(fixture('ftrace-boot'));

  it('reads a key per line', () => {
    expect(entries).toHaveLength(13);
    expect(summarize(entries).flags).toBe(5);
  });

  // The dots are structure, not part of the name.
  it('splits a dotted key into its path', () => {
    const entry = find(entries, 'ftrace.instance.boot.current_tracer')!;

    expect(entry.path).toEqual(['ftrace', 'instance', 'boot', 'current_tracer']);
    expect(entry.values).toEqual(['function_graph']);
    expect(summarize(entries).depth).toBe(5);
  });

  it('reads a bare key as a flag with no value', () => {
    const flag = find(entries, 'ftrace.event.sched.sched_switch.enable')!;

    expect(isFlag(flag)).toBe(true);
    expect(flag.values).toEqual([]);
  });

  it('reads a comma-separated array as several values', () => {
    expect(find(entries, 'ftrace.instance.boot.events')?.values).toEqual([
      'initcall.initcall_start',
      'irq.irq_handler_entry',
      'sched.sched_switch',
    ]);
  });

  it('groups by top-level key in the order they first appear', () => {
    const grouped = sections(entries);

    expect(grouped.map((section) => section.name)).toEqual(['ftrace', 'kernel']);
    expect(grouped[0]?.entries).toHaveLength(11);
    expect(grouped[1]?.entries).toHaveLength(2);
  });
});

describe('parseBootConfig — the two special sections', () => {
  const entries = parseBootConfig(fixture('kernel-and-init'));

  /**
   * This is what the file is for: `kernel.*` is appended to the command line
   * and `init.*` goes to init, while anything else is only read by whoever
   * asks for it.
   */
  it('knows where each section is sent', () => {
    expect(destinationOf(find(entries, 'kernel.root')!)).toBe('kernel command line');
    expect(destinationOf(find(entries, 'init.arg')!)).toBe('init');

    const summary = summarize(entries);
    expect(summary.toKernel).toBe(6);
    expect(summary.toInit).toBe(2);
  });

  it('keeps a value that contains commas', () => {
    expect(find(entries, 'kernel.console')?.values).toEqual(['ttyS0,115200n8']);
  });

  it('reads init arguments and environment as arrays', () => {
    expect(find(entries, 'init.arg')?.values).toEqual(['--system', '--unit=multi-user.target']);
    expect(find(entries, 'init.env')?.values).toEqual(['HOME=/root', 'TERM=linux']);
  });
});

describe('parseBootConfig — module parameters', () => {
  const entries = parseBootConfig(fixture('module-params'));

  it('gives each module its own section, read by nobody in particular', () => {
    const grouped = sections(entries);

    expect(grouped.map((section) => section.name)).toEqual([
      'kernel',
      'i915',
      'nvme_core',
      'usbcore',
      'snd_hda_intel',
      'scsi_mod',
    ]);
    expect(grouped[1]?.destination).toBe('whoever reads it');
    expect(grouped[0]?.destination).toBe('kernel command line');
  });

  it('keeps a negative value whole', () => {
    expect(find(entries, 'usbcore.autosuspend')?.values).toEqual(['-1']);
  });
});

describe('parseBootConfig — awkward values', () => {
  const entries = parseBootConfig(fixture('quoted-values'));

  // A comma inside the quotes belongs to the value, so the list cannot simply
  // be split on commas.
  it('keeps commas and spaces that are inside the quotes', () => {
    expect(find(entries, 'systemd.setenv')?.values).toEqual(['GREETING=hello, there']);
    expect(find(entries, 'kernel.dyndbg')?.values).toEqual(['module nvme +p']);
  });

  it('splits an array whose elements each hold spaces and commas', () => {
    expect(find(entries, 'init.arg')?.values).toEqual([
      'sh',
      '-c',
      'echo hello, world > /dev/kmsg',
    ]);
  });

  it('keeps an expression containing angle brackets and ampersands', () => {
    expect(find(entries, 'ftrace.instance.boot.filter')?.values).toEqual([
      'prev_pid > 100 && next_prio < 20',
    ]);
  });

  it('counts every value, not every key', () => {
    expect(summarize(entries)).toMatchObject({ keys: 6, values: 9 });
  });
});

describe('parseBootConfig — every fixture', () => {
  const names = [
    'ftrace-boot',
    'kernel-and-init',
    'module-params',
    'quoted-values',
    'minimal',
    'not-configured',
  ];

  it.each(names)('parses %s into consistent entries', (name) => {
    const entries = parseBootConfig(fixture(name));
    const summary = summarize(entries);

    // The unconfigured machine has no keys at all; every other fixture has some.
    if (name === 'not-configured') expect(entries).toEqual([]);
    else expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry.key).not.toBe('');
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.path.join('.')).toBe(entry.key);
      // A value is never left with its quotes on.
      expect(entry.values.every((value) => !value.startsWith('"'))).toBe(true);
    }

    // Grouping accounts for every key exactly once.
    expect(sections(entries).reduce((count, s) => count + s.entries.length, 0)).toBe(summary.keys);
    expect(summary.flags + entries.filter((e) => !isFlag(e)).length).toBe(summary.keys);
  });
});

describe('parseBootConfig — awkward input', () => {
  // Most machines boot without one, and the file is then empty.
  it('reads an empty file as no configuration', () => {
    expect(parseBootConfig('')).toEqual([]);
    expect(parseBootConfig('\n\n')).toEqual([]);
    expect(summarize(parseBootConfig(''))).toMatchObject({ keys: 0, sections: 0, depth: 0 });
  });

  it('ignores a comment line', () => {
    expect(parseBootConfig('# bootconfig\nkernel.quiet\n')).toHaveLength(1);
  });

  it('reads a key with no dots as its own section', () => {
    const [entry] = parseBootConfig('standalone = "1"\n');

    expect(entry?.path).toEqual(['standalone']);
    expect(destinationOf(entry!)).toBe('whoever reads it');
  });

  it('reads a key whose value contains an equals sign', () => {
    expect(find(parseBootConfig('kernel.root = "UUID=abc"\n'), 'kernel.root')?.values).toEqual([
      'UUID=abc',
    ]);
  });

  it('takes the rest of the line when a quote is left open', () => {
    expect(parseBootConfig('a = "unterminated\n')[0]?.values).toEqual(['unterminated']);
  });

  it('reads an unquoted value, though the kernel always quotes', () => {
    expect(parseBootConfig('a = bare\n')[0]?.values).toEqual(['bare']);
  });

  it('reads an empty value list as a flag', () => {
    expect(isFlag(parseBootConfig('a =\n')[0]!)).toBe(true);
  });

  it('resolves a repeated key to the last one given', () => {
    const entries = parseBootConfig('a = "first"\na = "second"\n');

    expect(entries).toHaveLength(2);
    expect(find(entries, 'a')?.values).toEqual(['second']);
  });
});
