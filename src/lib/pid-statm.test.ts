import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPidStatmFixture as fixture } from '../test/fixtures';
import {
  anonymous,
  FIELDS,
  formatBytes,
  formatPages,
  formatShare,
  hasNoMm,
  impossible,
  isEmpty,
  isUnreadable,
  ofKind,
  PAGE_SIZE,
  parseStatm,
  residentShare,
  sharedShare,
  summarize,
  toBytes,
  UNUSED,
  unusedNotZero,
} from './pid-statm';

describe('parseStatm — a browser tab', () => {
  const statm = parseStatm(fixture('browser-tab'));

  it('reads the seven counts by position', () => {
    expect(statm.counts).toHaveLength(7);
    expect(statm).toMatchObject({
      size: 2857280,
      resident: 473086,
      shared: 226958,
      text: 33153,
      lib: 0,
      data: 721170,
      dt: 0,
    });
    expect(statm.complete).toBe(true);
    expect(statm.extra).toEqual([]);
    expect(statm.terminated).toBe(true);
  });

  /** The counts are pages, and the file never says how big a page is. */
  it('turns pages into bytes at a page size the file does not state', () => {
    expect(PAGE_SIZE).toBe(4096);
    expect(toBytes(statm.size)).toBe(2857280 * 4096);
    expect(formatBytes(toBytes(statm.size))).toBe('11 GiB');
    // Sixteen times as much on a 64 KiB-page kernel, from the same numbers.
    expect(toBytes(statm.size, 65536)).toBe(toBytes(statm.size) * 16);
  });

  /** The figure the file is usually opened for, and the one it does not carry. */
  it('works out the anonymous resident set, which is not a field', () => {
    expect(anonymous(statm)).toBe(473086 - 226958);
    expect(formatBytes(summarize(statm).anonymous)).toBe('961 MiB');
    expect(FIELDS.some((field) => field.name === 'anon')).toBe(false);
  });

  it('shares the resident set out against what is mapped', () => {
    expect(residentShare(statm)).toBeCloseTo(473086 / 2857280, 6);
    expect(sharedShare(statm)).toBeCloseTo(226958 / 473086, 6);
    expect(formatShare(residentShare(statm)!)).toBe('17%');
  });

  it('holds to the relationships one mm_struct always has', () => {
    expect(impossible(statm)).toEqual([]);
    expect(hasNoMm(statm)).toBe(false);
  });
});

/**
 * Two of the seven are not measurements. Saying so is most of what the page is
 * for, so it is checked rather than merely written down.
 */
describe('the two columns the kernel froze', () => {
  it('names field 5 and field 7 as constants rather than counts', () => {
    expect(UNUSED).toEqual(['lib', 'dt']);
    expect(FIELDS[4]).toMatchObject({ name: 'lib', column: 5, kind: 'unused' });
    expect(FIELDS[6]).toMatchObject({ name: 'dt', column: 7, kind: 'unused' });
  });

  it('is zero in every capture, because the kernel writes a constant', () => {
    for (const name of ['browser-tab', 'shell', 'sparse'] as const) {
      const statm = parseStatm(fixture(name));

      expect(statm.lib).toBe(0);
      expect(statm.dt).toBe(0);
      expect(unusedNotZero(statm)).toEqual([]);
    }
  });

  it('says so when something has put a number there anyway', () => {
    const statm = parseStatm('100 50 20 10 7 30 0\n');

    expect(unusedNotZero(statm).map((count) => count.field.name)).toEqual(['lib']);
  });
});

/** Three columns are address space and two are memory in RAM. */
describe('the two measurements', () => {
  const statm = parseStatm(fixture('browser-tab'));

  it('keeps what is mapped apart from what is resident', () => {
    expect(ofKind(statm, 'virtual').map((c) => c.field.name)).toEqual(['size', 'text', 'data']);
    expect(ofKind(statm, 'resident').map((c) => c.field.name)).toEqual(['resident', 'shared']);
    expect(ofKind(statm, 'unused').map((c) => c.field.name)).toEqual(['lib', 'dt']);
  });

  /** So text + data is not a part of resident, and does not make up size. */
  it('does not let the virtual columns add up to the first one', () => {
    expect(statm.text + statm.data).toBeLessThan(statm.size);
    expect(statm.text + statm.data).toBeGreaterThan(statm.resident);
  });

  it('names the status field each count matches, where there is one', () => {
    expect(FIELDS[0]!.status).toBe('VmSize');
    expect(FIELDS[2]!.status).toBe('RssFile + RssShmem');
    expect(FIELDS[5]!.status).toBe('VmData + VmStk');
    expect(FIELDS[4]!.status).toBeUndefined();
  });
});

describe('parseStatm — a database holding a shared segment', () => {
  const statm = parseStatm(fixture('shared-heavy', '4242'));

  it('reads a resident set that is nearly all file-backed', () => {
    expect(sharedShare(statm)!).toBeGreaterThan(0.9);
    expect(anonymous(statm)).toBe(264118 - 251204);
    // Which is the part that would have to swap rather than be dropped.
    expect(anonymous(statm)).toBeLessThan(statm.shared);
  });
});

describe('parseStatm — more mapped than ever touched', () => {
  const statm = parseStatm(fixture('sparse'));

  it('reads a large address space with almost nothing resident', () => {
    expect(residentShare(statm)!).toBeLessThan(0.001);
    expect(impossible(statm)).toEqual([]);
  });
});

/**
 * No `mm` to fill the counts in from — and this file prints zeroes where
 * `environ` and `coredump_filter` print nothing at all.
 */
describe('parseStatm — a kernel thread', () => {
  const statm = parseStatm(fixture('kernel-thread', '901'));

  it('reads seven zeroes as an answer rather than an empty file', () => {
    expect(hasNoMm(statm)).toBe(true);
    expect(isEmpty(statm)).toBe(false);
    expect(statm.counts).toHaveLength(7);
    expect(summarize(statm)).toMatchObject({ size: 0, resident: 0, anonymous: 0, noMm: true });
  });

  it('has no share to give rather than a share of zero', () => {
    expect(residentShare(statm)).toBeNull();
    expect(sharedShare(statm)).toBeNull();
  });
});

describe('parseStatm — what is not this file', () => {
  it('reads an empty file as empty rather than as seven zeroes', () => {
    const statm = parseStatm('');

    expect(isEmpty(statm)).toBe(true);
    expect(hasNoMm(statm)).toBe(false);
    expect(statm.bytes).toBe(0);
  });

  it('refuses a line that is not unsigned numbers', () => {
    const statm = parseStatm('not a statm line\n');

    expect(isUnreadable(statm)).toBe(true);
    expect(statm.counts).toEqual([]);
  });

  it('names a line short of the seven, and counts the rest as zero', () => {
    const statm = parseStatm('100 50 20\n');

    expect(statm.complete).toBe(false);
    expect(statm.counts).toHaveLength(3);
    expect(statm.data).toBe(0);
  });

  it('keeps numbers past the seventh out of the counts', () => {
    const statm = parseStatm('100 50 20 10 0 30 0 99\n');

    expect(statm.extra).toEqual([99]);
    expect(statm.counts).toHaveLength(7);
  });

  /** The resident set is part of the address space; its shared part of it. */
  it('names counts that cannot all be true at once', () => {
    expect(impossible(parseStatm('10 50 20 1 0 2 0\n'))).toContain(
      'more is resident than is mapped at all',
    );
    expect(impossible(parseStatm('100 20 50 1 0 2 0\n'))).toContain(
      'more of the resident set is shared than is resident',
    );
    // And the derived figure never goes negative on such a file.
    expect(anonymous(parseStatm('100 20 50 1 0 2 0\n'))).toBe(0);
  });

  it('notices a file with no trailing newline', () => {
    expect(parseStatm('100 50 20 10 0 30 0').terminated).toBe(false);
  });
});

describe('formatting', () => {
  it('shows a size, a page count and a share in the units each is in', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(toBytes(3543))).toBe('14 MiB');
    expect(formatPages(473086)).toBe('473,086');
    expect(formatShare(0.1656)).toBe('17%');
    expect(formatShare(0.0005)).toBe('<1%');
  });
});

/**
 * `statm` is the cheap view of the same `mm_struct` that `/proc/<pid>/status`
 * reads richly, so where a capture has both they have to agree — the captures
 * are generated from the status beside them, and this is what keeps them from
 * drifting apart the way two files edited separately would.
 */
describe('the machine captures, against the status beside them', () => {
  const root = resolve(process.cwd(), 'server/machines');
  const machines = ['container', 'desktop', 'raspberry-pi', 'server', 'vm'];
  const pids = ['1', '12282', 'self'];

  const pairs = machines.flatMap((machine) =>
    pids
      .map((pid) => ({ machine, pid, dir: resolve(root, machine, 'proc', pid) }))
      .filter((entry) => existsSync(resolve(entry.dir, 'status'))),
  );

  /** kB as `status` reports them, which is pages times four on these machines. */
  function statusKb(dir: string): Record<string, number> {
    const kb: Record<string, number> = {};
    for (const line of readFileSync(resolve(dir, 'status'), 'utf8').split('\n')) {
      const match = /^(Vm\w+|Rss\w+):\s+(\d+) kB$/.exec(line);
      if (match !== null) kb[match[1]!] = Number(match[2]);
    }
    return kb;
  }

  it('has a statm beside every per-process capture', () => {
    for (const machine of machines) {
      for (const pid of pids) {
        const path = resolve(root, machine, 'proc', pid, 'statm');
        expect(existsSync(path), `${machine}/${pid} has no statm`).toBe(true);
      }
    }
  });

  it.each(pairs)('$machine/$pid agrees with its own status', ({ dir }) => {
    const statm = parseStatm(readFileSync(resolve(dir, 'statm'), 'utf8'));
    const kb = statusKb(dir);
    const perPage = PAGE_SIZE / 1024;

    expect(statm.size).toBe(kb.VmSize! / perPage);
    expect(statm.resident).toBe(kb.VmRSS! / perPage);
    expect(statm.shared).toBe((kb.RssFile! + kb.RssShmem!) / perPage);
    expect(statm.text).toBe(kb.VmExe! / perPage);
    expect(statm.data).toBe((kb.VmData! + kb.VmStk!) / perPage);
  });

  /** RssAnon is the figure this file makes you derive; status states it. */
  it.each(pairs)('$machine/$pid derives the RssAnon status states', ({ dir }) => {
    const statm = parseStatm(readFileSync(resolve(dir, 'statm'), 'utf8'));
    const kb = statusKb(dir);

    expect(toBytes(anonymous(statm))).toBe(kb.RssAnon! * 1024);
  });

  it.each(
    machines.flatMap((machine) => pids.map((pid) => ({ machine, pid }))),
  )('$machine/$pid holds to what one mm_struct can say', ({ machine, pid }) => {
    const path = resolve(root, machine, 'proc', pid, 'statm');
    const statm = parseStatm(readFileSync(path, 'utf8'));

    expect(impossible(statm)).toEqual([]);
    expect(unusedNotZero(statm)).toEqual([]);
    expect(statm.complete).toBe(true);
  });
});
