import { describe, expect, it } from 'vitest';
import { readDevicesFixture as fixture } from '../test/fixtures';
import { byMajor, isLocal, parseDevices, summarize } from './devices';

describe('parseDevices — an x86 desktop', () => {
  const devices = parseDevices(fixture('desktop-x86'));

  it('splits the two sections', () => {
    expect(devices.character).toHaveLength(45);
    expect(devices.block).toHaveLength(16);
    expect(devices.character.every((device) => device.kind === 'character')).toBe(true);
    expect(devices.block.every((device) => device.kind === 'block')).toBe(true);
  });

  it('reads a major and a name per line', () => {
    expect(devices.character[0]).toEqual({ major: 1, name: 'mem', kind: 'character' });
    expect(devices.block.at(-1)).toEqual({ major: 259, name: 'blkext', kind: 'block' });
  });

  it('keeps a name that is a path', () => {
    expect(devices.character).toContainEqual({
      major: 4,
      name: '/dev/vc/0',
      kind: 'character',
    });
  });

  it('groups the drivers sharing a major', () => {
    const groups = byMajor(devices.character);

    expect(groups.find((group) => group.major === 4)?.names).toEqual([
      '/dev/vc/0',
      'tty',
      'ttyS',
    ]);
    expect(groups.find((group) => group.major === 5)?.names).toHaveLength(4);
    expect(groups.map((group) => group.major)).toEqual(
      [...groups.map((group) => group.major)].sort((a, b) => a - b),
    );
  });

  // Character and block majors are separate number spaces, so the same number
  // in each section is two unrelated drivers.
  it('keeps the two number spaces apart', () => {
    expect(byMajor(devices.character).find((group) => group.major === 7)?.names).toEqual(['vcs']);
    expect(byMajor(devices.block).find((group) => group.major === 7)?.names).toEqual(['loop']);
  });

  it('summarizes the file', () => {
    const summary = summarize(devices);

    expect(summary.total).toBe(61);
    expect(summary.characterMajors).toBe(40);
    expect(summary.blockMajors).toBe(16);
    expect(summary.shared.map((group) => group.major)).toEqual([4, 5]);
  });

  it('finds the driver holding several majors', () => {
    const summary = summarize(devices);

    expect(summary.spread).toHaveLength(1);
    expect(summary.spread[0]).toEqual({
      name: 'sd',
      kind: 'block',
      majors: [8, 65, 66, 67, 68, 128, 129],
    });
  });

  it('flags the majors in the local and experimental ranges', () => {
    expect(summarize(devices).local.map((device) => device.major)).toContain(240);
    expect(isLocal(240)).toBe(true);
    expect(isLocal(254)).toBe(true);
    expect(isLocal(60)).toBe(true);
    expect(isLocal(63)).toBe(true);
    expect(isLocal(120)).toBe(true);
    expect(isLocal(127)).toBe(true);
    expect(isLocal(59)).toBe(false);
    expect(isLocal(255)).toBe(false);
    expect(isLocal(259)).toBe(false);
  });
});

describe('parseDevices — a storage server', () => {
  const devices = parseDevices(fixture('server-multipath'));

  it('reads sd spread across sixteen block majors', () => {
    const [sd] = summarize(devices).spread;

    expect(sd?.name).toBe('sd');
    expect(sd?.majors).toHaveLength(16);
    expect(sd?.majors[0]).toBe(8);
    expect(sd?.majors.at(-1)).toBe(135);
  });
});

describe('parseDevices — a container', () => {
  const devices = parseDevices(fixture('container'));

  it('reads the short list a namespaced /proc shows', () => {
    expect(summarize(devices).total).toBe(13);
    expect(devices.block.map((device) => device.name)).toEqual([
      'loop',
      'sd',
      'device-mapper',
      'mdp',
      'blkext',
    ]);
  });

  it('has no driver holding more than one major', () => {
    expect(summarize(devices).spread).toEqual([]);
  });
});

describe('parseDevices — every fixture', () => {
  const names = ['desktop-x86', 'container', 'raspberry-pi', 'server-multipath', 'legacy-ide'];

  it.each(names)('parses %s into usable sections', (name) => {
    const devices = parseDevices(fixture(name));

    expect(devices.character.length).toBeGreaterThan(0);
    expect(devices.block.length).toBeGreaterThan(0);

    for (const device of [...devices.character, ...devices.block]) {
      expect(Number.isInteger(device.major)).toBe(true);
      expect(device.major).toBeGreaterThanOrEqual(0);
      expect(device.name).not.toBe('');
    }

    // Grouping loses no name and invents none.
    const grouped = byMajor(devices.character).flatMap((group) => group.names);
    expect(grouped).toHaveLength(new Set(devices.character.map((d) => `${d.major}:${d.name}`)).size);
  });
});

describe('parseDevices — awkward input', () => {
  it('returns empty sections for a file that is not /proc/devices', () => {
    expect(parseDevices('')).toEqual({ character: [], block: [] });
    expect(parseDevices('processor\t: 0\n')).toEqual({ character: [], block: [] });
  });

  it('ignores entries that appear before any section header', () => {
    const devices = parseDevices('  1 mem\n\nBlock devices:\n  7 loop\n');

    expect(devices.character).toEqual([]);
    expect(devices.block).toHaveLength(1);
  });

  it('accepts the headers in any case', () => {
    const devices = parseDevices('CHARACTER DEVICES:\n 1 mem\n\nblock devices:\n 7 loop\n');

    expect(devices.character).toHaveLength(1);
    expect(devices.block).toHaveLength(1);
  });

  it('skips a line that is neither a header nor an entry', () => {
    const devices = parseDevices('Character devices:\n  1 mem\nnonsense here\n  4 tty\n');

    expect(devices.character.map((device) => device.name)).toEqual(['mem', 'tty']);
  });

  it('drops a duplicate registration when grouping', () => {
    const groups = byMajor(parseDevices('Character devices:\n 4 tty\n 4 tty\n 4 ttyS\n').character);

    expect(groups).toEqual([{ major: 4, names: ['tty', 'ttyS'] }]);
  });
});
