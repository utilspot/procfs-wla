/**
 * Parser for `/proc/asound/pcm`.
 *
 * Every PCM device ALSA has registered, one to a line, printed by
 * `snd_pcm_proc_read` in `sound/core/pcm.c`:
 *
 *   00-00: ALC256 Analog : ALC256 Analog : playback 1 : capture 1
 *   00-03: HDMI 0 : HDMI 0 : playback 1
 *
 * The line is `"%02i-%02i: %s : %s"` over the card number, the device number,
 * `pcm->id` and `pcm->name`, and then a ` : playback %i` and a ` : capture %i`
 * — each printed **only if that stream has substreams at all**, which is why a
 * capture-only device has no playback field rather than a playback of 0.
 *
 * Five things about it read wrong at first glance.
 *
 * **The two names are two different fields.** `pcm->id` is what the driver
 * passed to `snd_pcm_new`, `pcm->name` is what it wrote into the device
 * afterwards, and they are 64 and 80 bytes of whatever their driver felt like:
 * often the same string, sometimes an id like `emu10k1` against a name like
 * `ADC Capture/Standard PCM Playback`. `aplay -l` prints both, the second in
 * brackets.
 *
 * **The counts are substreams, not channels.** `substream_count` is how many
 * streams can be open on that device at once — hardware mixing, or a driver
 * offering several independent buffers — and says nothing about how many
 * channels any one of them carries. A `playback 32` is an old sound card that
 * mixes 32 streams itself, not a 32-channel interface.
 *
 * **They are a capacity, not a usage.** `snd_pcm_str` carries `substream_opened`
 * right beside `substream_count`, and this file prints only the second: nothing
 * here says whether anything is playing. That is in
 * `/proc/asound/card0/pcm0p/sub0/status`, per substream.
 *
 * **The device number comes from the driver.** It is not an index into this
 * list and not a count: an HDA codec puts its analog device at 0 and its HDMI
 * ones at 3 and 7, so gaps are ordinary. What is guaranteed is that the pair is
 * unique and that the list is *sorted* by it — `snd_pcm_add` walks the list to
 * find its place and refuses a second PCM with the same card and device.
 *
 * And **not every PCM the kernel has is here**: one created as `internal` is
 * never added to the list, so this file is the devices userspace can open
 * rather than every PCM object in the machine.
 *
 * Each substream counted here is also one line in `/proc/asound/timers` —
 * `snd_pcm_dev_register` calls `snd_pcm_timer_init` for every one of them — so
 * {@link timerIdsOf} works out which `P` lines a device owns.
 */

/** What a device can do, from which of the two fields the kernel printed. */
export type Direction =
  /** Both, which is one device rather than two. */
  | 'duplex'
  | 'playback'
  | 'capture'
  /** Neither field printed: a PCM with no substreams on either stream. */
  | 'neither';

export interface PcmDevice {
  /** The pair as printed, zero-padded: `00-03`. */
  address: string;
  card: number;
  device: number;
  /** `pcm->id` — what the driver passed to `snd_pcm_new`. */
  id: string;
  /** `pcm->name` — the descriptive one it wrote afterwards. */
  name: string;
  /** Playback substreams, or null for the field the kernel left out entirely. */
  playback: number | null;
  capture: number | null;
  raw: string;
}

export interface PcmTable {
  devices: PcmDevice[];
}

/** `00-03: ` and everything after it. */
const LINE = /^(\d+)-(\d+):\s*(.*)$/;

/** The separator between the fields of the tail, which is ` : `. */
const SEPARATOR = ' : ';

/** ` : playback 1`, ` : capture 32` — the two optional fields on the end. */
const COUNT = /^(playback|capture)\s+(\d+)$/;

/**
 * Parses the file. An empty file parses to no devices, which is what a machine
 * with the sound core loaded and no card registered really prints.
 */
export function parsePcm(text: string): PcmTable {
  const devices: PcmDevice[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const device = parseDevice(trimmed);
    if (device !== null) devices.push(device);
  }

  return { devices };
}

/** One device's line, or null for a line that is not one. */
function parseDevice(line: string): PcmDevice | null {
  const match = LINE.exec(line);
  if (match === null) return null;

  const [, card = '', device = '', tail = ''] = match;
  const fields = tail.split(SEPARATOR);

  /*
   * The counts are the last fields, and there are at most two of them: the
   * kernel prints playback and then capture, each once. So they come off the
   * end in the reverse of that order and no further — a *name* ending in
   * something that reads like a count stays part of the name, which greedily
   * stripping every trailing match would eat.
   *
   * A name that is exactly `capture 1` on a device printing no counts is the
   * one case this cannot get right, and the file gives nothing to tell it
   * apart with.
   */
  const trailing = (stream: 'playback' | 'capture'): number | null => {
    if (fields.length <= 1) return null;

    const count = COUNT.exec(fields[fields.length - 1]!.trim());
    if (count === null || count[1] !== stream) return null;

    fields.pop();
    return Number(count[2]);
  };

  const capture = trailing('capture');
  const playback = trailing('playback');

  const [id = '', ...rest] = fields;

  return {
    // Printed with %02i, and kept as printed: the padding is the file's, and a
    // card past 99 simply gets wider.
    address: `${card}-${device}`,
    card: Number(card),
    device: Number(device),
    id: id.trim(),
    // A name the driver left with a ` : ` in it is still one name, so what is
    // left after the id is joined back rather than taken as more fields.
    name: rest.join(SEPARATOR).trim(),
    playback,
    capture,
    raw: line,
  };
}

/** What this device can do, from the fields that were printed. */
export function directionOf(device: PcmDevice): Direction {
  if (device.playback !== null && device.capture !== null) return 'duplex';
  if (device.playback !== null) return 'playback';
  return device.capture !== null ? 'capture' : 'neither';
}

/** Every substream on the device, both directions together. */
export function substreamsOf(device: PcmDevice): number {
  return (device.playback ?? 0) + (device.capture ?? 0);
}

/**
 * Whether this device can carry more than one stream in a direction at once,
 * which is the useful reading of the counts: a second `aplay` on a device with
 * one playback substream gets `EBUSY` unless something is mixing for it.
 */
export function opensAtOnce(device: PcmDevice): number {
  return Math.max(device.playback ?? 0, device.capture ?? 0);
}

/**
 * The `/proc/asound/timers` lines this device's substreams have, in the order
 * that file prints them. The subdevice field there packs the substream number
 * and the direction — `(number << 1) | (stream & 1)` — so a duplex device with
 * one substream each way owns `P0-0-0` and `P0-0-1`.
 */
export function timerIdsOf(device: PcmDevice): string[] {
  const ids: string[] = [];

  for (let index = 0; index < (device.playback ?? 0); index++) {
    ids.push(`P${device.card}-${device.device}-${index << 1}`);
  }
  for (let index = 0; index < (device.capture ?? 0); index++) {
    ids.push(`P${device.card}-${device.device}-${(index << 1) | 1}`);
  }

  return ids;
}

/** The cards with a device here, in the order the file lists them. */
export function cardsOf(table: PcmTable): number[] {
  const cards: number[] = [];

  for (const device of table.devices) {
    if (!cards.includes(device.card)) cards.push(device.card);
  }

  return cards;
}

/** This card's devices, which the file already has in device order. */
export function devicesOfCard(table: PcmTable, card: number): PcmDevice[] {
  return table.devices.filter((device) => device.card === card);
}

/**
 * Whether a card's device numbers skip — 0, 3, 7 rather than 0, 1, 2. They
 * come from the driver rather than from counting, so this is ordinary rather
 * than a device having gone missing, and worth saying so.
 */
export function hasGaps(table: PcmTable, card: number): boolean {
  const devices = devicesOfCard(table, card);
  if (devices.length === 0) return false;

  const last = devices[devices.length - 1]!;
  return last.device !== devices.length - 1;
}

export interface PcmSummary {
  devices: number;
  cards: number[];
  /** Devices that can play, whether or not they can also record. */
  playbackDevices: number;
  captureDevices: number;
  /** Substreams across every device, which is also the count of `P` timers. */
  playbackSubstreams: number;
  captureSubstreams: number;
  /** Devices carrying more than one stream at a time in either direction. */
  multiOpen: PcmDevice[];
  /** Cards whose device numbers skip, which is the driver's numbering showing. */
  gappedCards: number[];
}

export function summarize(table: PcmTable): PcmSummary {
  const cards = cardsOf(table);

  return {
    devices: table.devices.length,
    cards,
    playbackDevices: table.devices.filter((device) => device.playback !== null).length,
    captureDevices: table.devices.filter((device) => device.capture !== null).length,
    playbackSubstreams: total(table, 'playback'),
    captureSubstreams: total(table, 'capture'),
    multiOpen: table.devices.filter((device) => opensAtOnce(device) > 1),
    gappedCards: cards.filter((card) => hasGaps(table, card)),
  };
}

/** One stream's substreams across every device. */
function total(table: PcmTable, stream: 'playback' | 'capture'): number {
  return table.devices.reduce((sum, device) => sum + (device[stream] ?? 0), 0);
}
