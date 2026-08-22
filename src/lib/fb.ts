/**
 * Parser for `/proc/fb`.
 *
 * The registered framebuffer devices, one per line, written as `%d %s`:
 *
 *    0 inteldrmfb
 *    1 nouveaufb
 *
 * The number is the framebuffer's **node**, so it names `/dev/fb<node>` — not
 * the line's position. The name is the driver's `fix.id`, a 16-byte field, so
 * it is at most 15 characters and can contain spaces (`EFI VGA`,
 * `MATROX MGA-G400`).
 *
 * An empty file is the normal state of a machine that registered no
 * framebuffer — a headless server, or a kernel built without fbdev. DRM
 * devices still work through `/dev/dri` either way, since fbdev is only the
 * older interface.
 *
 * What registered a framebuffer is worth separating out, and the name is the
 * only thing the file gives to do it with:
 *
 *  - DRM's fbdev emulation writes `<driver>drmfb`, so that suffix means a
 *    modern DRM driver rather than a native fbdev one. See {@link isDrmFbdev}.
 *  - The generic framebuffers the firmware hands over are a known handful, and
 *    seeing only those means nothing has taken over yet. See
 *    {@link firmwareDriver}.
 *  - Anything else is a native fbdev driver, of which few remain.
 */

/** What DRM's fbdev emulation appends to the driver name in `fix.id`. */
export const DRM_SUFFIX = 'drmfb';

/**
 * DRM drivers whose `fix.id` does not carry {@link DRM_SUFFIX} because they
 * set the field themselves. Kept short deliberately: a name that is not on it
 * and does not end in `drmfb` is read as a native fbdev driver.
 */
const DRM_NAMES = new Set(['nouveaufb']);

/**
 * The generic framebuffers set up from what the firmware left running, and the
 * driver behind each. None of them drives the hardware: they write to a buffer
 * the firmware programmed, and a real driver is expected to replace them.
 */
export const FIRMWARE_DRIVERS: Readonly<Record<string, string>> = {
  'EFI VGA': 'efifb',
  'VESA VGA': 'vesafb',
  simple: 'simplefb',
  simpledrmdrmfb: 'simpledrm',
  'Open Firmware FB': 'offb',
};

export interface Framebuffer {
  /** The framebuffer's number, which is the `N` in `/dev/fbN`. */
  node: number;
  /** The driver's `fix.id`, at most 15 characters and possibly truncated. */
  name: string;
}

export interface FbInfo {
  framebuffers: Framebuffer[];
}

/** `0 inteldrmfb` — the node, then the rest of the line as the name. */
const LINE = /^(\d+)\s+(.*)$/;

export function parseFb(text: string): FbInfo {
  const framebuffers: Framebuffer[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const match = LINE.exec(trimmed);
    if (match === null) continue;

    const name = (match[2] ?? '').trim();
    if (name === '') continue;

    framebuffers.push({ node: Number(match[1]), name });
  }

  return { framebuffers };
}

/** The device node this framebuffer is reached through. */
export function deviceOf(framebuffer: Framebuffer): string {
  return `/dev/fb${framebuffer.node}`;
}

/**
 * Whether the name is DRM's fbdev emulation rather than a native fbdev driver
 * — the `drmfb` suffix `drm_fb_helper` writes, or one of the few DRM drivers
 * that name themselves.
 */
export function isDrmFbdev(framebuffer: Framebuffer): boolean {
  return framebuffer.name.endsWith(DRM_SUFFIX) || DRM_NAMES.has(framebuffer.name);
}

/**
 * The driver behind a generic firmware framebuffer, or null when the name is
 * not one of them. Nothing is guessed: a name has to be in the list.
 */
export function firmwareDriver(framebuffer: Framebuffer): string | null {
  return FIRMWARE_DRIVERS[framebuffer.name] ?? null;
}

export type FbKind = 'firmware' | 'drm' | 'fbdev';

/**
 * What put the framebuffer there. `firmware` wins over `drm`: some of the
 * generic ones are DRM drivers now, and that they are driving nothing but a
 * buffer the firmware left is the more useful of the two facts.
 */
export function kindOf(framebuffer: Framebuffer): FbKind {
  if (firmwareDriver(framebuffer) !== null) return 'firmware';
  return isDrmFbdev(framebuffer) ? 'drm' : 'fbdev';
}

export interface FbSummary {
  total: number;
  drm: Framebuffer[];
  firmware: Framebuffer[];
  fbdev: Framebuffer[];
  /**
   * True when there are framebuffers and every one of them is a firmware
   * handover, i.e. no driver has taken over the hardware.
   */
  firmwareOnly: boolean;
}

export function summarize(info: FbInfo): FbSummary {
  const of = (kind: FbKind) => info.framebuffers.filter((entry) => kindOf(entry) === kind);
  const firmware = of('firmware');

  return {
    total: info.framebuffers.length,
    drm: of('drm'),
    firmware,
    fbdev: of('fbdev'),
    firmwareOnly: info.framebuffers.length > 0 && firmware.length === info.framebuffers.length,
  };
}
