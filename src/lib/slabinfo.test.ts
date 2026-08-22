import { describe, expect, it } from 'vitest';
import { readSlabInfoFixture as fixture } from '../test/fixtures';
import {
  activeBytes,
  bytes,
  formatBytes,
  isUnderused,
  PAGE_SIZE,
  parseSlabInfo,
  summarize,
  utilization,
} from './slabinfo';

describe('parseSlabInfo — an idle desktop', () => {
  const info = parseSlabInfo(fixture('desktop-slub'));

  it('reads the version and skips the column legend', () => {
    expect(info.version).toBe('2.1');
    expect(info.slabs).toHaveLength(20);
    expect(info.slabs.every((slab) => !slab.name.startsWith('#'))).toBe(true);
  });

  it('reads the six leading fields', () => {
    const dentry = info.slabs.find((slab) => slab.name === 'dentry')!;

    expect(dentry).toMatchObject({
      name: 'dentry',
      objSize: 192,
      objPerSlab: 21,
      pagesPerSlab: 1,
    });
    expect(dentry.numObjs).toBe(8720 * 21);
    expect(dentry.activeObjs).toBeLessThanOrEqual(dentry.numObjs);
  });

  it('reads both colon groups', () => {
    const dentry = info.slabs.find((slab) => slab.name === 'dentry')!;

    // SLUB prints the tunables group, but every value is zero.
    expect(dentry.tunables).toEqual({ limit: 0, batchCount: 0, sharedFactor: 0 });
    expect(dentry.slabData).toEqual({ activeSlabs: 8677, numSlabs: 8720, sharedAvail: 0 });
  });

  it('works out the memory a cache holds', () => {
    const dentry = info.slabs.find((slab) => slab.name === 'dentry')!;

    expect(bytes(dentry)).toBe(8720 * 1 * PAGE_SIZE);
    expect(activeBytes(dentry)).toBe(dentry.activeObjs * 192);
    // The objects in use never account for more than the cache holds.
    expect(activeBytes(dentry)).toBeLessThan(bytes(dentry));
  });

  it('reads a cache holding nothing', () => {
    const empty = info.slabs.find((slab) => slab.name === 'nf_conntrack')!;

    expect(empty).toMatchObject({ activeObjs: 0, numObjs: 0 });
    expect(bytes(empty)).toBe(0);
    expect(utilization(empty)).toBe(0);
    expect(summarize(info).empty).toBe(1);
  });

  it('summarizes and ranks the caches', () => {
    const summary = summarize(info);

    expect(summary.caches).toBe(20);
    expect(summary.totalBytes).toBe(112943104);
    expect(summary.largest.slice(0, 2).map((slab) => slab.name)).toEqual([
      'dentry',
      'ext4_inode_cache',
    ]);
    // The total is exactly the sum of the parts.
    expect(summary.totalBytes).toBe(
      info.slabs.reduce((sum, slab) => sum + bytes(slab), 0),
    );
  });

  it('has nothing underused when the caches are nearly full', () => {
    expect(info.slabs.filter(isUnderused)).toEqual([]);
  });
});

describe('parseSlabInfo — a SLAB server', () => {
  const info = parseSlabInfo(fixture('server-slab'));

  // SLUB writes zeroes here; the SLAB allocator writes the real thing.
  it('reads tunables that carry real values', () => {
    expect(info.slabs[0]?.tunables).toEqual({ limit: 120, batchCount: 60, sharedFactor: 8 });
    expect(info.slabs.every((slab) => slab.tunables?.limit === 120)).toBe(true);
  });

  it('adds up to hundreds of megabytes', () => {
    const summary = summarize(info);

    expect(summary.caches).toBe(17);
    expect(formatBytes(summary.totalBytes)).toBe('609 MiB');
    expect(summary.largest[0]?.name).toBe('ext4_inode_cache');
  });
});

describe('parseSlabInfo — a fragmented VM', () => {
  const info = parseSlabInfo(fixture('fragmented-vm'));

  it('holds far more memory than its objects use', () => {
    const summary = summarize(info);

    expect(summary.activeBytes / summary.totalBytes).toBeLessThan(0.2);
  });

  it('picks out the caches sitting on freed memory', () => {
    const underused = info.slabs.filter(isUnderused).map((slab) => slab.name);

    expect(underused).toContain('dentry');
    expect(underused).toContain('buffer_head');
    // A cache that is mostly used is not flagged, however big.
    expect(underused).not.toContain('vm_area_struct');
  });

  it('does not flag a small cache just because it is empty', () => {
    const empty = info.slabs.find((slab) => slab.name === 'kvm_async_pf')!;

    expect(empty.numObjs).toBe(0);
    expect(isUnderused(empty)).toBe(false);
  });
});

describe('parseSlabInfo — every fixture', () => {
  const names = ['desktop-slub', 'server-slab', 'container', 'fragmented-vm', 'arm-embedded'];

  it.each(names)('parses %s into consistent caches', (name) => {
    const info = parseSlabInfo(fixture(name));

    expect(info.version).toBe('2.1');
    expect(info.slabs.length).toBeGreaterThan(0);

    for (const slab of info.slabs) {
      expect(slab.name).not.toBe('');
      expect(slab.objSize).toBeGreaterThan(0);
      // The counts the kernel prints hold together: the objects a cache has
      // room for are its slabs times what fits in one.
      expect(slab.numObjs).toBe((slab.slabData?.numSlabs ?? 0) * slab.objPerSlab);
      expect(slab.activeObjs).toBeLessThanOrEqual(slab.numObjs);
      expect(slab.slabData!.activeSlabs).toBeLessThanOrEqual(slab.slabData!.numSlabs);
      // One slab's worth of objects fits in its pages.
      expect(slab.objPerSlab * slab.objSize).toBeLessThanOrEqual(slab.pagesPerSlab * PAGE_SIZE);
      expect(utilization(slab)).toBeGreaterThanOrEqual(0);
      expect(utilization(slab)).toBeLessThanOrEqual(1);
    }
  });
});

describe('parseSlabInfo — awkward input', () => {
  it('returns nothing for a file that is not slabinfo', () => {
    expect(parseSlabInfo('')).toEqual({ version: null, slabs: [] });
    expect(parseSlabInfo('processor\t: 0\n').slabs).toEqual([]);
  });

  it('reads a file with no version line', () => {
    const info = parseSlabInfo(
      'dentry 100 210 192 21 1 : tunables 0 0 0 : slabdata 5 10 0\n',
    );

    expect(info.version).toBeNull();
    expect(info.slabs).toHaveLength(1);
    expect(info.slabs[0]?.name).toBe('dentry');
  });

  it('reads a line that carries no colon groups at all', () => {
    const [slab] = parseSlabInfo('dentry 100 210 192 21 1\n').slabs;

    expect(slab).toMatchObject({ name: 'dentry', activeObjs: 100, numObjs: 210 });
    expect(slab?.tunables).toBeNull();
    expect(slab?.slabData).toBeNull();
    // With no slabdata there is no slab count, so no memory can be claimed.
    expect(bytes(slab!)).toBe(0);
  });

  it('skips a line with too few fields to be a cache', () => {
    const info = parseSlabInfo(
      'slabinfo - version: 2.1\ndentry 100 210\ninode_cache 1 2 632 12 2\n',
    );

    expect(info.slabs.map((slab) => slab.name)).toEqual(['inode_cache']);
  });

  it('reads the groups by their label rather than by position', () => {
    const [slab] = parseSlabInfo(
      'x 1 2 64 63 1 : slabdata 7 8 0 : tunables 120 60 8\n',
    ).slabs;

    expect(slab?.tunables).toEqual({ limit: 120, batchCount: 60, sharedFactor: 8 });
    expect(slab?.slabData).toEqual({ activeSlabs: 7, numSlabs: 8, sharedAvail: 0 });
  });

  it('reports no utilization for a cache with no objects, rather than dividing by zero', () => {
    expect(utilization(parseSlabInfo('x 0 0 8 1 1\n').slabs[0]!)).toBe(0);
  });
});

describe('formatBytes', () => {
  it('scales through the binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(10 * 1024)).toBe('10 KiB');
    expect(formatBytes(112943104)).toBe('108 MiB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GiB');
  });
});
