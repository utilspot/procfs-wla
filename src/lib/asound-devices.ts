/**
 * Parser for `/proc/asound/devices`.
 *
 * Every character device ALSA has registered, printed by `snd_minor_info_read`
 * in `sound/core/sound.c`, which walks the `snd_minors[]` array and prints the
 * entries that are taken:
 *
 *     1:        : sequencer
 *     2: [ 0- 0]: digital audio playback
 *     3: [ 0- 0]: digital audio capture
 *     5: [ 0]   : control
 *    33:        : timer
 *
 * Three line shapes, decided by how much of a card the device belongs to:
 * `"%3i: [%2i-%2i]: %s\n"` for one belonging to a card *and* a device on it,
 * `"%3i: [%2i]   : %s\n"` for one belonging to a whole card, and
 * `"%3i:        : %s\n"` for one belonging to no card at all. The last is the
 * sequencer and the timer, which are the core's rather than any card's.
 *
 * **The number is a device minor**, and each line is one node under `/dev/snd`
 * on major 116 — so this file is the map from what ALSA registered to what a
 * program opens. See {@link nodeOf}, which builds the name back from the type
 * and the numbers.
 *
 * **What that minor means depends on how the kernel was built.** Without
 * `CONFIG_SND_DYNAMIC_MINORS` it is *computed*: `SNDRV_MINOR(card, dev)` is
 * `(card << 5) | dev`, and each type has a fixed offset in that block of 32 —
 * control at 0, compress at 2, hwdep at 4, rawmidi at 8, PCM playback at 16,
 * PCM capture at 24 — so the minor encodes the card and the type, and the block
 * sizes are hard ceilings: 8 PCM devices, 8 rawmidis and 4 hwdeps per card, and
 * 8 cards in the 256 minors ALSA has. With dynamic minors, which is what a
 * distribution ships, the type constants are a plain enum and minors come off a
 * free list in registration order — so they encode nothing, and a card that
 * arrives later takes the numbers after the last one rather than a block of its
 * own. {@link staticMinorOf} works out what a minor *would* have been, which is
 * how {@link minorScheme} tells the two builds apart from the file alone.
 *
 * **The two global minors are fixed either way**: `SNDRV_MINOR_SEQUENCER` is 1
 * and `SNDRV_MINOR_TIMER` is 33 — the second being the sequencer's slot in the
 * *second* card's block, which is why a static-minor machine's card 1 has its
 * control at 32 and nothing at 33.
 *
 * And **a substream is not a device**: a PCM device with eight substreams has
 * one node here, since substreams are opened through the same one. What has
 * how many is `/proc/asound/pcm`.
 */

/** The character major every one of these nodes is on, `CONFIG_SND_MAJOR`. */
export const SOUND_MAJOR = 116;

/** Minors in the array the printer walks, `SNDRV_OS_MINORS`. */
export const MINORS = 256;

/** Minors per card in the static scheme, `SNDRV_MINOR_DEVICES`. */
export const MINORS_PER_CARD = 32;

/** The two the core registers for itself, which no card owns. */
export const GLOBAL_MINORS: Readonly<Record<string, number>> = {
  sequencer: 1,
  timer: 33,
};

/** What each type the printer can name is, and what its node is called. */
export interface DeviceType {
  /** Where the type sits in a card's block of 32, in the static scheme. */
  staticBase: number | null;
  /** How the node under `/dev/snd` is named, with the numbers filled in. */
  node: (card: number, device: number) => string;
  note: string;
}

/**
 * The eight names `snd_device_type_name` can print. Anything else comes out as
 * `?`, which is a type this kernel has and this table does not.
 */
export const TYPES: Readonly<Record<string, DeviceType>> = {
  control: {
    staticBase: 0,
    node: (card) => `controlC${card}`,
    note: 'The card as a whole: mixer elements, and the events that say a jack was plugged in',
  },
  sequencer: {
    staticBase: 1,
    node: () => 'seq',
    note: "The MIDI sequencer, which belongs to the core rather than to a card — one node for the machine",
  },
  timer: {
    staticBase: 33,
    node: () => 'timer',
    note: 'The timer core, also the machine’s rather than a card’s — what /proc/asound/timers lists',
  },
  'hardware dependent': {
    staticBase: 4,
    node: (card, device) => `hwC${card}D${device}`,
    note: 'A driver-specific channel: firmware loading, DSP access, whatever the hardware alone offers',
  },
  'raw midi': {
    staticBase: 8,
    node: (card, device) => `midiC${card}D${device}`,
    note: 'A MIDI port as bytes, under the sequencer. A MIDI 2.0 endpoint is umpC…D… instead, and prints the same here',
  },
  'digital audio playback': {
    staticBase: 16,
    node: (card, device) => `pcmC${card}D${device}p`,
    note: 'One PCM device’s playback side. Its substreams share this node rather than taking one each',
  },
  'digital audio capture': {
    staticBase: 24,
    node: (card, device) => `pcmC${card}D${device}c`,
    note: 'One PCM device’s capture side, and the same again: substreams do not have nodes',
  },
  compress: {
    staticBase: 2,
    node: (card, device) => `comprC${card}D${device}`,
    note: 'A compressed-audio device, where the card decodes the stream itself rather than taking PCM',
  },
};

export interface SoundDevice {
  /** The device minor, which is what a node under `/dev/snd` is opened by. */
  minor: number;
  /** The card it belongs to, or null for one belonging to none. */
  card: number | null;
  /** The device on that card, or null for one belonging to the card whole. */
  device: number | null;
  /** The name `snd_device_type_name` printed, `?` for a type it has no name for. */
  type: string;
  raw: string;
}

export interface DevicesTable {
  devices: SoundDevice[];
}

/** `  2: [ 0- 0]: digital audio playback` */
const CARD_DEVICE = /^(\d+):\s*\[\s*(\d+)-\s*(\d+)\]\s*:\s*(.*)$/;
/** `  5: [ 0]   : control` */
const CARD_ONLY = /^(\d+):\s*\[\s*(\d+)\]\s*:\s*(.*)$/;
/** `  1:        : sequencer` */
const GLOBAL = /^(\d+):\s*:\s*(.*)$/;

/** Parses the file. A machine with no card still has the two global lines. */
export function parseDevices(text: string): DevicesTable {
  const devices: SoundDevice[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const device = parseDevice(trimmed, line.replace(/\s+$/, ''));
    if (device !== null) devices.push(device);
  }

  return { devices };
}

/** One line, in whichever of the three shapes it was printed. */
function parseDevice(line: string, raw: string): SoundDevice | null {
  const both = CARD_DEVICE.exec(line);
  if (both !== null) {
    return {
      minor: Number(both[1]),
      card: Number(both[2]),
      device: Number(both[3]),
      type: both[4]!.trim(),
      raw,
    };
  }

  const card = CARD_ONLY.exec(line);
  if (card !== null) {
    return {
      minor: Number(card[1]),
      card: Number(card[2]),
      device: null,
      type: card[3]!.trim(),
      raw,
    };
  }

  const global = GLOBAL.exec(line);
  if (global !== null) {
    return { minor: Number(global[1]), card: null, device: null, type: global[2]!.trim(), raw };
  }

  return null;
}

/** What this type is, or null for one this page has no entry for. */
export function describeType(type: string): DeviceType | null {
  return TYPES[type] ?? null;
}

/** Whether the device belongs to the core rather than to any card. */
export function isGlobal(device: SoundDevice): boolean {
  return device.card === null;
}

/**
 * The node under `/dev/snd` this line is about: `pcmC0D0p`, `controlC0`, `seq`.
 * Null for a type this page cannot name a node for, which is a `?` and nothing
 * else.
 */
export function nodeOf(device: SoundDevice): string | null {
  const type = describeType(device.type);
  if (type === null) return null;
  return type.node(device.card ?? 0, device.device ?? 0);
}

/** That node's full path, for a reader who wants to go and open it. */
export function pathOf(device: SoundDevice): string | null {
  const node = nodeOf(device);
  return node === null ? null : `/dev/snd/${node}`;
}

/**
 * The minor this device would have had in the static scheme — `(card << 5)`
 * plus the type's own offset in the block — or null where there is nothing to
 * compute: an unknown type, or one of the two globals, whose minors are fixed
 * at 1 and 33 in both schemes.
 */
export function staticMinorOf(device: SoundDevice): number | null {
  const type = describeType(device.type);
  if (type === null || type.staticBase === null) return null;
  if (isGlobal(device)) return GLOBAL_MINORS[device.type] ?? null;

  return ((device.card ?? 0) << 5) | (type.staticBase + (device.device ?? 0));
}

/** Which way this kernel hands out minors, as far as the file can say. */
export type MinorScheme =
  /** A minor is not the one the static formula gives, so they are allocated. */
  | 'dynamic'
  /** Every minor is what the formula gives — consistent with a static build. */
  | 'static'
  /** Nothing here to compute a minor for, so nothing to compare. */
  | 'unknown';

/**
 * Whether the minors were computed or handed out. A single minor that is not
 * where the static formula would put it settles it: that build computes them
 * all. Everything matching only says the file is *consistent* with a static
 * build — a dynamic one that happened to allocate in order looks the same, and
 * on a machine with one card it often does.
 */
export function minorScheme(table: DevicesTable): MinorScheme {
  let compared = false;

  for (const device of table.devices) {
    const expected = staticMinorOf(device);
    if (expected === null) continue;

    compared = true;
    if (expected !== device.minor) return 'dynamic';
  }

  return compared ? 'static' : 'unknown';
}

/** The cards with a node here, in the order the minors run. */
export function cardsOf(table: DevicesTable): number[] {
  const cards: number[] = [];

  for (const device of table.devices) {
    if (device.card !== null && !cards.includes(device.card)) cards.push(device.card);
  }

  return cards;
}

/** This card's nodes, which is what a card amounts to in `/dev`. */
export function devicesOfCard(table: DevicesTable, card: number): SoundDevice[] {
  return table.devices.filter((device) => device.card === card);
}

/** The nodes of one type, e.g. every PCM playback device on the machine. */
export function devicesOfType(table: DevicesTable, type: string): SoundDevice[] {
  return table.devices.filter((device) => device.type === type);
}

export interface DevicesSummary {
  devices: number;
  cards: number[];
  /** The core's own nodes, which are there whether or not a card is. */
  global: SoundDevice[];
  /** Types the printer named that this page has no entry for. */
  unknownTypes: string[];
  scheme: MinorScheme;
  highestMinor: number | null;
  /** PCM nodes, which are the ones a program plays through. */
  pcm: SoundDevice[];
}

export function summarize(table: DevicesTable): DevicesSummary {
  const unknownTypes: string[] = [];

  for (const device of table.devices) {
    if (describeType(device.type) === null && !unknownTypes.includes(device.type)) {
      unknownTypes.push(device.type);
    }
  }

  return {
    devices: table.devices.length,
    cards: cardsOf(table),
    global: table.devices.filter(isGlobal),
    unknownTypes,
    scheme: minorScheme(table),
    highestMinor:
      table.devices.length === 0
        ? null
        : table.devices.reduce((max, device) => Math.max(max, device.minor), 0),
    pcm: table.devices.filter((device) => device.type.startsWith('digital audio')),
  };
}
