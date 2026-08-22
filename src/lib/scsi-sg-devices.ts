/**
 * Parser for `/proc/scsi/sg/devices`.
 *
 * A line per device the generic SCSI driver has a node for, nine tab-separated
 * numbers each, printed by `sg_proc_seq_show_dev` in `drivers/scsi/sg.c`:
 *
 *     0	0	0	0	5	1	1	0	1
 *     2	0	0	0	0	1	32	0	1
 *
 * The names are in the file beside it — `device_hdr` prints
 * `host chan id lun type opens qdepth busy online`, and nothing else — which is
 * the first thing to know: **this file has no header of its own**, so a reader
 * who has not read the other one is looking at nine bare numbers. See
 * {@link COLUMNS}.
 *
 * The second thing is what is *not* a column. **No number here names the sg
 * device**: the driver walks its devices in index order, so the first line is
 * `/dev/sg0`, the second `/dev/sg1`, and the position is the name. See
 * {@link nodeOf}. That is also why a device that has gone away still takes a
 * line — `-1` in all nine columns rather than a line removed — since dropping
 * it would renumber every device under it. See {@link isPlaceholder}.
 *
 * The third is that one column says nothing. `opens` promises a count and the
 * driver passes a **literal 1**: every device reads 1 whether or not anything
 * has it open. See {@link OPENS_IS_CONSTANT}.
 *
 * The rest are real. The first four are the address `/proc/scsi/scsi` prints in
 * words — host, channel, id, lun — and `type` is the peripheral device type as
 * a **number** where that file gives the name, which is the same
 * `scsi_device_types[]` entry read from the two ends: see `typeForCode` in
 * {@link ./scsi}. `qdepth` is how many commands the midlayer will keep in
 * flight for it, `busy` how many are in flight now — the one live number in the
 * file — and `online` is `scsi_device_online`, which is 0 for a device the
 * midlayer has stopped talking to but not yet forgotten.
 */

import { typeForCode, type DeviceType } from './scsi';

/** The names `device_hdr` prints, in the order this file's columns run. */
export const COLUMNS = [
  'host',
  'chan',
  'id',
  'lun',
  'type',
  'opens',
  'qdepth',
  'busy',
  'online',
] as const;

/** What the driver prints for a device that is gone, in every column. */
export const PLACEHOLDER = -1;

/** The one column whose value is a literal rather than a count. */
export const OPENS_IS_CONSTANT =
  'The driver passes a literal 1 where the header promises a count of opens, so every device ' +
  'reads 1 whether or not anything has its node open';

export interface SgDevice {
  /** The sg index, which is this line's position and the minor of its node. */
  index: number;
  host: number;
  channel: number;
  id: number;
  lun: number;
  /** The peripheral device type as a number — `/proc/scsi/scsi` names it. */
  type: number;
  /** `opens`, which is 1 for everything. See {@link OPENS_IS_CONSTANT}. */
  opens: number;
  /** Commands the midlayer will keep in flight for this device. */
  qdepth: number;
  /** Commands in flight when the file was read, which is the one live number. */
  busy: number;
  /** `scsi_device_online`: 0 for a device the midlayer has stopped talking to. */
  online: number;
  /** The line as it was read. */
  raw: string;
}

export interface SgDeviceTable {
  devices: SgDevice[];
  /** Lines that were not nine numbers, which a working driver does not print. */
  unread: string[];
}

/** Nine numbers, tab-separated — and `-1` nine times for a device that is gone. */
const LINE = /^-?\d+(?:\s+-?\d+){8}$/;

/** Parses the file: a line per sg device, in the order their indexes run. */
export function parseSgDevices(text: string): SgDeviceTable {
  const devices: SgDevice[] = [];
  const unread: string[] = [];
  let index = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    if (!LINE.test(line.trim())) {
      unread.push(line.replace(/\s+$/, ''));
      continue;
    }

    const fields = line.trim().split(/\s+/).map(Number);

    devices.push({
      // The position is the name: a line is the sg device of that index,
      // whether or not the device behind it is still there.
      index,
      host: fields[0]!,
      channel: fields[1]!,
      id: fields[2]!,
      lun: fields[3]!,
      type: fields[4]!,
      opens: fields[5]!,
      qdepth: fields[6]!,
      busy: fields[7]!,
      online: fields[8]!,
      raw: line.replace(/\s+$/, ''),
    });
    index += 1;
  }

  return { devices, unread };
}

/**
 * The node this line is: `/dev/sg0` for the first, `/dev/sg1` for the second.
 * Nothing in the file says so — the driver walks its devices in index order and
 * the position is what carries it.
 */
export function nodeOf(device: SgDevice): string {
  return `/dev/sg${device.index}`;
}

/**
 * Whether this is the `-1` line the driver prints for a device that has gone —
 * detaching, or already unhooked from the sg device it left behind. The line
 * stays so that everything below it keeps its number.
 */
export function isPlaceholder(device: SgDevice): boolean {
  return device.host === PLACEHOLDER && device.id === PLACEHOLDER && device.type === PLACEHOLDER;
}

/** The address the other SCSI pages print, from the four numbers here. */
export function addressOf(device: SgDevice): string | null {
  if (isPlaceholder(device)) return null;
  return `${device.host}:${device.channel}:${device.id}:${device.lun}`;
}

/** What the type number stands for, which this file gives as a number alone. */
export function typeOf(device: SgDevice): DeviceType | null {
  return isPlaceholder(device) ? null : typeForCode(device.type);
}

/** Whether the midlayer has stopped talking to it, which is not the same as gone. */
export function isOffline(device: SgDevice): boolean {
  return !isPlaceholder(device) && device.online === 0;
}

/** Whether anything is in flight for it at the moment the file was read. */
export function isBusy(device: SgDevice): boolean {
  return !isPlaceholder(device) && device.busy > 0;
}

/**
 * How full its queue is right now, as a fraction — `busy` against `qdepth`,
 * which is the only thing in the file that changes between two reads.
 */
export function queueUse(device: SgDevice): number | null {
  if (isPlaceholder(device) || device.qdepth <= 0) return null;
  return device.busy / device.qdepth;
}

export interface SgDevicesSummary {
  /** Lines, which is how many sg minors the driver has handed out. */
  lines: number;
  /** The devices still there, which is lines less the placeholders. */
  present: SgDevice[];
  placeholders: SgDevice[];
  offline: SgDevice[];
  busy: SgDevice[];
  /** Commands in flight across the whole file. */
  inFlight: number;
  /** The deepest queue any of them has. */
  deepestQueue: number | null;
  unread: string[];
}

export function summarize(table: SgDeviceTable): SgDevicesSummary {
  const present = table.devices.filter((device) => !isPlaceholder(device));

  return {
    lines: table.devices.length,
    present,
    placeholders: table.devices.filter(isPlaceholder),
    offline: table.devices.filter(isOffline),
    busy: table.devices.filter(isBusy),
    inFlight: present.reduce((total, device) => total + device.busy, 0),
    deepestQueue:
      present.length === 0 ? null : present.reduce((deepest, d) => Math.max(deepest, d.qdepth), 0),
    unread: table.unread,
  };
}
