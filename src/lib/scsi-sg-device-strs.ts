/**
 * Parser for `/proc/scsi/sg/device_strs`.
 *
 * The names of the devices `/proc/scsi/sg/devices` counts, a line each, printed
 * by `sg_proc_seq_show_devstrs` in `drivers/scsi/sg.c`:
 *
 *     VBOX    	CD-ROM          	1.0
 *     ATA     	VBOX HARDDISK   	1.0
 *
 * `"%8.8s\t%16.16s\t%4.4s\n"` over `scsidp->vendor`, `->model` and `->rev` — the
 * INQUIRY strings, in the widths INQUIRY gives them. The **precision** is doing
 * real work there. `struct scsi_device` declares those three as
 *
 *     const char * vendor;   [back_compat] point into 'inquiry' ...
 *     const char * model;    ... after scan; point to static string
 *     const char * rev;      ... "nullnullnullnull" before scan
 *
 * — three pointers into **one** buffer rather than three strings, and nothing
 * terminates them. `%8.8s` is what stops the vendor running on into the model.
 *
 * That declaration is also where {@link NULL_STRS} comes from: before a device
 * is scanned all three point at one static string, so a device caught in that
 * moment prints `nullnull`, `nullnullnullnull` and `null` — the same word cut
 * to the three widths. See {@link isUnscanned}.
 *
 * Two things this file shares with `devices` beside it. **Nothing here names
 * the device**: the driver walks its devices in index order, so the line's
 * position is the node, and line *n* of this file is line *n* of that one. See
 * {@link nodeOf}. And a device that has gone still takes its line — but where
 * `devices` prints nine `-1`s, this one prints {@link PLACEHOLDER} in words.
 * Same absence, two spellings, because the two files are printed by different
 * functions.
 *
 * Three files print these same three fields, each in its own way: this one in
 * fixed columns, `/proc/scsi/scsi` labelled and byte by byte, and
 * `/proc/scsi/device_info` quoted. The quoting there is what makes an empty
 * field visible; here it is the column widths, which never move.
 */

import { ATA_VENDOR } from './scsi';

/** What the driver prints where a device has gone, instead of its strings. */
export const PLACEHOLDER = '<no active device>';

/** The widths, which are INQUIRY's and are also the printf precision. */
export const VENDOR_WIDTH = 8;
export const MODEL_WIDTH = 16;
export const REV_WIDTH = 4;

/**
 * The static string all three pointers hold before a device is scanned, cut to
 * each field's width: `nullnull`, `nullnullnullnull`, `null`.
 */
export const NULL_STRS = 'nullnullnullnull';

export interface DeviceStrings {
  /** The sg index, which is the line's position and the minor of its node. */
  index: number;
  /** `scsidp->vendor`, 8 bytes of the INQUIRY response, trailing space cut off. */
  vendor: string;
  /** `scsidp->model`, 16 bytes. */
  model: string;
  /** `scsidp->rev`, 4 bytes. */
  rev: string;
  /** The three as printed, padding and all, which is what says a field was cut. */
  fields: { vendor: string; model: string; rev: string };
  /** Whether there is a device here at all. False for {@link PLACEHOLDER}. */
  present: boolean;
  /** The line as it was read. */
  raw: string;
}

export interface DeviceStringsTable {
  devices: DeviceStrings[];
  /** Lines that were neither three fields nor the placeholder. */
  unread: string[];
}

/** Where each field starts, if the tabs are where the widths put them. */
const MODEL_AT = VENDOR_WIDTH + 1;
const REV_AT = MODEL_AT + MODEL_WIDTH + 1;

const EMPTY = { vendor: '', model: '', rev: '' };

/**
 * Reads one line's three fields.
 *
 * By **tab** first, which is what separates them, and by column where a field
 * holds one — the widths are fixed and the tabs are at known offsets, so a
 * model with a tab byte in it is still sixteen bytes starting where sixteen
 * bytes start.
 */
function parseFields(line: string): { vendor: string; model: string; rev: string } | null {
  const parts = line.split('\t');

  if (parts.length === 3) {
    return { vendor: parts[0]!, model: parts[1]!, rev: parts[2]! };
  }

  if (line.length >= REV_AT && line[VENDOR_WIDTH] === '\t' && line[REV_AT - 1] === '\t') {
    return {
      vendor: line.slice(0, VENDOR_WIDTH),
      model: line.slice(MODEL_AT, MODEL_AT + MODEL_WIDTH),
      rev: line.slice(REV_AT, REV_AT + REV_WIDTH),
    };
  }

  return null;
}

/** Parses the file: a line per sg device, named only by where it sits. */
export function parseDeviceStrs(text: string): DeviceStringsTable {
  const devices: DeviceStrings[] = [];
  const unread: string[] = [];
  let index = 0;

  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const line = raw.replace(/\n$/, '');

    if (line.trim() === PLACEHOLDER) {
      devices.push({
        index,
        ...EMPTY,
        fields: { ...EMPTY },
        present: false,
        raw: line.replace(/\s+$/, ''),
      });
      index += 1;
      continue;
    }

    const fields = parseFields(line);
    if (fields === null) {
      unread.push(line.replace(/\s+$/, ''));
      continue;
    }

    devices.push({
      index,
      vendor: fields.vendor.trim(),
      model: fields.model.trim(),
      rev: fields.rev.trim(),
      fields,
      present: true,
      raw: line.replace(/\s+$/, ''),
    });
    index += 1;
  }

  return { devices, unread };
}

/**
 * The node this line is — `/dev/sg0` for the first, and the same line of
 * `/proc/scsi/sg/devices`. Nothing in either file says so; the order does.
 */
export function nodeOf(device: DeviceStrings): string {
  return `/dev/sg${device.index}`;
}

/** Whether the line is the placeholder rather than a device's strings. */
export function isAbsent(device: DeviceStrings): boolean {
  return !device.present;
}

/**
 * Whether the three fields are the static string the midlayer points them at
 * before a device is scanned, which is one word cut three ways.
 */
export function isUnscanned(device: DeviceStrings): boolean {
  return (
    device.present &&
    device.vendor === NULL_STRS.slice(0, VENDOR_WIDTH) &&
    device.model === NULL_STRS.slice(0, MODEL_WIDTH) &&
    device.rev === NULL_STRS.slice(0, REV_WIDTH)
  );
}

/** Whether this is a disk libata is answering for rather than a SCSI device. */
export function isAtaBridge(device: DeviceStrings): boolean {
  return device.vendor === ATA_VENDOR;
}

/** Whether a field fills its width, so what is printed may be the front of more. */
export function fillsField(value: string, width: number): boolean {
  return value.replace(/\s+$/, '').length >= width;
}

/** Whether the model fills its sixteen, which is where a long name is cut. */
export function isModelCut(device: DeviceStrings): boolean {
  return device.present && fillsField(device.fields.model, MODEL_WIDTH);
}

/** And the vendor, which has eight. */
export function isVendorCut(device: DeviceStrings): boolean {
  return device.present && fillsField(device.fields.vendor, VENDOR_WIDTH);
}

/** The three fields as one name, for a device that has them. */
export function describe(device: DeviceStrings): string | null {
  if (!device.present) return null;
  return [device.vendor, device.model, device.rev].filter((part) => part !== '').join(' ');
}

export interface DeviceStringsSummary {
  /** Lines, which is how many sg numbers the driver has handed out. */
  lines: number;
  present: DeviceStrings[];
  absent: DeviceStrings[];
  unscanned: DeviceStrings[];
  ata: DeviceStrings[];
  cut: DeviceStrings[];
  /** The distinct vendors named, in the order they first appear. */
  vendors: string[];
  unread: string[];
}

export function summarize(table: DeviceStringsTable): DeviceStringsSummary {
  const present = table.devices.filter((device) => device.present);
  const vendors: string[] = [];

  for (const device of present) {
    if (device.vendor !== '' && !vendors.includes(device.vendor)) vendors.push(device.vendor);
  }

  return {
    lines: table.devices.length,
    present,
    absent: table.devices.filter(isAbsent),
    unscanned: table.devices.filter(isUnscanned),
    ata: present.filter(isAtaBridge),
    cut: present.filter(isModelCut),
    vendors,
    unread: table.unread,
  };
}
