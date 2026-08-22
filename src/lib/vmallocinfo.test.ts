import { describe, expect, it } from 'vitest';
import { readVmallocInfoFixture as fixture } from '../test/fixtures';
import {
  addressesZeroed,
  byCaller,
  byFlag,
  callerSymbol,
  describeFlag,
  formatAddress,
  formatBytes,
  gaps,
  guardBytes,
  hasGuardPage,
  PAGE_SIZE,
  parseVmallocInfo,
  summarize,
} from './vmallocinfo';

describe('parseVmallocInfo — an ordinary desktop', () => {
  const entries = parseVmallocInfo(fixture('desktop'));

  it('reads the range, the size and the caller', () => {
    expect(entries).toHaveLength(21);
    expect(entries[0]).toMatchObject({
      start: 0xffffc90000000000n,
      end: 0xffffc90000005000n,
      sizeBytes: 20480,
      caller: 'pcpu_get_vm_areas+0x0/0x9c0',
      pages: null,
      phys: null,
      flags: ['vmalloc'],
    });
  });

  /** A device mapping has a physical address and no pages behind it. */
  it('reads an ioremap as the device mapping it is', () => {
    const acpi = entries[1]!;

    expect(acpi).toMatchObject({
      caller: 'acpi_os_map_iomem+0x175/0x1b0',
      phys: '0x00000000fed00000',
      pages: null,
      flags: ['ioremap'],
    });
    expect(guardBytes(acpi)).toBeNull();
  });

  /**
   * The kernel reserves an unmapped guard page past the end, so the size and
   * the pages behind it differ by exactly one page.
   */
  it('reads the size as one page larger than the pages backing it', () => {
    const bpf = entries.find((entry) => entry.caller?.startsWith('bpf_prog_alloc'))!;

    expect(bpf.pages).toBe(1);
    expect(bpf.sizeBytes).toBe(8192);
    expect(guardBytes(bpf)).toBe(PAGE_SIZE);
    expect(hasGuardPage(bpf)).toBe(true);
  });

  /** Unless the caller asked for VM_NO_GUARD, in which case they agree. */
  it('reads an allocation with no guard page', () => {
    const pcpu = entries.find((entry) => entry.caller?.startsWith('pcpu_mem_zalloc'))!;

    expect(pcpu.pages).toBe(64);
    expect(pcpu.sizeBytes).toBe(64 * PAGE_SIZE);
    expect(guardBytes(pcpu)).toBe(0);
    expect(hasGuardPage(pcpu)).toBe(false);
  });

  /** %pS prints the module after the symbol when it is not built in. */
  it('reads the module a caller lives in', () => {
    const drm = entries.find((entry) => entry.module !== null)!;

    expect(drm).toMatchObject({
      caller: 'nv_drm_load+0x1c4/0x3e0',
      module: 'nvidia_drm',
      pages: 12,
    });
  });

  /** A vm_map_ram area has no vm_struct, so it prints no caller at all. */
  it('reads a vm_map_ram area with nothing but a range and a size', () => {
    const mapRam = entries.find((entry) => entry.flags.includes('vm_map_ram'))!;

    expect(mapRam).toMatchObject({ caller: null, pages: null, phys: null, sizeBytes: 8192 });
  });

  it('reads the flags an entry carries', () => {
    const fb = entries.find((entry) => entry.flags.includes('vpages'))!;

    expect(fb.flags).toEqual(['vmalloc', 'vpages']);
    expect(fb.pages).toBe(2048);
    expect(describeFlag('vpages')).toMatch(/too large to kmalloc/);
    expect(describeFlag('nonsense')).toBeNull();
  });

  it('adds the mappings up by the caller that asked for them', () => {
    const callers = byCaller(entries);

    // Three separate module loads, added together.
    const loadModule = callers.find((caller) => caller.symbol === 'load_module')!;
    expect(loadModule).toMatchObject({ entries: 3, pages: 15 + 7 + 23 });
    expect(loadModule.bytes).toBe(65536 + 32768 + 98304);
    // Largest first, so the biggest holder leads.
    expect(callers[0]?.symbol).toBe('drm_fbdev_generic_setup');
  });

  it('adds them up by flag as well', () => {
    const flags = byFlag(entries).map((entry) => entry.flag);

    expect(flags).toContain('ioremap');
    expect(flags).toContain('vmalloc');
    expect(flags[0]).toBe('vmalloc');
  });

  it('summarizes the file', () => {
    const summary = summarize(entries);

    expect(summary).toMatchObject({ entries: 21, addressesZeroed: false });
    expect(summary.mappedBytes).toBe(13248 * 1024);
    expect(summary.largest?.caller).toBe('drm_fbdev_generic_setup+0x74/0x1a0');
    expect(summary.nodes).toEqual([]);
  });

  /** Guard pages are real address space, and worth their own figure. */
  it('counts what the guard pages cost', () => {
    const guarded = entries.filter(hasGuardPage);

    expect(summarize(entries).guardBytes).toBe(guarded.length * PAGE_SIZE);
    expect(guarded.length).toBeGreaterThan(5);
  });

  it('finds the holes between the mappings', () => {
    const holes = gaps(entries);
    const summary = summarize(entries);

    expect(holes.length).toBeGreaterThan(0);
    expect(summary.largestGap?.bytes).toBe(4194304);
    expect(summary.spanBytes).toBe(Number(entries.at(-1)!.end - entries[0]!.start));
    expect(summary.freeInSpanBytes).toBe(summary.spanBytes! - summary.mappedBytes);
  });
});

describe('parseVmallocInfo — a two-node server', () => {
  const entries = parseVmallocInfo(fixture('numa-2node'));

  it('reads which node each mapping’s pages came from', () => {
    const hash = entries.find((entry) => entry.caller?.startsWith('alloc_large_system_hash'))!;

    expect(hash.numa).toEqual([
      { node: 0, pages: 1024 },
      { node: 1, pages: 1024 },
    ]);
    expect(hash.pages).toBe(2048);
  });

  it('reads a mapping that came off one node only', () => {
    const numa = entries.find((entry) => entry.caller?.startsWith('sched_init_numa'))!;

    expect(numa.numa).toEqual([{ node: 1, pages: 16 }]);
  });

  it('names the nodes the file mentions', () => {
    expect(summarize(entries).nodes).toEqual([0, 1]);
  });

  /** A device mapping has no pages, so it has no node either. */
  it('leaves a device mapping without a node', () => {
    const mlx = entries.find((entry) => entry.caller?.startsWith('mlx5'))!;

    expect(mlx.numa).toEqual([]);
    expect(mlx.phys).toBe('0x000038ffff000000');
  });
});

describe('parseVmallocInfo — a 32-bit kernel', () => {
  const entries = parseVmallocInfo(fixture('i386-fragmented'));

  it('reads the shorter addresses that kernel prints', () => {
    expect(entries[0]?.start).toBe(0xf8000000n);
    expect(formatAddress(entries[0]!.start, 8)).toBe('0xf8000000');
  });

  /**
   * The whole span is a hundred megabytes or so, where a 64-bit kernel has
   * terabytes — which is what made running out of it a real failure mode.
   */
  it('reads a span orders of magnitude smaller than a 64-bit one', () => {
    const summary = summarize(entries);

    expect(summary.spanBytes).toBeLessThan(128 * 1024 * 1024);
    expect(summary.largestGap!.bytes).toBeLessThan(summary.largest!.sizeBytes);
  });

  it('reads a 32-bit physical address', () => {
    const e1000 = entries.find((entry) => entry.caller?.startsWith('e1000'))!;

    expect(e1000.phys).toBe('0xf7d00000');
  });
});

describe('parseVmallocInfo — read under kptr_restrict', () => {
  const entries = parseVmallocInfo(fixture('restricted'));

  /** Every address zeroed, and everything else still readable. */
  it('reads the sizes and callers the zeroing leaves behind', () => {
    expect(entries).toHaveLength(5);
    expect(addressesZeroed(entries)).toBe(true);
    expect(entries[1]).toMatchObject({
      start: 0n,
      end: 0n,
      caller: 'load_module+0x8cd/0xb60',
      pages: 15,
      sizeBytes: 65536,
    });
  });

  /** With no layout there is nothing honest to say about the layout. */
  it('says nothing about a layout it cannot see', () => {
    const summary = summarize(entries);

    expect(gaps(entries)).toEqual([]);
    expect(summary.spanBytes).toBeNull();
    expect(summary.freeInSpanBytes).toBeNull();
    expect(summary.largestGap).toBeNull();
    // The accounting still works.
    expect(summary.mappedBytes).toBe(4423680);
    expect(summary.callers[0]?.symbol).toBe('alloc_large_system_hash');
  });

  it('is not claimed of a file whose addresses are real', () => {
    expect(addressesZeroed(parseVmallocInfo(fixture('desktop')))).toBe(false);
    expect(addressesZeroed([])).toBe(false);
  });
});

describe('parseVmallocInfo — the awkward files', () => {
  it('reads an empty file as no mappings at all', () => {
    expect(parseVmallocInfo('')).toEqual([]);
    expect(summarize([])).toMatchObject({ entries: 0, mappedBytes: 0, largest: null });
  });

  it('ignores a line that is not a mapping', () => {
    expect(parseVmallocInfo('nonsense\n')).toEqual([]);
  });

  it('reads CRLF line endings', () => {
    const entries = parseVmallocInfo('0xffffc90000000000-0xffffc90000005000 20480 foo+0x0/0x1 vmalloc\r\n');

    expect(entries[0]?.sizeBytes).toBe(20480);
    expect(entries[0]?.flags).toEqual(['vmalloc']);
  });

  /** An address past 2^53, which is why these are bigints and not numbers. */
  it('reads an address too large for a JavaScript number', () => {
    const entries = parseVmallocInfo('0xffffe8ffffc00000-0xffffe8ffffe00000 2097152 x+0x0/0x1 vmalloc');

    expect(entries[0]?.start).toBe(0xffffe8ffffc00000n);
    expect(Number(entries[0]!.start)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(entries[0]?.sizeBytes).toBe(2097152);
  });

  it('keeps a caller it does not recognise as flags or fields', () => {
    const entries = parseVmallocInfo('0x1000-0x2000 4096 some_new_thing+0x1/0x2 mystery_flag');

    expect(entries[0]?.caller).toBe('some_new_thing+0x1/0x2');
    expect(entries[0]?.flags).toEqual([]);
  });

  it('does not take a bracketed token for a module without a caller first', () => {
    const entries = parseVmallocInfo('0x1000-0x2000 4096 vm_map_ram');

    expect(entries[0]).toMatchObject({ caller: null, module: null, flags: ['vm_map_ram'] });
  });

  it('reads a mapping with no gap after it as no gap', () => {
    const entries = parseVmallocInfo(
      ['0x1000-0x2000 4096 a+0x0/0x1 vmalloc', '0x2000-0x3000 4096 b+0x0/0x1 vmalloc'].join('\n'),
    );

    expect(gaps(entries)).toEqual([]);
    expect(summarize(entries).largestGap).toBeNull();
  });
});

describe('callerSymbol', () => {
  it('strips the offset the kernel prints after the symbol', () => {
    expect(callerSymbol('load_module+0x8cd/0xb60')).toBe('load_module');
    expect(callerSymbol('pcpu_get_vm_areas+0x0/0x9c0')).toBe('pcpu_get_vm_areas');
    expect(callerSymbol('bare_symbol')).toBe('bare_symbol');
    expect(callerSymbol(null)).toBeNull();
  });
});

describe('formatting', () => {
  it('pads an address the way the file prints it', () => {
    expect(formatAddress(0xffffc90000000000n)).toBe('0xffffc90000000000');
    expect(formatAddress(0n)).toBe('0x0000000000000000');
    expect(formatAddress(0xf8000000n, 8)).toBe('0xf8000000');
  });

  it('reads a size in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(8192)).toBe('8.0 KiB');
    expect(formatBytes(4198400)).toBe('4.0 MiB');
    expect(formatBytes(16781312)).toBe('16 MiB');
  });
});
