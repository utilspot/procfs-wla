import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPidMapsFixture as fixture } from '../test/fixtures';
import {
  byKind,
  decodePath,
  deleted,
  describePerms,
  endOf,
  files,
  formatBytes,
  gapBefore,
  hasEscape,
  isDeleted,
  isEmpty,
  isExecutable,
  isFileBacked,
  isOrdered,
  isReservation,
  isShared,
  isWritable,
  isWritableExecutable,
  kindOf,
  labelOf,
  overlaps,
  parsePidMaps,
  sizeOf,
  startOf,
  summarize,
  totalSize,
  writableExecutable,
} from './pid-maps';
import { parseSmaps, field } from './smaps';

describe('parsePidMaps — an ordinary small program', () => {
  const maps = parsePidMaps(fixture('shell'));

  it('reads a mapping per line, in the order the kernel walks them', () => {
    expect(maps.mappings).toHaveLength(13);
    expect(maps.malformed).toEqual([]);
    expect(isOrdered(maps)).toBe(true);
    expect(overlaps(maps)).toEqual([]);
  });

  it('takes the range, the mode, the offset, the device and the inode off a line', () => {
    expect(maps.mappings[0]).toMatchObject({
      start: '55a4c1e00000',
      end: '55a4c1e02000',
      perms: 'r--p',
      offset: '00000000',
      dev: '08:02',
      inode: 24383218,
      path: '/bin/dash',
    });
  });

  /** Address space, not memory — the whole point of the file. */
  it('measures a mapping as the address space between its ends', () => {
    expect(sizeOf(maps.mappings[0]!)).toBe(0x2000);
    expect(endOf(maps.mappings[0]!) - startOf(maps.mappings[0]!)).toBe(0x2000);
    expect(formatBytes(sizeOf(maps.mappings[0]!))).toBe('8.0 KiB');
    expect(totalSize(maps)).toBe(
      maps.mappings.reduce((sum, mapping) => sum + sizeOf(mapping), 0),
    );
  });

  it('names each mapping the way smaps does, from the one shared table', () => {
    expect(kindOf(maps.mappings[0]!)).toBe('file');
    expect(kindOf(maps.mappings.find((m) => m.path === '[heap]')!)).toBe('heap');
    expect(kindOf(maps.mappings.find((m) => m.path === '[stack]')!)).toBe('stack');
    expect(kindOf(maps.mappings.find((m) => m.path === '[vdso]')!)).toBe('special');
    expect(labelOf(maps.mappings[0]!)).toBe('dash');
  });

  it('counts the distinct files mapped rather than the segments of them', () => {
    expect(files(maps)).toEqual(['/bin/dash', '/usr/lib/x86_64-linux-gnu/libc.so.6']);
    expect(summarize(maps).files).toBe(2);
  });

  /** The gaps are unmapped, and the file says nothing about them. */
  it('measures the unmapped space before a mapping', () => {
    expect(gapBefore(maps, 0)).toBe(0);
    const libc = maps.mappings.findIndex((m) => m.path.endsWith('libc.so.6'));
    expect(gapBefore(maps, libc)).toBeGreaterThan(0);
    // Consecutive segments of one file have none between them.
    expect(gapBefore(maps, libc + 1)).toBe(0);
  });
});

/** The fourth character is the mapping's type, not a fourth permission. */
describe('the mode column', () => {
  const maps = parsePidMaps(fixture('shell'));

  it('reads rwx as permissions and the fourth as private or shared', () => {
    const text = maps.mappings.find((m) => m.perms === 'r-xp')!;

    expect(describePerms(text)).toEqual([
      'readable',
      'not writable',
      'executable',
      'private — a write copies the page first',
    ]);
    expect(isExecutable(text)).toBe(true);
    expect(isWritable(text)).toBe(false);
    expect(isShared(text)).toBe(false);
  });

  it('tells a shared mapping from a private one', () => {
    const odd = parsePidMaps(fixture('odd-paths'));
    const shared = odd.mappings.find((m) => m.perms === 'rw-s')!;

    expect(isShared(shared)).toBe(true);
    expect(describePerms(shared)[3]).toContain('writes go through');
  });
});

/** The mapping outlives the file, which is why a patched library stays in use. */
describe('parsePidMaps — a library replaced under a running process', () => {
  const maps = parsePidMaps(fixture('deleted-library', '4242'));

  it('marks the mappings whose file has been unlinked', () => {
    expect(deleted(maps)).toHaveLength(3);
    expect(isDeleted(maps.mappings[0]!)).toBe(false);
    expect(summarize(maps).deleted).toBe(3);
  });

  /** `(deleted)` is the kernel's, and not part of the filename. */
  it('takes the kernel’s marker off the path', () => {
    const gone = deleted(maps)[0]!;

    expect(gone.path).toContain(' (deleted)');
    expect(decodePath(gone)).toBe('/usr/lib/x86_64-linux-gnu/libssl.so.3');
    expect(labelOf(gone)).toBe('libssl.so.3 (deleted)');
  });
});

describe('parsePidMaps — a runtime with a JIT', () => {
  const maps = parsePidMaps(fixture('jit'));

  it('finds the mapping that is writable and executable at once', () => {
    expect(writableExecutable(maps).map((m) => m.path)).toEqual(['[anon:jit-code]']);
    expect(isWritableExecutable(maps.mappings[0]!)).toBe(false);
    expect(summarize(maps).writableExecutable).toBe(1);
  });

  /** A reservation is mapped and readable by nobody: address space held back. */
  it('finds the reservation, and counts it as address space costing nothing', () => {
    const reserved = maps.mappings.filter(isReservation);

    expect(reserved).toHaveLength(1);
    expect(sizeOf(reserved[0]!)).toBe(0x140000000);
    expect(summarize(maps).largest).toBe(reserved[0]);
  });

  it('groups the address space by kind, largest first', () => {
    const kinds = byKind(maps);

    expect(kinds[0]!.kind).toBe('anon');
    expect(kinds.map((k) => k.kind)).toContain('named-anon');
    expect(kinds.reduce((sum, k) => sum + k.bytes, 0)).toBe(totalSize(maps));
    expect(kinds.reduce((sum, k) => sum + k.count, 0)).toBe(maps.mappings.length);
  });
});

describe('parsePidMaps — the shapes a path can take', () => {
  const maps = parsePidMaps(fixture('odd-paths'));

  /** seq_file_path escapes a byte that would break the line. */
  it('decodes an octal escape in a filename', () => {
    const escaped = maps.mappings[0]!;

    expect(hasEscape(escaped)).toBe(true);
    expect(escaped.path).toBe('/tmp/two\\012lines.so');
    expect(decodePath(escaped)).toBe('/tmp/two\nlines.so');
  });

  it('reads a mapping with no name at all as anonymous', () => {
    const unnamed = maps.mappings.find((m) => m.path === '')!;

    expect(kindOf(unnamed)).toBe('anon');
    expect(labelOf(unnamed)).toBe('anonymous');
    expect(isFileBacked(unnamed)).toBe(false);
  });

  /** The device and inode say file-backed even where the name does not. */
  it('reads a memfd as file-backed despite the brackets it has none of', () => {
    const memfd = maps.mappings.find((m) => m.path.startsWith('/memfd:'))!;

    expect(isFileBacked(memfd)).toBe(true);
    expect(isDeleted(memfd)).toBe(true);
    expect(decodePath(memfd)).toBe('/memfd:shared-buffer');
  });
});

/** No `mm` to walk, so nothing at all — where statm prints seven zeroes. */
describe('parsePidMaps — a kernel thread', () => {
  const maps = parsePidMaps(fixture('kernel-thread', '901'));

  it('reads an empty file as empty', () => {
    expect(isEmpty(maps)).toBe(true);
    expect(maps.mappings).toEqual([]);
    expect(summarize(maps)).toMatchObject({ mappings: 0, bytes: 0, largest: null, files: 0 });
  });
});

describe('parsePidMaps — what is not this file', () => {
  it('keeps a line that is not a mapping aside', () => {
    const maps = parsePidMaps('55a4c1e00000-55a4c1e02000 r--p 00000000 08:02 1 /bin/sh\nnope\n');

    expect(maps.malformed).toEqual(['nope']);
    expect(maps.mappings).toHaveLength(1);
  });

  it('notices mappings that overlap or run backwards', () => {
    const maps = parsePidMaps(
      '2000-4000 rw-p 00000000 00:00 0\n3000-5000 rw-p 00000000 00:00 0\n',
    );

    expect(overlaps(maps)).toHaveLength(1);
    expect(isOrdered(maps)).toBe(false);
    expect(summarize(maps).ordered).toBe(false);
  });
});

describe('formatBytes', () => {
  it('shows a span in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(0x2000)).toBe('8.0 KiB');
    expect(formatBytes(0x140000000)).toBe('5.0 GiB');
  });
});

/**
 * `smaps` is this file with the accounting filled in — a block per mapping,
 * each opening with the very line this file prints. So where a capture has
 * both, the one is exactly the header lines of the other, and these are
 * generated that way rather than written twice.
 */
describe('the machine captures, against the smaps beside them', () => {
  const root = resolve(process.cwd(), 'server/machines');
  const machines = ['container', 'desktop', 'raspberry-pi', 'server', 'vm'];
  const pids = ['1', '12282', 'self'];
  const all = machines.flatMap((machine) => pids.map((pid) => ({ machine, pid })));

  const dirOf = (machine: string, pid: string) => resolve(root, machine, 'proc', pid);
  const mapsOf = (machine: string, pid: string) =>
    parsePidMaps(readFileSync(resolve(dirOf(machine, pid), 'maps'), 'utf8'));

  const paired = all.filter(({ machine, pid }) => existsSync(resolve(dirOf(machine, pid), 'smaps')));

  it('has a maps beside every per-process capture', () => {
    for (const { machine, pid } of all) {
      expect(existsSync(resolve(dirOf(machine, pid), 'maps')), `${machine}/${pid}`).toBe(true);
    }
    expect(paired).toHaveLength(6);
  });

  it.each(paired)('$machine/$pid is exactly its smaps header lines', ({ machine, pid }) => {
    const maps = mapsOf(machine, pid);
    const smaps = parseSmaps(readFileSync(resolve(dirOf(machine, pid), 'smaps'), 'utf8'));

    expect(maps.mappings).toHaveLength(smaps.length);
    expect(maps.mappings.map((m) => `${m.start}-${m.end} ${m.perms} ${m.path}`)).toEqual(
      smaps.map((m) => `${m.start}-${m.end} ${m.perms} ${m.path}`),
    );
  });

  /** Each mapping's span is what smaps reports as its Size, in kB. */
  it.each(paired)('$machine/$pid agrees with the Size smaps gives each mapping', ({ machine, pid }) => {
    const maps = mapsOf(machine, pid);
    const smaps = parseSmaps(readFileSync(resolve(dirOf(machine, pid), 'smaps'), 'utf8'));

    maps.mappings.forEach((mapping, index) => {
      expect(sizeOf(mapping)).toBe(field(smaps[index]!, 'Size')! * 1024);
    });
  });

  it.each(all)('$machine/$pid is an address space a kernel could have walked', ({ machine, pid }) => {
    const maps = mapsOf(machine, pid);

    expect(maps.malformed).toEqual([]);
    expect(overlaps(maps)).toEqual([]);
    expect(isOrdered(maps)).toBe(true);
    expect(maps.mappings.length).toBeGreaterThan(0);
    // Every unnamed mapping is anonymous, and every named file has a device.
    for (const mapping of maps.mappings) {
      if (mapping.path === '') expect(isFileBacked(mapping)).toBe(false);
      if (mapping.path !== '' && !mapping.path.startsWith('[')) {
        expect(isFileBacked(mapping), `${machine}/${pid} ${mapping.path}`).toBe(true);
      }
    }
  });

  /** The upgraded-library case is on the server's nginx and nowhere else. */
  it('has the deleted mapping only where a service outlived its library', () => {
    const withDeleted = all.filter(({ machine, pid }) => deleted(mapsOf(machine, pid)).length > 0);

    expect(withDeleted).toEqual([{ machine: 'server', pid: '12282' }]);
  });
});
