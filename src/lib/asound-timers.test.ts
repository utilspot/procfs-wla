import { describe, expect, it } from 'vitest';
import { readAsoundTimersFixture as fixture } from '../test/fixtures';
import {
  formatDuration,
  formatMicroseconds,
  globalTimer,
  hzOf,
  isConfigured,
  isSystemTimer,
  longestInterval,
  parseTimers,
  runningClients,
  substreamOf,
  summarize,
  type Timer,
} from './asound-timers';

/** The timer with this identifier, which is how the file names them. */
const find = (timers: Timer[], id: string): Timer => timers.find((timer) => timer.id === id)!;

describe('parseTimers — an ordinary desktop', () => {
  const table = parseTimers(fixture('desktop'));

  it('reads a line per timer and none for the clients under them', () => {
    expect(table.timers.map((timer) => timer.id)).toEqual([
      'G0',
      'G3',
      'P0-0-0',
      'P0-0-1',
      'P0-3-0',
      'P0-7-0',
    ]);
  });

  /** The letter is the class and the numbers are where the timer lives. */
  it('reads the identifier as coordinates rather than as an index', () => {
    expect(find(table.timers, 'G0')).toMatchObject({
      class: 'global',
      card: null,
      device: 0,
      subdevice: null,
    });
    expect(find(table.timers, 'P0-3-0')).toMatchObject({
      class: 'pcm',
      card: 0,
      device: 3,
      subdevice: 0,
    });
  });

  /** The resolution is nanoseconds, printed as microseconds and a remainder. */
  it('puts the microseconds and the remainder back together as nanoseconds', () => {
    expect(find(table.timers, 'G0').resolution).toBe(1_000_000);
    expect(find(table.timers, 'G3').resolution).toBe(1);
    expect(formatMicroseconds(1_000_000)).toBe('1000.000us');
    expect(formatMicroseconds(1)).toBe('0.001us');
  });

  /** Which makes the first line the one place CONFIG_HZ is written down. */
  it('reads the kernel tick off the system timer and nothing else', () => {
    expect(hzOf(find(table.timers, 'G0'))).toBe(1000);
    expect(hzOf(find(table.timers, 'G3'))).toBeNull();
    expect(isSystemTimer(find(table.timers, 'G0'))).toBe(true);
    expect(globalTimer(find(table.timers, 'G3'))?.name).toBe('HR timer');
  });

  /** `ticks` is a ceiling: the longest interval, not a count of anything. */
  it('multiplies the tick ceiling out into the interval it stands for', () => {
    expect(find(table.timers, 'G0').ticks).toBe(10_000_000);
    expect(longestInterval(find(table.timers, 'G0'))).toBe(10_000_000_000_000);
    expect(formatDuration(longestInterval(find(table.timers, 'G0'))!)).toBe('2 h 46 min');
  });

  it('reads the clients indented under the timer they have open', () => {
    expect(find(table.timers, 'G3').clients).toEqual([
      {
        owner: 'sequencer queue 0',
        running: false,
        raw: 'Client sequencer queue 0 : stopped',
      },
    ]);
    expect(find(table.timers, 'G0').clients).toEqual([]);
  });

  /** A resolution on a P line is the period of the stream configured on it. */
  it('tells a substream with a stream on it from one with none', () => {
    expect(isConfigured(find(table.timers, 'P0-0-0'))).toBe(true);
    expect(find(table.timers, 'P0-0-0').resolution).toBe(10_666_666);
    expect(formatDuration(10_666_666)).toBe('10.667 ms');

    expect(isConfigured(find(table.timers, 'P0-0-1'))).toBe(false);
    expect(find(table.timers, 'P0-0-1')).toMatchObject({ resolution: null, ticks: null });
  });

  /** Nothing here has a clock of its own except the two global timers. */
  it('reads the SLAVE flag off the end of the line', () => {
    expect(find(table.timers, 'P0-0-1').slave).toBe(true);
    expect(find(table.timers, 'G0').slave).toBe(false);
  });

  it('summarizes the machine as a tick, a stream and a client', () => {
    const summary = summarize(table);

    expect(summary).toMatchObject({
      timers: 6,
      tick: 1_000_000,
      hz: 1000,
      slaves: 4,
      cards: [0],
    });
    expect(summary.configured.map((timer) => timer.id)).toEqual(['P0-0-0']);
    expect(summary.clients).toHaveLength(1);
    expect(summary.running).toHaveLength(0);
  });
});

describe('parseTimers — the substream field', () => {
  const table = parseTimers(fixture('raspberry-pi'));

  /**
   * The third number packs the substream and the direction together, so the
   * playback substreams count in twos and nothing is missing between them.
   */
  it('unpacks the substream number and the direction from one field', () => {
    expect(table.timers.filter((timer) => timer.class === 'pcm').map((timer) => timer.subdevice)).toEqual([
      0, 2, 4, 6,
    ]);
    expect(substreamOf(find(table.timers, 'P0-0-4'))).toEqual({ index: 2, capture: false });
  });

  it('reads an odd field as capture and an even one as playback', () => {
    const desktop = parseTimers(fixture('desktop')).timers;

    expect(substreamOf(find(desktop, 'P0-0-1'))).toEqual({ index: 0, capture: true });
    expect(substreamOf(find(desktop, 'P0-0-0'))).toEqual({ index: 0, capture: false });
  });

  it('has no substream to read for a timer that is not a PCM one', () => {
    expect(substreamOf(find(table.timers, 'G0'))).toBeNull();
  });

  it('reads a 250 Hz kernel off the same first line', () => {
    expect(summarize(table)).toMatchObject({ tick: 4_000_000, hz: 250 });
  });
});

describe('parseTimers — a 2.6 kernel', () => {
  const table = parseTimers(fixture('legacy-2.6'));

  /** The RTC's periodic interrupt at 1024 Hz, which no modern kernel registers. */
  it('names the global timer the kernel has since dropped', () => {
    expect(find(table.timers, 'G1')).toMatchObject({ name: 'RTC timer', resolution: 976_562 });
    expect(globalTimer(find(table.timers, 'G1'))?.note).toMatch(/1024 Hz/);
  });

  it('reads a 100 Hz tick, which is what that era shipped', () => {
    expect(summarize(table)).toMatchObject({ tick: 10_000_000, hz: 100 });
  });

  it('reads a client that has started the timer', () => {
    expect(runningClients(table)).toEqual([
      { owner: 'application', running: true, raw: 'Client application : running' },
    ]);
  });

  /** The names were lower-cased back then, and nothing here depends on them. */
  it('reads the older spelling of a PCM timer name', () => {
    expect(find(table.timers, 'P0-0-1').name).toBe('PCM capture 0-0-1');
    expect(substreamOf(find(table.timers, 'P0-0-1'))).toEqual({ index: 0, capture: true });
  });
});

describe('parseTimers — a card with a timer of its own', () => {
  const table = parseTimers(fixture('card-timer'));

  it('reads a C line as a card and a device, with no substream', () => {
    expect(find(table.timers, 'C0-0')).toMatchObject({
      class: 'card',
      card: 0,
      device: 0,
      subdevice: null,
      name: 'EMU10K1 timer',
      resolution: 20_833,
      ticks: 1024,
      slave: false,
    });
  });

  it('counts the cards a timer belongs to', () => {
    expect(summarize(table).cards).toEqual([0]);
  });
});

describe('parseTimers — a machine with no card', () => {
  const table = parseTimers(fixture('no-cards'));

  /** Which is still two timers: the core registers its own as it comes up. */
  it('reads the global timers with nothing under them', () => {
    expect(table.timers.map((timer) => timer.id)).toEqual(['G0', 'G3']);
    expect(summarize(table)).toMatchObject({ timers: 2, cards: [], slaves: 0 });
    expect(summarize(table).configured).toEqual([]);
  });
});

describe('parseTimers — lines that are not the ordinary ones', () => {
  it('reads a timer that printed no resolution at all', () => {
    const table = parseTimers('G2: HPET :\n');

    expect(table.timers[0]).toMatchObject({
      id: 'G2',
      name: 'HPET',
      resolution: null,
      ticks: null,
      slave: false,
    });
    expect(globalTimer(table.timers[0]!)?.name).toBe('HPET');
  });

  /** The fallback branch of the printer, which names its class as a number. */
  it('reads the ? form as the class it could not name', () => {
    const table = parseTimers('?0--1-0-0: slave timer :\n');

    expect(table.timers[0]).toMatchObject({
      id: '?0--1-0-0',
      class: 'other',
      classNumber: 0,
      card: null,
      device: 0,
      subdevice: 0,
      name: 'slave timer',
    });
  });

  it('keeps a client under the timer above it rather than under the first', () => {
    const table = parseTimers(
      'G0: system timer : 1000.000us (10000000 ticks)\n' +
        'G3: HR timer : 0.001us (1000000000 ticks)\n' +
        '  Client unknown : running\n',
    );

    expect(table.timers[0]!.clients).toEqual([]);
    expect(table.timers[1]!.clients[0]).toMatchObject({ owner: 'unknown', running: true });
  });

  it('ignores a client line with no timer above it', () => {
    expect(parseTimers('  Client sequencer queue 0 : stopped\n').timers).toEqual([]);
  });

  it('reads a name that has numbers and spaces in it', () => {
    const table = parseTimers('P0-0-0: PCM Playback 0-0-0 : 21333.333us (1 ticks) SLAVE\n');

    expect(table.timers[0]).toMatchObject({
      name: 'PCM Playback 0-0-0',
      resolution: 21_333_333,
      ticks: 1,
      slave: true,
    });
  });

  it('reads no timers out of a file that is not this one', () => {
    expect(parseTimers('').timers).toEqual([]);
    expect(parseTimers('Advanced Linux Sound Architecture Driver Version k6.8.0.\n').timers).toEqual(
      [],
    );
  });
});

describe('formatDuration', () => {
  it('keeps a duration in the unit that reads', () => {
    expect(formatDuration(1)).toBe('1 ns');
    expect(formatDuration(20_833)).toBe('20.833 µs');
    expect(formatDuration(1_000_000)).toBe('1 ms');
    expect(formatDuration(1_333_333)).toBe('1.333 ms');
    expect(formatDuration(1_000_000_000)).toBe('1 s');
    expect(formatDuration(10_000_000_000_000)).toBe('2 h 46 min');
    expect(formatDuration(0)).toBe('0');
  });
});
