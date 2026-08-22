/**
 * Parser for `/proc/dma`.
 *
 * The ISA DMA channels currently allocated, one per line:
 *
 *    1: SoundBlaster8
 *    4: cascade
 *    5: SoundBlaster16
 *
 * The kernel writes `%2d: %s` per channel, and **only for channels that are
 * allocated** — a free channel is simply absent rather than listed as free.
 * That is why a working machine usually shows a single line: channel 4, the
 * cascade, which is allocated at boot and never released.
 *
 * On an architecture with no ISA DMA controller at all the file instead reads
 * `No DMA`, which is a statement rather than a channel list. See
 * {@link DmaInfo.supported}.
 *
 * The eight channels are two cascaded 8237 controllers: 0–3 move 8 bits at a
 * time, 4–7 move 16, and **channel 4 is the cascade that chains the second
 * controller to the first**, so it can never carry data itself. That layout is
 * the ISA one; an architecture with a different controller is not obliged to
 * match it, so it is only claimed when every channel in the file fits.
 */

/** Channels an ISA machine has, across the two cascaded controllers. */
export const ISA_CHANNELS = 8;

/** The channel that chains the second controller to the first. */
export const CASCADE_CHANNEL = 4;

export interface DmaChannel {
  channel: number;
  /** Driver that claimed it, as it registered itself. */
  device: string;
}

export interface DmaInfo {
  /**
   * False when the file reads `No DMA` — the architecture has no ISA DMA
   * controller, which is not the same as having one with nothing allocated.
   */
  supported: boolean;
  /** Allocated channels, in the order the kernel listed them. */
  channels: DmaChannel[];
}

/** ` 4: cascade` */
const LINE = /^(\d+):\s*(.*)$/;
/** What the kernel prints where there is no controller at all. */
const NO_DMA = /^no\s+dma$/i;

export function parseDma(text: string): DmaInfo {
  const channels: DmaChannel[] = [];
  let supported = true;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    if (NO_DMA.test(trimmed)) {
      supported = false;
      continue;
    }

    const match = LINE.exec(trimmed);
    if (match === null) continue;

    const device = (match[2] ?? '').trim();
    if (device === '') continue;

    channels.push({ channel: Number(match[1]), device });
  }

  return { supported, channels };
}

/** Which of the two cascaded controllers a channel belongs to, 1 or 2. */
export function controllerOf(channel: number): 1 | 2 | null {
  if (channel < 0 || channel >= ISA_CHANNELS) return null;
  return channel < 4 ? 1 : 2;
}

/** Bits a transfer on this channel moves at a time. */
export function widthOf(channel: number): 8 | 16 | null {
  const controller = controllerOf(channel);
  return controller === null ? null : controller === 1 ? 8 : 16;
}

/** Channel 4 chains the controllers together and cannot carry data. */
export function isCascade(channel: number): boolean {
  return channel === CASCADE_CHANNEL;
}

/**
 * Whether the file's channels all fit the ISA layout, so the eight-channel
 * picture can honestly be drawn. A channel outside 0–7 means some other
 * controller, and nothing about 8237 cascading applies.
 */
export function looksLikeIsa(info: DmaInfo): boolean {
  return (
    info.supported &&
    info.channels.every((entry) => entry.channel >= 0 && entry.channel < ISA_CHANNELS)
  );
}

/**
 * The ISA channels with nothing allocated. Only meaningful when the file fits
 * the ISA layout, so it is empty otherwise rather than invented.
 */
export function freeChannels(info: DmaInfo): number[] {
  if (!looksLikeIsa(info)) return [];

  const taken = new Set(info.channels.map((entry) => entry.channel));
  return Array.from({ length: ISA_CHANNELS }, (_, channel) => channel).filter(
    (channel) => !taken.has(channel),
  );
}

export interface DmaSummary {
  supported: boolean;
  allocated: number;
  free: number[];
  isa: boolean;
  /** Allocated channels that actually carry data, i.e. not the cascade. */
  inUse: DmaChannel[];
  cascade: DmaChannel | undefined;
}

export function summarize(info: DmaInfo): DmaSummary {
  return {
    supported: info.supported,
    allocated: info.channels.length,
    free: freeChannels(info),
    isa: looksLikeIsa(info),
    inUse: info.channels.filter((entry) => !isCascade(entry.channel)),
    cascade: info.channels.find((entry) => isCascade(entry.channel)),
  };
}
