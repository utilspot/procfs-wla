/**
 * Parser for `/proc/asound/timers`.
 *
 * Every timer ALSA has registered, printed by `snd_timer_proc_read` in
 * `sound/core/timer.c` as a line each, with a line per client indented under
 * the timer that client has open:
 *
 *   G0: system timer : 1000.000us (10000000 ticks)
 *   G3: HR timer : 0.001us (1000000000 ticks)
 *     Client sequencer queue 0 : stopped
 *   P0-0-0: PCM Playback 0-0-0 : 10666.666us (1 ticks) SLAVE
 *   P0-0-1: PCM Capture 0-0-1 : SLAVE
 *
 * **The identifier on the left is coordinates, not an index.** The letter is
 * the timer's class and the numbers say where it lives:
 *
 * - `G<device>` — a global timer, the kernel's own rather than a card's. The
 *   device number is one of the `SNDRV_TIMER_GLOBAL_*` constants, so it names
 *   which timer this is; see {@link GLOBAL_TIMERS}.
 * - `C<card>-<device>` — a timer belonging to a card, ticking on that card's
 *   clock.
 * - `P<card>-<device>-<subdevice>` — the timer of one PCM substream.
 * - `?<class>-<card>-<device>-<subdevice>` — a class the printer has no letter
 *   for, which is the fallback branch of that `switch` rather than anything a
 *   working kernel produces.
 *
 * Four things about the rest of the line read wrong at first glance.
 *
 * **The resolution is nanoseconds.** `snd_timer_hardware.resolution` is "average
 * timer resolution for one tick in nsec", and the printing splits it —
 * `"%lu.%03luus"` over `resolution / 1000` and `resolution % 1000` — so the
 * three decimals are the nanosecond remainder and `0.001us` is one nanosecond.
 *
 * **The system timer's resolution is the kernel tick**, `1/CONFIG_HZ`, so this
 * file says what HZ the running kernel was built with: 1000.000us is a 1000 Hz
 * kernel and 10000.000us a 100 Hz one. See {@link hzOf}.
 *
 * **`ticks` is a ceiling, not a count.** `snd_timer_hardware.ticks` is "max
 * timer ticks per interrupt" — the longest interval the timer can be programmed
 * for, in units of its resolution — and nothing here counts anything that has
 * happened. See {@link longestInterval}.
 *
 * **The resolution is printed only when it is not zero**, so a line that ends
 * at its name or at `SLAVE` is a timer with no resolution to give rather than
 * one running at zero. For a PCM substream that is the ordinary state: its
 * resolution is the period time of whatever stream is configured on it —
 * `period_size * 10^9 / rate` nanoseconds, from `snd_pcm_timer_resolution_change`
 * — so an idle substream has none and a configured one shows the period the
 * stream negotiated.
 *
 * And the third number of a `P` line is **not a subdevice index**: the kernel
 * packs the substream number and the direction into it,
 * `(substream->number << 1) | (substream->stream & 1)`, so even is playback and
 * odd is capture, and the substream is that number shifted back down. See
 * {@link substreamOf}.
 */

/** Nanoseconds in a second, for reading a resolution as a rate. */
export const NS_PER_SECOND = 1_000_000_000;

/** What the numbers after the letter mean. */
export type TimerClass =
  /** `G` — the kernel's own timers, which every machine with ALSA has. */
  | 'global'
  /** `C` — a timer on a sound card. */
  | 'card'
  /** `P` — one PCM substream's timer. */
  | 'pcm'
  /** `?` — a class the printer has no letter for. */
  | 'other';

/**
 * The global timers the kernel numbers, from the `SNDRV_TIMER_GLOBAL_*`
 * constants in `include/uapi/sound/asound.h`. The device number in a `G` line
 * is one of these, so it says which timer the line is about — and the name
 * beside it comes from the driver that registered it, which is why the two do
 * not always read alike.
 */
export const GLOBAL_TIMERS: Readonly<Record<number, { name: string; note: string }>> = {
  0: {
    name: 'system timer',
    note: 'The kernel tick. Its resolution is 1/CONFIG_HZ, which makes this the one line here that says how the kernel was built',
  },
  1: {
    name: 'RTC timer',
    note: 'The CMOS clock at 1024 Hz, driven by its periodic interrupt. SNDRV_TIMER_GLOBAL_RTC is marked unused in a modern kernel, so a line here dates the machine',
  },
  2: {
    name: 'HPET',
    note: 'The number an HPET-backed timer takes, on a kernel that registers one',
  },
  3: {
    name: 'HR timer',
    note: 'The kernel hrtimer, whose resolution is a single nanosecond — what the sequencer asks for when it can have it',
  },
};

/** One line of `Client <owner> : <running|stopped>` under a timer. */
export interface TimerClient {
  /** What the opener registered as its owner, or `unknown` for one that gave none. */
  owner: string;
  /** Whether the instance is started or running, which the kernel prints as one state. */
  running: boolean;
  raw: string;
}

export interface Timer {
  /** The identifier as printed, e.g. `P0-0-1`. */
  id: string;
  class: TimerClass;
  /** The class number, for a `?` line — the one shape that prints it. */
  classNumber: number | null;
  /** Card the timer belongs to, or null for a global one. */
  card: number | null;
  device: number;
  /** The packed substream and direction of a `P` line; null for the others. */
  subdevice: number | null;
  /** The name the driver gave the timer. */
  name: string;
  /** Resolution of one tick **in nanoseconds**, or null for one printing none. */
  resolution: number | null;
  /** Most ticks the timer can be programmed to count, which is a ceiling. */
  ticks: number | null;
  /** `SNDRV_TIMER_HW_SLAVE`: no clock of its own, so something else drives it. */
  slave: boolean;
  clients: TimerClient[];
  raw: string;
}

export interface TimerTable {
  timers: Timer[];
}

/** `G0: `, `C0-0: `, `P0-0-1: ` and the `?` fallback, with the rest behind. */
const GLOBAL = /^G(\d+):\s*(.*)$/;
const CARD = /^C(-?\d+)-(\d+):\s*(.*)$/;
const PCM = /^P(-?\d+)-(\d+)-(\d+):\s*(.*)$/;
const OTHER = /^\?(-?\d+)-(-?\d+)-(\d+)-(\d+):\s*(.*)$/;

/** `<name> :` and whatever the kernel had to add after it. */
const BODY = /^(.*) :(.*)$/;

/** ` 1000.000us (10000000 ticks)`, printed only for a resolution that is not 0. */
const RESOLUTION = /(\d+)\.(\d{3})us\s+\((\d+)\s+ticks\)/;

/** `  Client sequencer queue 0 : stopped` */
const CLIENT = /^Client\s+(.*)\s+:\s+(running|stopped)$/;

/** Parses the file. A file with no timers in it parses to no timers. */
export function parseTimers(text: string): TimerTable {
  const timers: Timer[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // A client belongs to the timer above it, and cannot come first: the
    // kernel prints it from inside the loop over that timer's open list.
    const client = CLIENT.exec(trimmed);
    if (client !== null) {
      timers[timers.length - 1]?.clients.push({
        owner: client[1]!.trim(),
        running: client[2] === 'running',
        raw: trimmed,
      });
      continue;
    }

    const timer = parseTimer(trimmed);
    if (timer !== null) timers.push(timer);
  }

  return { timers };
}

/** One timer's own line, or null for a line that is not one. */
function parseTimer(line: string): Timer | null {
  const global = GLOBAL.exec(line);
  if (global !== null) {
    return {
      id: `G${global[1]}`,
      class: 'global',
      classNumber: null,
      card: null,
      device: Number(global[1]),
      subdevice: null,
      ...parseBody(global[2]!),
      clients: [],
      raw: line,
    };
  }

  const card = CARD.exec(line);
  if (card !== null) {
    return {
      id: `C${card[1]}-${card[2]}`,
      class: 'card',
      classNumber: null,
      card: Number(card[1]),
      device: Number(card[2]),
      subdevice: null,
      ...parseBody(card[3]!),
      clients: [],
      raw: line,
    };
  }

  const pcm = PCM.exec(line);
  if (pcm !== null) {
    return {
      id: `P${pcm[1]}-${pcm[2]}-${pcm[3]}`,
      class: 'pcm',
      classNumber: null,
      card: Number(pcm[1]),
      device: Number(pcm[2]),
      subdevice: Number(pcm[3]),
      ...parseBody(pcm[4]!),
      clients: [],
      raw: line,
    };
  }

  const other = OTHER.exec(line);
  if (other !== null) {
    return {
      id: `?${other[1]}-${other[2]}-${other[3]}-${other[4]}`,
      class: 'other',
      classNumber: Number(other[1]),
      // The fallback prints -1 where a timer has no card, since it has one
      // format for both cases.
      card: Number(other[2]) < 0 ? null : Number(other[2]),
      device: Number(other[3]),
      subdevice: Number(other[4]),
      ...parseBody(other[5]!),
      clients: [],
      raw: line,
    };
  }

  return null;
}

/** The name, and the resolution and flags the kernel prints after it. */
function parseBody(body: string): Pick<Timer, 'name' | 'resolution' | 'ticks' | 'slave'> {
  const parts = BODY.exec(body);
  // Nothing else is printed between the identifier and the name, so a body
  // without the ` :` is a name and nothing else.
  if (parts === null) {
    return { name: body.trim(), resolution: null, ticks: null, slave: false };
  }

  const tail = parts[2]!;
  const resolution = RESOLUTION.exec(tail);

  return {
    name: parts[1]!.trim(),
    // The whole microsecond part and the nanosecond remainder the kernel split
    // it into, put back together as the nanoseconds it keeps.
    resolution: resolution === null ? null : Number(resolution[1]) * 1000 + Number(resolution[2]),
    ticks: resolution === null ? null : Number(resolution[3]),
    slave: /\bSLAVE\b/.test(tail),
  };
}

/** Whether this is the kernel tick — global device `SNDRV_TIMER_GLOBAL_SYSTEM`. */
export function isSystemTimer(timer: Timer): boolean {
  return timer.class === 'global' && timer.device === 0;
}

/** What a global timer's device number names, or null for one not listed. */
export function globalTimer(timer: Timer): { name: string; note: string } | null {
  return timer.class === 'global' ? (GLOBAL_TIMERS[timer.device] ?? null) : null;
}

/**
 * `CONFIG_HZ`, read off the system timer: its resolution is one tick, so the
 * ticks in a second are the rate the kernel was built at. Null for every other
 * timer, whose resolution says nothing about the kernel.
 */
export function hzOf(timer: Timer): number | null {
  if (!isSystemTimer(timer) || timer.resolution === null || timer.resolution === 0) return null;
  return Math.round(NS_PER_SECOND / timer.resolution);
}

/**
 * The longest interval this timer can be programmed for: its resolution times
 * the most ticks it will count, in nanoseconds. It is a capability of the
 * hardware rather than anything happening now.
 */
export function longestInterval(timer: Timer): number | null {
  if (timer.resolution === null || timer.ticks === null) return null;
  return timer.resolution * timer.ticks;
}

/**
 * The substream a `P` line is about: the kernel packs the substream number and
 * the direction into one field, so the number printed is not an index into
 * anything and two lines four apart can be substreams 0 and 2.
 */
export function substreamOf(timer: Timer): { index: number; capture: boolean } | null {
  if (timer.class !== 'pcm' || timer.subdevice === null) return null;
  return { index: timer.subdevice >> 1, capture: (timer.subdevice & 1) === 1 };
}

/**
 * Whether a PCM substream has a stream set up on it, which is exactly when it
 * has a resolution: that resolution is the period time the stream negotiated.
 */
export function isConfigured(timer: Timer): boolean {
  return timer.class === 'pcm' && timer.resolution !== null;
}

/** Every client with the timer started or running, across the file. */
export function runningClients(table: TimerTable): TimerClient[] {
  return table.timers.flatMap((timer) => timer.clients.filter((client) => client.running));
}

/** A duration in nanoseconds, in the largest unit that keeps it readable. */
export function formatDuration(ns: number): string {
  if (ns === 0) return '0';
  if (ns < 1000) return `${trim(ns)} ns`;
  if (ns < 1_000_000) return `${trim(ns / 1000)} µs`;
  if (ns < NS_PER_SECOND) return `${trim(ns / 1_000_000)} ms`;
  if (ns < 60 * NS_PER_SECOND) return `${trim(ns / NS_PER_SECOND)} s`;

  const seconds = Math.round(ns / NS_PER_SECOND);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min ${seconds % 60} s`;
}

/** Three decimals at most, and none where the number does not need them. */
function trim(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** The resolution as the kernel printed it: microseconds to three places. */
export function formatMicroseconds(ns: number): string {
  return `${Math.floor(ns / 1000)}.${String(ns % 1000).padStart(3, '0')}us`;
}

export interface TimersSummary {
  timers: number;
  /** The kernel tick in nanoseconds, from the system timer. */
  tick: number | null;
  /** What that tick makes CONFIG_HZ. */
  hz: number | null;
  /** The substreams with a stream configured on them, so with a period to show. */
  configured: Timer[];
  /** Timers with no clock of their own. */
  slaves: number;
  /** Every client holding a timer open. */
  clients: TimerClient[];
  running: TimerClient[];
  /** The cards that have a timer here, in the order they were registered. */
  cards: number[];
}

export function summarize(table: TimerTable): TimersSummary {
  const system = table.timers.find(isSystemTimer);
  const clients = table.timers.flatMap((timer) => timer.clients);
  const cards: number[] = [];

  for (const timer of table.timers) {
    if (timer.card !== null && !cards.includes(timer.card)) cards.push(timer.card);
  }

  return {
    timers: table.timers.length,
    tick: system?.resolution ?? null,
    hz: system === undefined ? null : hzOf(system),
    configured: table.timers.filter(isConfigured),
    slaves: table.timers.filter((timer) => timer.slave).length,
    clients,
    running: clients.filter((client) => client.running),
    cards,
  };
}
