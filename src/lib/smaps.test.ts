import { describe, expect, it } from 'vitest';
import { readSmapsFixture as fixture } from '../test/fixtures';
import {
  byKind,
  describeField,
  describeFlag,
  field,
  formatKib,
  formatShare,
  isExecutable,
  isMemoryField,
  isReservation,
  isShared,
  isWritable,
  isWritableExecutable,
  kindOf,
  labelOf,
  parseSmaps,
  RSS_PARTS,
  rssParts,
  sharedShare,
  summarize,
} from './smaps';

const find = (mappings: ReturnType<typeof parseSmaps>, path: RegExp) =>
  mappings.find((mapping) => path.test(mapping.path))!;

/** The mapping of a file with the given permissions, e.g. its text segment. */
const segment = (mappings: ReturnType<typeof parseSmaps>, path: RegExp, perms: string) =>
  mappings.find((mapping) => path.test(mapping.path) && mapping.perms === perms)!;

describe('parseSmaps — a shell, captured whole', () => {
  const mappings = parseSmaps(fixture('desktop', 'self'));

  it('reads a block per mapping, opening with the maps line', () => {
    expect(mappings).toHaveLength(38);
    expect(mappings[0]).toMatchObject({ perms: 'r--p', offset: '00000000' });
    expect(mappings[0]?.path).toMatch(/\/usr\/bin\//);
  });

  it('reads the accounting fields under it', () => {
    const first = mappings[0]!;

    expect(field(first, 'Size')).toBe(8);
    expect(field(first, 'Rss')).toBe(8);
    expect(field(first, 'Pss')).toBe(8);
    expect(field(first, 'nonsense')).toBeNull();
    expect(first.fields.find((entry) => entry.name === 'Size')?.unit).toBe('kB');
  });

  /** A flag and a key rather than an amount of memory. */
  it('keeps the fields that are not memory apart from the ones that are', () => {
    expect(isMemoryField('Rss')).toBe(true);
    expect(isMemoryField('THPeligible')).toBe(false);
    expect(isMemoryField('KernelPageSize')).toBe(false);
    expect(field(mappings[0]!, 'THPeligible')).toBe(0);
  });

  it('reads the VmFlags codes', () => {
    expect(mappings[0]?.flags).toEqual(['rd', 'mr', 'mw', 'me', 'sd']);
    expect(describeFlag('rd')).toBe('Readable');
    expect(describeFlag('gd')).toMatch(/grows downwards/);
    expect(describeFlag('zz')).toBeNull();
  });

  it('reads the permissions off the header', () => {
    const stack = find(mappings, /^\[stack\]$/);

    expect(stack.perms).toBe('rw-p');
    expect(isWritable(stack)).toBe(true);
    expect(isExecutable(stack)).toBe(false);
    expect(isShared(stack)).toBe(false);
    expect(isWritableExecutable(stack)).toBe(false);
  });

  it('says what each mapping is', () => {
    expect(kindOf(find(mappings, /^\[heap\]$/))).toBe('heap');
    expect(kindOf(find(mappings, /^\[stack\]$/))).toBe('stack');
    expect(kindOf(find(mappings, /^\[vdso\]$/))).toBe('special');
    expect(kindOf(find(mappings, /libc\.so/))).toBe('file');
    expect(labelOf(find(mappings, /libc\.so/))).toMatch(/^libc\.so/);
  });

  it('reads an anonymous mapping nobody named', () => {
    const anon = mappings.find((mapping) => mapping.path === '')!;

    expect(kindOf(anon)).toBe('anon');
    expect(labelOf(anon)).toBe('anonymous');
  });

  /** Rss is the sum of the four Shared/Private, Clean/Dirty fields. */
  it('finds Rss to be the sum of its four parts, on every mapping', () => {
    expect(RSS_PARTS).toHaveLength(4);
    for (const mapping of mappings) {
      expect(rssParts(mapping).agree, `${mapping.path} does not add up`).toBe(true);
    }
    expect(summarize(mappings).inconsistent).toEqual([]);
  });

  it('summarizes what the process costs', () => {
    const summary = summarize(mappings);

    expect(summary).toMatchObject({ mappings: 38, sizeKib: 5788, rssKib: 2008, pssKib: 233 });
    // Nearly all of a shell's resident memory is library text shared with
    // everything else running.
    expect(summary.sharedShare).toBeCloseTo(0.884, 3);
  });

  /**
   * Real data, and the clearest demonstration of the difference: libc is
   * mapped by every process on the machine, so nearly a megabyte resident is
   * charged to this one as a few kilobytes.
   */
  it('charges a library shared machine-wide at a fraction of its size', () => {
    const text = segment(mappings, /libc\.so/, 'r-xp');

    expect(field(text, 'Rss')).toBe(864);
    expect(field(text, 'Pss')).toBe(7);
    expect(field(text, 'Private_Clean')).toBe(0);
    expect(sharedShare(text)).toBeGreaterThan(0.99);
  });

  it('groups the mappings by what they are', () => {
    const kinds = byKind(mappings).map((entry) => entry.kind);

    expect(kinds).toContain('file');
    expect(kinds).toContain('anon');
    expect(byKind(mappings)[0]?.pssKib).toBeGreaterThan(0);
  });

  it('describes the fields worth explaining', () => {
    expect(describeField('Pss')).toMatch(/counted fairly/);
    expect(describeField('Private_Dirty')).toMatch(/swap out/i);
    expect(describeField('Nonsense')).toBeNull();
  });
});

describe('parseSmaps — a browser tab', () => {
  const mappings = parseSmaps(fixture('desktop', '12282'));

  /**
   * The number this file exists for: the same pages counted whole and counted
   * fairly, on a binary several processes have mapped.
   */
  it('reads Pss well below Rss where the pages are shared', () => {
    const text = mappings.find(
      (mapping) => mapping.perms === 'r-xp' && /chromium-browser\/chrome$/.test(mapping.path),
    )!;

    expect(field(text, 'Rss')).toBe(107588);
    expect(field(text, 'Pss')).toBe(57403);
    expect(sharedShare(text)).toBeCloseTo(0.466, 3);
  });

  /** Size is address space, and a reservation holds a great deal of it. */
  it('finds the address space claimed with nothing in it', () => {
    const summary = summarize(mappings);

    expect(summary.reservations.length).toBe(4);
    expect(summary.reservations.every((mapping) => mapping.perms === '---p')).toBe(true);
    // 52 GiB claimed against 235 MiB resident.
    expect(summary.sizeKib).toBeGreaterThan(50 * 1024 * 1024);
    expect(summary.rssKib).toBeLessThan(300 * 1024);
  });

  /** An allocator can name its own anonymous memory through prctl. */
  it('reads a named anonymous mapping', () => {
    const named = find(mappings, /^\[anon:partition_alloc\]$/);

    expect(kindOf(named)).toBe('named-anon');
    expect(labelOf(named)).toBe('[anon:partition_alloc]');
  });

  it('sorts the mappings by what they proportionally cost', () => {
    const largest = summarize(mappings).largest;

    expect(field(largest[0]!, 'Pss')).toBe(57403);
    expect(field(largest[0]!, 'Pss')!).toBeGreaterThanOrEqual(field(largest[1]!, 'Pss')!);
  });
});

describe('parseSmaps — two copies of one daemon', () => {
  const first = parseSmaps(fixture('shared-pair', 'self'));
  const second = parseSmaps(fixture('shared-pair', '901'));

  /**
   * The executable's own text is mapped by both copies, so each is charged
   * half of it — where in the single-process capture it was private.
   */
  it('charges each copy half of the binary they both map', () => {
    const own = first.filter(
      (mapping) =>
        /\/usr\/bin\/cat$/.test(mapping.path) && (field(mapping, 'Shared_Clean') ?? 0) > 0,
    );

    expect(own).toHaveLength(3);
    for (const mapping of own) {
      expect(field(mapping, 'Private_Clean'), mapping.path).toBe(0);
      expect(field(mapping, 'Pss'), mapping.path).toBe(Math.round(field(mapping, 'Rss')! / 2));
      expect(sharedShare(mapping), mapping.path).toBeCloseTo(0.5, 1);
    }
  });

  /**
   * Only the pages neither copy has written to. The relro segment is read-only
   * but dirtied as the loader finishes with it, and the writable data segment
   * is copy-on-write, so both stay private however many copies are running.
   */
  it('leaves the segments each copy has written to private', () => {
    const dirty = first.filter(
      (mapping) =>
        /\/usr\/bin\/cat$/.test(mapping.path) && (field(mapping, 'Private_Dirty') ?? 0) > 0,
    );

    expect(dirty.length).toBeGreaterThan(0);
    for (const mapping of dirty) {
      expect(field(mapping, 'Shared_Clean'), mapping.path).toBe(0);
      expect(field(mapping, 'Pss'), mapping.path).toBe(field(mapping, 'Rss'));
    }
  });

  it('charges the process less overall than when it ran alone', () => {
    expect(summarize(first).pssKib).toBeLessThan(
      summarize(parseSmaps(fixture('desktop', 'self'))).pssKib,
    );
    // The pages are still all there; only the share of them has changed.
    expect(summarize(first).rssKib).toBe(summarize(parseSmaps(fixture('desktop', 'self'))).rssKib);
  });

  it('reads the same file for either process', () => {
    expect(summarize(first).pssKib).toBe(summarize(second).pssKib);
  });
});

describe('parseSmaps — a process pushed out to swap', () => {
  const mappings = parseSmaps(fixture('swapped', 'self'));

  it('reads what has been written out, and what it is worth proportionally', () => {
    const summary = summarize(mappings);

    expect(summary.swapKib).toBe(94);
    expect(summary.swapPssKib).toBe(94);
    // Swapped pages are no longer resident, so Rss has fallen with them.
    expect(summary.rssKib).toBeLessThan(summarize(parseSmaps(fixture('desktop', 'self'))).rssKib);
  });

  it('leaves the file-backed mappings alone', () => {
    const lib = find(mappings, /libc\.so/);

    expect(field(lib, 'Swap')).toBe(0);
  });
});

describe('parseSmaps — a runtime that writes code and runs it', () => {
  const mappings = parseSmaps(fixture('jit-wx', 'self'));

  /** Writable and executable at once: what a JIT needs, and an exploit too. */
  it('finds the mapping that is both writable and executable', () => {
    const summary = summarize(mappings);

    expect(summary.writableExecutable).toHaveLength(1);
    expect(summary.writableExecutable[0]?.perms).toBe('rwxp');
    expect(labelOf(summary.writableExecutable[0]!)).toBe('[anon:jit-code]');
    expect(summary.writableExecutable[0]?.flags).toEqual(
      expect.arrayContaining(['wr', 'ex']),
    );
  });

  it('finds none on a process that has no such mapping', () => {
    expect(summarize(parseSmaps(fixture('desktop', 'self'))).writableExecutable).toEqual([]);
  });
});

describe('parseSmaps — the awkward files', () => {
  it('reads an empty file as no mappings at all', () => {
    expect(parseSmaps('')).toEqual([]);
    expect(summarize([])).toMatchObject({ mappings: 0, rssKib: 0, sharedShare: null });
  });

  it('ignores lines before the first mapping', () => {
    expect(parseSmaps('Size: 4 kB\nnonsense\n')).toEqual([]);
  });

  it('reads CRLF line endings', () => {
    const mappings = parseSmaps(
      '00400000-00401000 r-xp 00000000 08:02 42 /bin/true\r\nSize:  4 kB\r\n',
    );

    expect(mappings[0]?.path).toBe('/bin/true');
    expect(field(mappings[0]!, 'Size')).toBe(4);
  });

  /** A mapping with no file behind it prints nothing in the last column. */
  it('reads a header with no path on the end', () => {
    const mappings = parseSmaps('7f0000000000-7f0000001000 rw-p 00000000 00:00 0 \nRss: 4 kB\n');

    expect(mappings[0]).toMatchObject({ path: '', inode: 0, dev: '00:00' });
    expect(kindOf(mappings[0]!)).toBe('anon');
  });

  it('reads a path with spaces in it', () => {
    const mappings = parseSmaps(
      '7f00-7f01 r--s 00000000 08:02 12 /home/me/Safe Browsing/Url.store\nRss: 4 kB\n',
    );

    expect(mappings[0]?.path).toBe('/home/me/Safe Browsing/Url.store');
    expect(labelOf(mappings[0]!)).toBe('Url.store');
    expect(isShared(mappings[0]!)).toBe(true);
  });

  it('does not call a small empty mapping a reservation', () => {
    const small = parseSmaps('7f00-7f01 ---p 0 00:00 0 \nSize: 4 kB\nRss: 0 kB\n')[0]!;
    const large = parseSmaps('7f00-7f01 ---p 0 00:00 0 \nSize: 65536 kB\nRss: 0 kB\n')[0]!;

    expect(isReservation(small)).toBe(false);
    expect(isReservation(large)).toBe(true);
  });

  it('does not divide by a mapping that is not resident', () => {
    const empty = parseSmaps('7f00-7f01 ---p 0 00:00 0 \nSize: 4 kB\nRss: 0 kB\nPss: 0 kB\n')[0]!;

    expect(sharedShare(empty)).toBeNull();
  });

  it('notices four parts that do not add up to Rss', () => {
    const mappings = parseSmaps(
      [
        '7f00-7f01 rw-p 0 00:00 0 ',
        'Rss:                  16 kB',
        'Shared_Clean:          0 kB',
        'Shared_Dirty:          0 kB',
        'Private_Clean:         0 kB',
        'Private_Dirty:         4 kB',
      ].join('\n'),
    );

    expect(rssParts(mappings[0]!)).toEqual({ parts: 4, rss: 16, agree: false });
    expect(summarize(mappings).inconsistent).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('reads a kB figure as the KiB it is', () => {
    expect(formatKib(0)).toBe('0');
    expect(formatKib(8)).toBe('8 KiB');
    expect(formatKib(2008)).toBe('2.0 MiB');
    expect(formatKib(107588)).toBe('105 MiB');
    expect(formatKib(54801948)).toBe('52 GiB');
  });

  it('rounds a share, keeping a trace apart from nothing', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(0.0001)).toBe('<1%');
    expect(formatShare(0.466)).toBe('47%');
    expect(formatShare(1)).toBe('100%');
  });
});
