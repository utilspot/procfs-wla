import { describe, expect, it } from 'vitest';
import { readGpuLoadFixture, readGpuMemoryFixture as fixture } from '../test/fixtures';
import { parseGpuLoad } from './gpu_load';
import {
  accounted,
  byPages,
  bytes,
  formatBytes,
  formatShare,
  isThread,
  matchesDevice,
  PAGE_SIZE,
  parseGpuMemory,
  share,
  summarize,
  unaccounted,
} from './gpu_memory';

describe('parseGpuMemory — the capture the machine serves', () => {
  const memory = parseGpuMemory(fixture('raspberry-pi'));
  const rowFor = (tgid: number) => memory.processes.find((entry) => entry.tgid === tgid)!;

  it('reads the device line as the device rather than as a process', () => {
    expect(memory.device).toEqual({ name: 'mali0', pages: 40318 });
    expect(memory.processes).toHaveLength(4);
  });

  it('skips the line naming the columns', () => {
    expect(memory.processes.map((entry) => entry.tgid)).toEqual([19561, 11665, 11620, 8043]);
  });

  it('reads a row as its two ids and its page count', () => {
    expect(rowFor(11620)).toEqual({ tgid: 11620, pid: 11620, pages: 33459 });
  });

  /** The count is what the file holds; the size is that count at a page each. */
  it('turns the page counts into sizes at the page size it assumes', () => {
    expect(PAGE_SIZE).toBe(4096);
    expect(bytes(33459)).toBe(33459 * 4096);
    expect(formatBytes(bytes(33459))).toBe('131 MiB');
    expect(formatBytes(bytes(memory.device!.pages))).toBe('157 MiB');
  });

  /**
   * Unlike `/proc/gpu_load`, whose two counters are kept separately, here the
   * device line and the rows are the same accounting seen twice.
   */
  it('adds the rows up to exactly what the device says it holds', () => {
    expect(accounted(memory)).toBe(40318);
    expect(unaccounted(memory)).toBe(0);
    expect(matchesDevice(memory)).toBe(true);
  });

  it('works out each row’s share of what the device holds', () => {
    expect(share(rowFor(11620), memory.device!)).toBeCloseTo(33459 / 40318);
    expect(share(rowFor(11665), memory.device!)).toBeCloseTo(108 / 40318);
  });

  /** TGID is the process, PID the thread in it that opened the device. */
  it('tells a row belonging to a thread from one belonging to the process', () => {
    expect(isThread(rowFor(11665))).toBe(true);
    expect(isThread(rowFor(8043))).toBe(true);
    expect(isThread(rowFor(11620))).toBe(false);
  });

  it('ranks the rows by the memory each holds', () => {
    expect(byPages(memory).map((entry) => entry.tgid)).toEqual([11620, 19561, 8043, 11665]);
  });

  it('summarizes the rows and the processes behind them', () => {
    expect(summarize(memory)).toMatchObject({ rows: 4, processes: 4, threads: 2, pages: 40318 });
    expect(summarize(memory).largest?.tgid).toBe(11620);
  });

  /**
   * The two files this driver publishes are one machine seen twice, so the
   * processes holding memory are the ones holding a context — the driver's own
   * context aside, which holds no memory of its own here.
   */
  it('names the processes that hold a context in the same machine’s gpu_load', () => {
    const contexts = parseGpuLoad(readGpuLoadFixture('raspberry-pi')).contexts;
    const holding = contexts
      .filter((context) => context.tgid !== 0)
      .map((context) => `${context.tgid}/${context.pid}`)
      .sort();

    expect(memory.processes.map((entry) => `${entry.tgid}/${entry.pid}`).sort()).toEqual(holding);
  });
});

describe('parseGpuMemory — one process holding two rows', () => {
  const memory = parseGpuMemory(fixture('many-processes'));

  it('counts a process once however many threads of it hold memory', () => {
    expect(summarize(memory)).toMatchObject({ rows: 4, processes: 3, threads: 2 });
  });

  it('still adds up to the device line', () => {
    expect(matchesDevice(memory)).toBe(true);
    expect(accounted(memory)).toBe(128994);
  });
});

/** Pages the driver holds that no row claims: its own, or a process gone since. */
describe('parseGpuMemory — memory no row claims', () => {
  const memory = parseGpuMemory(fixture('unaccounted'));

  it('reports what the rows do not account for', () => {
    expect(accounted(memory)).toBe(13312);
    expect(unaccounted(memory)).toBe(20480 - 13312);
    expect(matchesDevice(memory)).toBe(false);
    expect(formatBytes(bytes(unaccounted(memory)!))).toBe('28 MiB');
  });

  /** Rows over the device line is what a file read mid-allocation can print. */
  it('reports rows claiming more than the device says as the negative it is', () => {
    const moving = parseGpuMemory('mali0 100\n  TGID PID PAGE_NUM\n1 1 80\n2 2 40\n');

    expect(unaccounted(moving)).toBe(-20);
    expect(matchesDevice(moving)).toBe(false);
  });
});

describe('parseGpuMemory — a driver holding nothing', () => {
  const memory = parseGpuMemory(fixture('no-processes'));

  it('reads a header with no process under it', () => {
    expect(memory.device).toEqual({ name: 'mali0', pages: 0 });
    expect(memory.processes).toEqual([]);
    expect(summarize(memory)).toMatchObject({ rows: 0, processes: 0, pages: 0, largest: null });
  });

  /** A share of nothing cannot be taken, and is not a zero. */
  it('has no share to give where the device holds nothing', () => {
    expect(share({ tgid: 1, pid: 1, pages: 0 }, memory.device!)).toBeNull();
    expect(unaccounted(memory)).toBe(0);
  });
});

describe('parseGpuMemory — what is not a file of this kind', () => {
  it('reads nothing out of an empty file', () => {
    expect(parseGpuMemory('')).toEqual({ device: null, processes: [] });
  });

  it('ignores a line that is neither the device, the header nor a row', () => {
    const memory = parseGpuMemory('mali0 10\nsomething else\n1 1 4\n');

    expect(memory.device?.pages).toBe(10);
    expect(memory.processes).toHaveLength(1);
  });

  it('drops a row that is not three numbers', () => {
    const memory = parseGpuMemory('mali0 10\n1 1\n2 2 6\n');

    expect(memory.processes.map((entry) => entry.tgid)).toEqual([2]);
  });

  it('keeps the first device line', () => {
    const memory = parseGpuMemory('mali0 10\nmali1 20\n');

    expect(memory.device).toEqual({ name: 'mali0', pages: 10 });
  });
});

describe('formatting', () => {
  it('shows a size in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(bytes(1))).toBe('4.0 KiB');
    expect(formatBytes(bytes(2158))).toBe('8.4 MiB');
  });

  it('shows a share that is not quite nothing as more than nothing', () => {
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(108 / 40318)).toBe('<1%');
    expect(formatShare(33459 / 40318)).toBe('83%');
  });
});
