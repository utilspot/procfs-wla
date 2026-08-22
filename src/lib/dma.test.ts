import { describe, expect, it } from 'vitest';
import { readDmaFixture as fixture } from '../test/fixtures';
import {
  CASCADE_CHANNEL,
  controllerOf,
  freeChannels,
  isCascade,
  ISA_CHANNELS,
  looksLikeIsa,
  parseDma,
  summarize,
  widthOf,
} from './dma';

describe('parseDma — an ordinary PC', () => {
  const info = parseDma(fixture('cascade-only'));

  /**
   * Only allocated channels are listed, so one line is the normal state of a
   * machine with no ISA cards — not a sign that something is missing.
   */
  it('reads the single allocated channel', () => {
    expect(info.supported).toBe(true);
    expect(info.channels).toEqual([{ channel: 4, device: 'cascade' }]);
  });

  // The cascade chains the second controller to the first and carries no data.
  it('knows the cascade is not a usable channel', () => {
    const summary = summarize(info);

    expect(isCascade(CASCADE_CHANNEL)).toBe(true);
    expect(summary.cascade?.device).toBe('cascade');
    expect(summary.inUse).toEqual([]);
    expect(summary.allocated).toBe(1);
  });

  it('works out which channels are free, since the file does not list them', () => {
    expect(freeChannels(info)).toEqual([0, 1, 2, 3, 5, 6, 7]);
    expect(freeChannels(info)).toHaveLength(ISA_CHANNELS - 1);
  });
});

describe('parseDma — an ISA sound card', () => {
  const info = parseDma(fixture('sound-card'));

  it('reads a channel on each controller', () => {
    expect(info.channels.map((entry) => entry.channel)).toEqual([1, 4, 5]);
    expect(info.channels[0]?.device).toBe('SoundBlaster8');
  });

  // 0–3 are the 8-bit controller, 4–7 the 16-bit one.
  it('knows which controller and width each channel belongs to', () => {
    expect(controllerOf(1)).toBe(1);
    expect(widthOf(1)).toBe(8);
    expect(controllerOf(5)).toBe(2);
    expect(widthOf(5)).toBe(16);
  });

  it('counts the cascade apart from the channels doing work', () => {
    const summary = summarize(info);

    expect(summary.allocated).toBe(3);
    expect(summary.inUse.map((entry) => entry.device)).toEqual([
      'SoundBlaster8',
      'SoundBlaster16',
    ]);
    expect(summary.free).toEqual([0, 2, 3, 6, 7]);
  });
});

describe('parseDma — every channel taken', () => {
  const info = parseDma(fixture('busy-legacy'));

  it('reads all eight channels', () => {
    expect(info.channels).toHaveLength(ISA_CHANNELS);
    expect(summarize(info).free).toEqual([]);
    expect(summarize(info).inUse).toHaveLength(7);
  });

  it('reads a device name containing digits', () => {
    expect(info.channels.find((entry) => entry.channel === 6)?.device).toBe('aha1542');
  });
});

describe('parseDma — an architecture with no ISA DMA', () => {
  const info = parseDma(fixture('no-isa-dma'));

  /**
   * `No DMA` means there is no controller at all, which is a different thing
   * from a controller with nothing allocated — and the page has to say so
   * rather than showing an empty table.
   */
  it('reads "No DMA" as unsupported rather than as an empty list', () => {
    expect(info.supported).toBe(false);
    expect(info.channels).toEqual([]);
  });

  it('claims nothing about the ISA layout when there is no controller', () => {
    expect(looksLikeIsa(info)).toBe(false);
    expect(freeChannels(info)).toEqual([]);
    expect(summarize(info)).toMatchObject({ supported: false, allocated: 0, isa: false });
  });
});

describe('parseDma — every fixture', () => {
  const names = ['cascade-only', 'sound-card', 'floppy-and-parport', 'busy-legacy', 'no-isa-dma'];

  it.each(names)('parses %s consistently', (name) => {
    const info = parseDma(fixture(name));
    const summary = summarize(info);

    for (const entry of info.channels) {
      expect(entry.device).not.toBe('');
      expect(Number.isInteger(entry.channel)).toBe(true);
      expect(entry.channel).toBeGreaterThanOrEqual(0);
    }

    // A channel is never listed twice.
    expect(new Set(info.channels.map((e) => e.channel)).size).toBe(info.channels.length);

    if (summary.isa) {
      // Allocated and free together account for all eight ISA channels.
      expect(summary.allocated + summary.free.length).toBe(ISA_CHANNELS);
      for (const channel of summary.free) {
        expect(info.channels.some((e) => e.channel === channel)).toBe(false);
      }
    } else {
      expect(summary.free).toEqual([]);
    }

    expect(summary.inUse.length + (summary.cascade ? 1 : 0)).toBe(summary.allocated);
  });
});

describe('parseDma — awkward input', () => {
  it('reads an empty file as a controller with nothing allocated', () => {
    const info = parseDma('');

    // Empty is not the same as "No DMA": the controller exists, nothing has it.
    expect(info.supported).toBe(true);
    expect(info.channels).toEqual([]);
    expect(freeChannels(info)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('returns nothing for a file that is not /proc/dma', () => {
    expect(parseDma('processor\t: 0\n').channels).toEqual([]);
  });

  it('accepts "No DMA" in any case', () => {
    expect(parseDma('no dma\n').supported).toBe(false);
    expect(parseDma('NO DMA\n').supported).toBe(false);
  });

  it('reads a device name containing spaces', () => {
    expect(parseDma(' 3: parallel port 0\n').channels[0]?.device).toBe('parallel port 0');
  });

  it('skips a channel with no device name', () => {
    expect(parseDma(' 4:\n').channels).toEqual([]);
    expect(parseDma(' 4:   \n').channels).toEqual([]);
  });

  // A channel outside 0-7 is some other controller, and nothing about 8237
  // cascading applies to it.
  it('makes no ISA claims about a channel outside the eight', () => {
    const info = parseDma(' 4: cascade\n12: someotherdma\n');

    expect(info.channels).toHaveLength(2);
    expect(looksLikeIsa(info)).toBe(false);
    expect(freeChannels(info)).toEqual([]);
    expect(controllerOf(12)).toBeNull();
    expect(widthOf(12)).toBeNull();
  });

  it('rejects a negative channel as outside the layout', () => {
    expect(controllerOf(-1)).toBeNull();
    expect(widthOf(-1)).toBeNull();
  });
});
