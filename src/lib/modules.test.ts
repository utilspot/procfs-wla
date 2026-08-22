import { describe, expect, it } from 'vitest';
import { readModulesFixture as fixture } from '../test/fixtures';
import {
  dependencies,
  describeTaint,
  formatBytes,
  isRemovable,
  isTainted,
  parseModules,
  summarize,
} from './modules';

describe('parseModules — a desktop with NVIDIA', () => {
  const modules = parseModules(fixture('desktop-nvidia'));
  const module = (name: string) => modules.find((candidate) => candidate.name === name)!;

  it('reads a line per loaded module', () => {
    expect(modules).toHaveLength(20);
  });

  it('reads the six fields', () => {
    expect(module('nvidia')).toMatchObject({
      name: 'nvidia',
      size: 56717312,
      useCount: 43,
      usedBy: ['nvidia_modeset'],
      state: 'Live',
      address: '0xffffffffc0042000',
    });
  });

  it('reads `-` as nothing depending on the module', () => {
    expect(module('usbhid').usedBy).toEqual([]);
  });

  it('splits a used-by list, ignoring its trailing comma', () => {
    expect(module('drm').usedBy).toEqual(['nvidia_drm', 'drm_kms_helper']);
    expect(module('snd_pcm').usedBy).toEqual(['snd_hda_intel', 'snd_hda_codec']);
  });

  it('reads each taint letter of a group', () => {
    expect(module('nvidia').taints).toEqual(['P', 'O', 'E']);
    expect(isTainted(module('nvidia'))).toBe(true);
    expect(isTainted(module('drm'))).toBe(false);
  });

  /**
   * The kernel's field lists what depends on the module, so answering "what
   * does nvidia_drm need?" means inverting the whole table.
   */
  it('inverts the table to say what each module depends on', () => {
    const needs = dependencies(modules);

    expect(needs.get('nvidia_drm')).toEqual(['nvidia_modeset', 'drm_kms_helper', 'drm']);
    expect(needs.get('nvidia_modeset')).toEqual(['nvidia']);
    // Nothing is above nvidia in the stack.
    expect(needs.get('nvidia')).toEqual([]);

    // ext4 is the module that needs jbd2 and mbcache, though the file states it
    // the other way round — as jbd2 and mbcache each being used by ext4.
    expect(needs.get('ext4')).toEqual(['mbcache', 'jbd2']);
    expect(needs.get('jbd2')).toEqual([]);
    expect(module('jbd2').usedBy).toEqual(['ext4']);
  });

  // A reference can be held by something that is not a module at all — an open
  // device node, a mounted filesystem — so the count outruns the list.
  it('keeps a use count that is higher than the used-by list', () => {
    expect(module('nf_nat')).toMatchObject({ useCount: 1, usedBy: [] });
    expect(isRemovable(module('nf_nat'))).toBe(false);
  });

  it('finds the modules nothing holds a reference to', () => {
    expect(modules.filter(isRemovable).map((candidate) => candidate.name)).toEqual([
      'usbhid',
      'btusb',
    ]);
  });

  it('summarizes the table', () => {
    const summary = summarize(modules);

    expect(summary.count).toBe(20);
    expect(formatBytes(summary.totalBytes)).toBe('58 MiB');
    expect(summary.removable).toBe(2);
    expect(summary.largest[0]?.name).toBe('nvidia');
    expect(summary.tainted.map((candidate) => candidate.name)).toEqual([
      'nvidia',
      'nvidia_modeset',
      'nvidia_drm',
    ]);
    expect(summary.taints).toEqual([
      { letter: 'E', count: 3 },
      { letter: 'O', count: 3 },
      { letter: 'P', count: 3 },
    ]);
    expect(summary.unsettled).toEqual([]);
  });
});

describe('parseModules — a server with kptr_restrict on', () => {
  const modules = parseModules(fixture('server-minimal'));

  // Every address is zeroes unless the reader is privileged, which is not the
  // same as the module living at address zero.
  it('reads a hidden address as absent rather than as a real one', () => {
    expect(modules.every((module) => module.address === null)).toBe(true);
  });

  it('has nothing tainted and nothing mid-transition', () => {
    const summary = summarize(modules);

    expect(summary.tainted).toEqual([]);
    expect(summary.taints).toEqual([]);
    expect(summary.unsettled).toEqual([]);
  });
});

describe('parseModules — a container host', () => {
  const modules = parseModules(fixture('container-host'));

  it('follows a chain three deep', () => {
    const needs = dependencies(modules);

    // bridge needs stp and llc; stp needs llc; br_netfilter needs bridge.
    expect(needs.get('bridge')).toEqual(['stp', 'llc']);
    expect(needs.get('stp')).toEqual(['llc']);
    expect(needs.get('br_netfilter')).toEqual(['bridge']);
    // llc is at the bottom: it needs nothing.
    expect(needs.get('llc')).toEqual([]);
  });

  it('picks the one out-of-tree module out of twelve', () => {
    const summary = summarize(modules);

    expect(summary.tainted.map((module) => module.name)).toEqual(['aufs']);
    expect(summary.tainted[0]?.taints).toEqual(['O', 'E']);
  });
});

describe('parseModules — a workstation with everything bolted on', () => {
  const modules = parseModules(fixture('tainted-vbox'));
  const module = (name: string) => modules.find((candidate) => candidate.name === name)!;

  it('counts every taint letter across the table', () => {
    expect(summarize(modules).taints).toEqual([
      { letter: 'O', count: 6 },
      { letter: 'E', count: 4 },
      { letter: 'P', count: 2 },
      { letter: 'F', count: 1 },
    ]);
  });

  it('reads a module that is not Live', () => {
    expect(module('rtl8812au').state).toBe('Unloading');
    expect(summarize(modules).unsettled.map((candidate) => candidate.name)).toEqual(['rtl8812au']);
  });

  it('reads a forced load alongside its other taints', () => {
    expect(module('rtl8812au').taints).toEqual(['O', 'E', 'F']);
  });

  it('explains what each letter means', () => {
    expect(describeTaint('P')).toBe('proprietary, not GPL-compatible');
    expect(describeTaint('O')).toBe('built out of tree');
    expect(describeTaint('F')).toBe('force loaded');
    expect(describeTaint('Z')).toBe('unknown taint');
  });
});

describe('parseModules — every fixture', () => {
  const names = ['desktop-nvidia', 'server-minimal', 'container-host', 'tainted-vbox', 'arm-rpi'];

  it.each(names)('parses %s into consistent modules', (name) => {
    const modules = parseModules(fixture(name));
    const needs = dependencies(modules);
    const byName = new Set(modules.map((module) => module.name));

    expect(modules.length).toBeGreaterThan(0);

    for (const module of modules) {
      expect(module.name).not.toBe('');
      expect(module.size).toBeGreaterThan(0);
      expect(module.useCount).toBeGreaterThanOrEqual(0);
      // The fixtures never name a dependent that is not itself loaded.
      for (const dependent of module.usedBy) expect(byName.has(dependent)).toBe(true);
    }

    // The inverted graph holds exactly as many edges as the original.
    const edges = modules.reduce((sum, module) => sum + module.usedBy.length, 0);
    expect([...needs.values()].reduce((sum, list) => sum + list.length, 0)).toBe(edges);
  });
});

describe('parseModules — awkward input', () => {
  it('returns nothing for a file that is not /proc/modules', () => {
    expect(parseModules('')).toEqual([]);
    expect(parseModules('processor\t: 0\n')).toEqual([]);
  });

  it('skips a line with too few fields', () => {
    expect(parseModules('ext4 962560 1 -\n')).toEqual([]);
  });

  it('skips a line whose size or use count is not a number', () => {
    expect(parseModules('ext4 big 1 - Live 0xffff\n')).toEqual([]);
    expect(parseModules('ext4 962560 lots - Live 0xffff\n')).toEqual([]);
  });

  it('reads a module with no taint group', () => {
    const [module] = parseModules('ext4 962560 1 - Live 0xffffffffc0000000\n');

    expect(module).toMatchObject({ taints: [], address: '0xffffffffc0000000' });
  });

  it('records a dependent that is not itself a line in the file', () => {
    // A module can be listed as a user before its own line is reached.
    const needs = dependencies(parseModules('a 100 1 b, Live 0xffff\n'));

    expect(needs.get('b')).toEqual(['a']);
  });

  it('does not repeat an edge listed twice', () => {
    const needs = dependencies(parseModules('a 100 2 b,b, Live 0xffff\nb 100 0 - Live 0xffff\n'));

    expect(needs.get('b')).toEqual(['a']);
  });
});

describe('formatBytes', () => {
  it('scales through the binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(16384)).toBe('16 KiB');
    expect(formatBytes(1224704)).toBe('1.2 MiB');
    expect(formatBytes(56717312)).toBe('54 MiB');
  });
});
