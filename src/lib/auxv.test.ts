import { describe, expect, it } from 'vitest';
import { readAuxvFixture as fixture } from '../test/fixtures';
import {
  AT_BASE,
  AT_PAGESZ,
  AT_SECURE,
  AT_SYSINFO_EHDR,
  describeType,
  detectLayout,
  entryFor,
  formatValue,
  gainedPrivilege,
  isEmpty,
  isSecure,
  isStatic,
  isUnknown,
  isUnreadable,
  nameFor,
  pageSize,
  parseAuxv,
  valueOf,
} from './auxv';

describe('parseAuxv — an ordinary x86_64 program', () => {
  const auxv = parseAuxv(fixture('desktop', 'self'));

  it('works the layout out from the bytes', () => {
    expect(auxv.layout).toEqual({ words: 8, endian: 'little' });
  });

  it('reads the vector to its terminator and no further', () => {
    expect(auxv.entries).toHaveLength(20);
    expect(auxv.terminated).toBe(true);
    expect(auxv.trailing).toBe(0);
    // AT_NULL ends it and is not one of the entries.
    expect(auxv.entries.some((entry) => entry.type === 0)).toBe(false);
  });

  it('reads a pointer whole, which is why the file is read as bytes', () => {
    expect(valueOf(auxv, AT_SYSINFO_EHDR)).toBe(0x7ffd8d3f9000n);
    expect(valueOf(auxv, 25)).toBe(0x7ffd8d3d4f39n);
  });

  it('keeps the file’s own order, which is the order the kernel wrote it', () => {
    expect(auxv.entries.slice(0, 4).map((entry) => nameFor(entry.type))).toEqual([
      'AT_SYSINFO_EHDR',
      'AT_MINSIGSTKSZ',
      'AT_HWCAP',
      'AT_PAGESZ',
    ]);
  });

  it('says where each pair is, for the bytes beside it', () => {
    expect(auxv.entries[0]!.offset).toBe(0);
    expect(auxv.entries[1]!.offset).toBe(16);
    expect(auxv.entries[19]!.offset).toBe(19 * 16);
  });

  it('reads the values a page speaks about', () => {
    expect(pageSize(auxv)).toBe(4096);
    expect(isSecure(auxv)).toBe(false);
    expect(isStatic(auxv)).toBe(false);
    expect(gainedPrivilege(auxv)).toBe(false);
  });

  it('shows a value the way that value is worth reading', () => {
    expect(formatValue(entryFor(auxv, AT_SYSINFO_EHDR)!)).toBe('0x7ffd8d3f9000');
    expect(formatValue(entryFor(auxv, AT_PAGESZ)!)).toBe('4096');
    expect(formatValue(entryFor(auxv, AT_SECURE)!)).toBe('no');
    expect(formatValue(entryFor(auxv, 16)!)).toBe('0x178bfbff');
  });

  it('knows what each number is for', () => {
    expect(describeType(AT_SYSINFO_EHDR)).toMatch(/vDSO/);
    expect(describeType(25)).toMatch(/stack canary/);
    expect(auxv.entries.some(isUnknown)).toBe(false);
  });
});

describe('parseAuxv — the layouts', () => {
  /**
   * The word size is the process's, not the kernel's, and nothing in the file
   * says which — so it is read each way and the one that comes out as a vector
   * wins.
   */
  it('reads a 32-bit process as four-byte words', () => {
    const auxv = parseAuxv(fixture('i386', 'self'));

    expect(auxv.layout).toEqual({ words: 4, endian: 'little' });
    expect(auxv.entries).toHaveLength(20);
    expect(auxv.entries[0]!.offset).toBe(0);
    expect(auxv.entries[1]!.offset).toBe(8);
    // AT_SYSINFO, which is a 32-bit x86 entry and appears on nothing else.
    expect(valueOf(auxv, 32)).toBe(0xf7f2d0a0n);
  });

  it('does not read a 32-bit file as a 64-bit one', () => {
    // Its first 64-bit word would be a pointer where a type belongs.
    expect(detectLayout(fixture('i386', 'self'))).toEqual({ words: 4, endian: 'little' });
  });

  it('reads a big-endian vector as one', () => {
    const pairs = new Uint8Array(32);
    const view = new DataView(pairs.buffer);
    view.setBigUint64(0, 6n, false); // AT_PAGESZ
    view.setBigUint64(8, 65536n, false);
    view.setBigUint64(16, 17n, false); // AT_CLKTCK
    view.setBigUint64(24, 100n, false);

    const auxv = parseAuxv(pairs);
    // No terminator, so nothing fits, and the layout is unknown rather than wrong.
    expect(auxv.layout).toBeNull();

    const terminated = new Uint8Array(48);
    terminated.set(pairs);
    expect(parseAuxv(terminated).layout).toEqual({ words: 8, endian: 'big' });
    expect(valueOf(parseAuxv(terminated), 6)).toBe(65536n);
  });

  it('has no layout for bytes that are not a vector any way round', () => {
    const noise = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const auxv = parseAuxv(noise);

    expect(auxv.layout).toBeNull();
    expect(isUnreadable(auxv)).toBe(true);
    expect(auxv.entries).toEqual([]);
  });
});

describe('parseAuxv — the other programs', () => {
  it('reads a static binary as one, by the loader it does not have', () => {
    const auxv = parseAuxv(fixture('static', 'self'));

    expect(valueOf(auxv, AT_BASE)).toBe(0n);
    expect(isStatic(auxv)).toBe(true);
    // Linked at a fixed address rather than wherever it was mapped.
    expect(valueOf(auxv, 3)).toBe(0x400040n);
  });

  it('reads a set-uid program by what exec gave it', () => {
    const auxv = parseAuxv(fixture('setuid', 'self'));

    expect(isSecure(auxv)).toBe(true);
    expect(gainedPrivilege(auxv)).toBe(true);
    expect(valueOf(auxv, 11)).toBe(1000n);
    expect(valueOf(auxv, 12)).toBe(0n);
  });

  it('reads an ARM64 vector, entries and all', () => {
    const auxv = parseAuxv(fixture('arm64', 'self'));

    expect(auxv.layout).toEqual({ words: 8, endian: 'little' });
    // A signal stack an order of magnitude past the old SIGSTKSZ.
    expect(valueOf(auxv, 51)).toBe(5312n);
    expect(valueOf(auxv, 27)).toBe(28n);
    // And no AT_SYSINFO, which is 32-bit x86's alone.
    expect(valueOf(auxv, 32)).toBeNull();
  });

  /** A kernel thread has no mm, so there is no vector to copy out. */
  it('reads an empty file as a process with no vector', () => {
    const auxv = parseAuxv(fixture('desktop', '74'));

    expect(isEmpty(auxv)).toBe(true);
    expect(isUnreadable(auxv)).toBe(false);
    expect(auxv.entries).toEqual([]);
    expect(auxv.layout).toBeNull();
  });
});

describe('parseAuxv — entries the fixtures do not hold', () => {
  /** Built here rather than captured, since no machine writes one. */
  const vector = (pairs: [number, bigint][]): Uint8Array => {
    const bytes = new Uint8Array((pairs.length + 1) * 16);
    const view = new DataView(bytes.buffer);
    pairs.forEach(([type, value], index) => {
      view.setBigUint64(index * 16, BigInt(type), true);
      view.setBigUint64(index * 16 + 8, value, true);
    });
    return bytes;
  };

  it('keeps a type no table here knows', () => {
    const auxv = parseAuxv(vector([[6, 4096n], [99, 0x1234n]]));
    const unknown = entryFor(auxv, 99)!;

    expect(nameFor(99)).toBeNull();
    expect(describeType(99)).toBeNull();
    expect(isUnknown(unknown)).toBe(true);
    // Shown as an address, which is what an unknown value most often is.
    expect(formatValue(unknown)).toBe('0x1234');
  });

  it('notices bytes after the terminator', () => {
    const bytes = new Uint8Array(48);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, 6n, true);
    view.setBigUint64(8, 4096n, true);
    // AT_NULL at 16, then a pair of rubbish nothing should read.
    view.setBigUint64(32, 3n, true);
    view.setBigUint64(40, 0xdeadn, true);

    // Nothing fits with trailing bytes, so no layout claims it.
    expect(parseAuxv(bytes).layout).toBeNull();
  });

  it('reads a vector that is only its terminator', () => {
    const auxv = parseAuxv(new Uint8Array(16));

    expect(auxv.entries).toEqual([]);
    expect(auxv.terminated).toBe(true);
    expect(isEmpty(auxv)).toBe(false);
  });
});
