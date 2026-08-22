/**
 * Parser for `/proc/scsi/scsi`.
 *
 * Every device the SCSI midlayer has attached, **three lines each**, printed by
 * `proc_print_scsidevice` in `drivers/scsi/scsi_proc.c`:
 *
 *     Attached devices:
 *     Host: scsi0 Channel: 00 Id: 00 Lun: 00
 *       Vendor: ATA      Model: Samsung SSD 860  Rev: 4B6Q
 *       Type:   Direct-Access                    ANSI  SCSI revision: 05
 *
 * The first line is the device's **address** — `Host: scsi%d Channel: %02d Id:
 * %02d Lun: %02llu` — which is the same four numbers sysfs names a device by
 * and `lsscsi` prints in brackets. See {@link addressOf}.
 *
 * The second is the INQUIRY response, and the reason this file is columns
 * rather than words: the kernel writes `sdev->vendor`, `sdev->model` and
 * `sdev->rev` **byte by byte**, {@link VENDOR_WIDTH}, {@link MODEL_WIDTH} and
 * {@link REV_WIDTH} of them, putting a space in for anything below `0x20`. So
 * the padding is the device's own — INQUIRY pads with spaces — the widths are
 * fixed, and a name too long for its field arrives cut rather than wrapped.
 * That is what {@link fillsField} reads: a value that fills its field may be
 * the front of a longer one. See {@link parseScsi}, which splits that line by
 * column rather than by label for the same reason.
 *
 * The third is the peripheral device type and the ANSI version. The type is the
 * *name* from `scsi_device_types[]` rather than the number it stands for —
 * {@link TYPES} carries the number back, along with what such a device is and
 * which driver takes it. The revision is printed as
 * `sdev->scsi_level - (sdev->scsi_level > 1)`, which undoes the `+1` the
 * midlayer added at scan time: what you read is the ANSI version byte the
 * device itself answered with, three bits of it, so 7 is the ceiling and
 * anything newer than SPC-5 still says 7. See {@link standardOf}.
 *
 * The `CCS` after it is the one exception. A SCSI-1 device that answers in the
 * Common Command Set format is counted a level above plain SCSI-1, and prints
 * `01 CCS` — the revision of the standard it claims, and the note that it
 * really does more than that standard says. See {@link ScsiDevice.ccs}.
 *
 * Two things about the file as a whole. The header is **always printed**, so a
 * machine with the SCSI stack loaded and nothing attached to it holds
 * `Attached devices:` and nothing else — an empty file here is a failed read
 * rather than an empty bus. See {@link HEADER}. And what is *not* in it is as
 * much of the point as what is: NVMe, virtio-blk and MMC are not SCSI, so a
 * machine whose only disk is one of those has an empty list and four disks all
 * the same.
 */

/** The line the kernel prints before the devices, whether or not there are any. */
export const HEADER = 'Attached devices:';

/** Bytes of each INQUIRY field the kernel prints, from `struct scsi_device`. */
export const VENDOR_WIDTH = 8;
export const MODEL_WIDTH = 16;
export const REV_WIDTH = 4;

/**
 * The vendor libata gives every disk it translates for, which is not the disk's
 * vendor: a SATA drive has no INQUIRY of its own, so `ata_scsiop_inq_std` makes
 * one up — `ATA` for the vendor, the first {@link MODEL_WIDTH} characters of the
 * ATA model string for the model, and the first {@link REV_WIDTH} of the
 * firmware revision. See {@link isAtaBridge}.
 */
export const ATA_VENDOR = 'ATA';

export interface ScsiDevice {
  /** `scsi%d` — the host, which is one controller port rather than one card. */
  host: number;
  /** The bus below it, which is a real bus only where a controller has several. */
  channel: number;
  /** The target on that bus: a SCSI id, or whatever the transport made up. */
  id: number;
  /** The logical unit inside the target, which is where one device becomes four. */
  lun: number;
  /** `sdev->vendor`, the 8 INQUIRY bytes with the padding taken off. */
  vendor: string;
  /** `sdev->model`, 16 bytes, cut rather than wrapped if the name is longer. */
  model: string;
  /** `sdev->rev`, 4 bytes — the firmware revision, which is rarely a number. */
  rev: string;
  /** Each field as printed, padding and all, which is what says one was cut. */
  fields: { vendor: string; model: string; rev: string };
  /** The type name the kernel printed, e.g. `Direct-Access`. See {@link TYPES}. */
  type: string;
  /** The ANSI version the device answered with, or null if the line had none. */
  revision: number | null;
  /** Whether the kernel appended `CCS`, which only a SCSI-1 device gets. */
  ccs: boolean;
  /** All three lines, as they were read. */
  raw: string;
}

export interface ScsiTable {
  devices: ScsiDevice[];
  /** Whether the `Attached devices:` line was there, which it always is. */
  header: boolean;
}

/** `Host: scsi0 Channel: 00 Id: 00 Lun: 00` */
const HOST_LINE = /^Host:\s+scsi(\d+)\s+Channel:\s+(\d+)\s+Id:\s+(\d+)\s+Lun:\s+(\d+)\s*$/;

/** `  Type:   Direct-Access                    ANSI  SCSI revision: 05` */
const TYPE_LINE = /^\s*Type:\s+(.*?)\s+ANSI\s+SCSI revision:\s*([0-9a-fA-F]+)(\s+CCS)?\s*$/;

/** The same line on a kernel that printed no revision after the type. */
const TYPE_ONLY = /^\s*Type:\s+(.*?)\s*$/;

/**
 * Where each INQUIRY field starts on the second line, counted off a live file.
 * `  Vendor: ` is ten characters, the labels between the fields are eight and
 * six, and the fields themselves are the widths above.
 */
const VENDOR_AT = 10;
const MODEL_LABEL = ' Model: ';
const MODEL_AT = VENDOR_AT + VENDOR_WIDTH + MODEL_LABEL.length;
const REV_LABEL = ' Rev: ';
const REV_AT = MODEL_AT + MODEL_WIDTH + REV_LABEL.length;

/** `  Vendor: ` and the labels after it, for the loose reading below. */
const VENDOR_LINE = /^\s*Vendor:\s?(.*?)\s+Model:\s?(.*?)\s+Rev:\s?(.*?)\s*$/;

interface Inquiry {
  vendor: string;
  model: string;
  rev: string;
  fields: { vendor: string; model: string; rev: string };
}

/**
 * Reads the INQUIRY line **by column** where the columns are where they should
 * be, and by label only where they are not.
 *
 * The kernel prints the three fields at fixed offsets, so the columns are the
 * truth and the labels are decoration — which matters because a model is 16
 * bytes of whatever the device answered with, and one holding the characters
 * ` Rev: ` would split a label reading in the wrong place while the columns
 * stay where they are. The loose reading is for a file that has been through
 * something that strips trailing spaces, or a kernel whose widths differ.
 */
function parseInquiry(line: string): Inquiry | null {
  if (
    line.startsWith('  Vendor: ') &&
    line.slice(VENDOR_AT + VENDOR_WIDTH, MODEL_AT) === MODEL_LABEL &&
    line.slice(MODEL_AT + MODEL_WIDTH, REV_AT) === REV_LABEL
  ) {
    const fields = {
      vendor: line.slice(VENDOR_AT, VENDOR_AT + VENDOR_WIDTH),
      model: line.slice(MODEL_AT, MODEL_AT + MODEL_WIDTH),
      rev: line.slice(REV_AT, REV_AT + REV_WIDTH),
    };

    return {
      vendor: fields.vendor.trim(),
      model: fields.model.trim(),
      rev: fields.rev.trim(),
      fields,
    };
  }

  const loose = VENDOR_LINE.exec(line);
  if (loose === null) return null;

  const vendor = loose[1]!.trim();
  const model = loose[2]!.trim();
  const rev = loose[3]!.trim();

  // Nothing here says how the fields were padded, so they are recorded as what
  // is left of them — which reads as a field that did not fill, and is the
  // honest answer when the padding is gone.
  return { vendor, model, rev, fields: { vendor, model, rev } };
}

/** Parses the file: a header, and three lines per device under it. */
export function parseScsi(text: string): ScsiTable {
  const devices: ScsiDevice[] = [];
  let header = false;
  let pending: ScsiDevice | null = null;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    if (line.trim() === HEADER) {
      header = true;
      continue;
    }

    const host = HOST_LINE.exec(line.trim());
    if (host !== null) {
      pending = {
        host: Number(host[1]),
        channel: Number(host[2]),
        id: Number(host[3]),
        lun: Number(host[4]),
        vendor: '',
        model: '',
        rev: '',
        fields: { vendor: '', model: '', rev: '' },
        type: '',
        revision: null,
        ccs: false,
        raw: line.replace(/\s+$/, ''),
      };
      devices.push(pending);
      continue;
    }

    // The other two lines belong to the address above them. A device is its
    // three lines together: without one to attach to, a stray line is not a
    // record and there is nothing to do with it.
    if (pending === null) continue;
    pending.raw = `${pending.raw}\n${line.replace(/\s+$/, '')}`;

    const inquiry = parseInquiry(line);
    if (inquiry !== null && pending.vendor === '' && pending.model === '') {
      pending.vendor = inquiry.vendor;
      pending.model = inquiry.model;
      pending.rev = inquiry.rev;
      pending.fields = inquiry.fields;
      continue;
    }

    const type = TYPE_LINE.exec(line);
    if (type !== null) {
      pending.type = type[1]!;
      pending.revision = Number.parseInt(type[2]!, 16);
      pending.ccs = type[3] !== undefined;
      continue;
    }

    const bare = TYPE_ONLY.exec(line);
    if (bare !== null && pending.type === '') pending.type = bare[1]!;
  }

  return { devices, header };
}

/**
 * Which of a device's three lines this record did not get.
 *
 * A device is its lines together, and the two below the address are the ones
 * that can go missing: a truncated read, a kernel printing a shape this parser
 * does not know, or a backend handing over something other than the file. The
 * page shows the raw lines when this is not empty, since a record nothing could
 * be read out of is still the file talking and the reader should see it.
 */
export function missingLines(device: ScsiDevice): ('inquiry' | 'type')[] {
  const missing: ('inquiry' | 'type')[] = [];

  if (device.vendor === '' && device.model === '' && device.rev === '') missing.push('inquiry');
  if (device.type === '') missing.push('type');

  return missing;
}

/**
 * The four numbers as one address: `0:0:0:0`, which is the name of the device's
 * directory in sysfs and what `lsscsi` prints in brackets. It is the only
 * handle the file gives — nothing here says which `/dev/sd*` a disk became,
 * which is the reading this address is for. See {@link sysfsPathOf}.
 */
export function addressOf(device: ScsiDevice): string {
  return `${device.host}:${device.channel}:${device.id}:${device.lun}`;
}

/** Where the same device is in sysfs, which is where the rest of it is. */
export function sysfsPathOf(device: ScsiDevice): string {
  return `/sys/class/scsi_device/${addressOf(device)}`;
}

/** Whether a field fills its column, so what is printed may be the front of more. */
export function fillsField(value: string, width: number): boolean {
  return value.length >= width;
}

/** Whether the model fills its 16 bytes, which is where a long name is cut. */
export function isModelCut(device: ScsiDevice): boolean {
  return fillsField(device.fields.model.replace(/\s+$/, ''), MODEL_WIDTH);
}

/** And the vendor, which has 8 and is where a long one loses its end. */
export function isVendorCut(device: ScsiDevice): boolean {
  return fillsField(device.fields.vendor.replace(/\s+$/, ''), VENDOR_WIDTH);
}

/**
 * Whether this is a disk libata is translating for rather than a SCSI device:
 * the vendor is `ATA` for every one of them, and the drive's own name is in the
 * model field instead.
 */
export function isAtaBridge(device: ScsiDevice): boolean {
  return device.vendor === ATA_VENDOR;
}

export interface DeviceType {
  /** The name as the kernel prints it, which is the only form in the file. */
  name: string;
  /** The peripheral device type it stands for, which the file does not print. */
  code: number | null;
  /** What a device of this type is. */
  what: string;
  /** The upper-level driver that binds it, or null where none does. */
  driver: string | null;
  /** The node that driver gives it, or null for a device with no node of its own. */
  node: string | null;
}

/**
 * `scsi_device_types[]`, which is the table the printed name comes out of, plus
 * the two names outside it and the one for a code the kernel has no name for.
 *
 * The **code** is the reason this table is here: the file prints the name and
 * not the number, and the number is what the SCSI standard, `lsscsi -t` and
 * every hardware datasheet talk in. The **driver** is the other half — which of
 * the upper-level drivers takes a device of this type, and so what it turns
 * into in `/dev`. A type with no driver is not a mistake: an enclosure or a
 * RAID controller is a real device the midlayer attached, reachable through the
 * generic driver, that no block or tape driver claims.
 */
export const TYPES: DeviceType[] = [
  {
    name: 'Direct-Access',
    code: 0x00,
    what: 'A disk. Almost everything here is one: SATA drives through libata, USB storage, SAS disks, virtio-scsi volumes',
    driver: 'sd',
    node: '/dev/sd*',
  },
  {
    name: 'Sequential-Access',
    code: 0x01,
    what: 'A tape drive, which is where the other half of the SCSI command set still lives',
    driver: 'st',
    node: '/dev/st*',
  },
  { name: 'Printer', code: 0x02, what: 'A SCSI printer', driver: null, node: null },
  {
    name: 'Processor',
    code: 0x03,
    what: 'A processor device — in practice an enclosure controller answering SAF-TE, or a scanner-era oddity',
    driver: null,
    node: null,
  },
  {
    name: 'WORM',
    code: 0x04,
    what: 'Write-once media, which the CD driver takes',
    driver: 'sr',
    node: '/dev/sr*',
  },
  {
    name: 'CD-ROM',
    code: 0x05,
    what: 'An optical drive of any kind — CD, DVD or BD, and whether or not it writes',
    driver: 'sr',
    node: '/dev/sr*',
  },
  { name: 'Scanner', code: 0x06, what: 'A SCSI scanner, driven from userspace', driver: null, node: null },
  {
    name: 'Optical Device',
    code: 0x07,
    what: 'Rewritable optical media addressed as blocks, e.g. a magneto-optical drive',
    driver: 'sd',
    node: '/dev/sd*',
  },
  {
    name: 'Medium Changer',
    code: 0x08,
    what: 'The robot in a tape library, which moves the media the tape drives read',
    driver: 'ch',
    node: '/dev/sch*',
  },
  { name: 'Communications', code: 0x09, what: 'A communications device', driver: null, node: null },
  {
    name: 'ASC IT8',
    code: 0x0a,
    what: 'A graphic arts pre-press device. Two codes share this name, 0x0a and 0x0b, so the name alone does not say which',
    driver: null,
    node: null,
  },
  {
    name: 'RAID',
    code: 0x0c,
    what: 'The controller itself, answering as a device so it can be talked to — it is not a volume and has no data on it',
    driver: null,
    node: null,
  },
  {
    name: 'Enclosure',
    code: 0x0d,
    what: 'An SES device: the backplane, reporting the drive slots, fans and temperatures around the disks',
    driver: 'ses',
    node: null,
  },
  {
    name: 'Direct-Access-RBC',
    code: 0x0e,
    what: 'A reduced block command disk, which the disk driver takes anyway',
    driver: 'sd',
    node: '/dev/sd*',
  },
  { name: 'Optical card', code: 0x0f, what: 'An optical card reader or writer', driver: null, node: null },
  { name: 'Bridge controller', code: 0x10, what: 'A bridge between transports', driver: null, node: null },
  { name: 'Object storage', code: 0x11, what: 'An OSD target, which is objects rather than blocks', driver: null, node: null },
  {
    name: 'Automation/Drive',
    code: 0x12,
    what: 'The automation interface of a library, beside its changer',
    driver: null,
    node: null,
  },
  { name: 'Security Manager', code: 0x13, what: 'A security manager device', driver: null, node: null },
  {
    name: 'Direct-Access-ZBC',
    code: 0x14,
    what: 'A zoned disk — host-managed SMR, which is a disk that will not take writes out of order',
    driver: 'sd',
    node: '/dev/sd*',
  },
  {
    name: 'Well-known LUN',
    code: 0x1e,
    what: 'Not a device: a logical unit the standard reserves for talking to the target itself',
    driver: null,
    node: null,
  },
  {
    name: 'No Device',
    code: 0x1f,
    what: 'The target answered and said there is nothing at this logical unit',
    driver: null,
    node: null,
  },
  {
    name: 'Unknown',
    code: null,
    what: 'A type code past the end of the table the kernel names types from, so the number is all there is and this file does not print it',
    driver: null,
    node: null,
  },
];

/**
 * The type of a **code**, for the files that print the number where this one
 * prints the name: `/proc/scsi/sg/devices` gives `5` for the CD-ROM this file
 * calls `CD-ROM`, and they are the same `scsi_device_types[]` entry read from
 * the two ends. Null for a code this table does not carry.
 */
export function typeForCode(code: number): DeviceType | null {
  return TYPES.find((type) => type.code === code) ?? null;
}

/** What the printed type name means, or null for a name this table has not got. */
export function typeOf(device: ScsiDevice): DeviceType | null {
  return TYPES.find((type) => type.name === device.type) ?? null;
}

/** Whether a driver binds this type, and so whether the device is in `/dev`. */
export function hasNode(device: ScsiDevice): boolean {
  const type = typeOf(device);
  return type !== null && type.node !== null;
}

export interface Standard {
  /** The ANSI version as printed, which is the INQUIRY byte the device answered. */
  revision: number;
  /** The standard that version is. */
  name: string;
  /** What that says about the device. */
  note: string;
}

/**
 * The standards the printed revision stands for. Three bits carry it, so 7 is
 * the ceiling: a device built to SPC-6 has no number left to say so and answers
 * 7 like an SPC-5 one.
 */
export const STANDARDS: Standard[] = [
  {
    revision: 0,
    name: 'no standard claimed',
    note: 'The device claims conformance to no version at all, which was allowed before SCSI-2 and is what a good deal of emulated and firmware-side hardware still answers',
  },
  { revision: 1, name: 'SCSI-1', note: 'ANSI X3.131-1986, the original standard' },
  { revision: 2, name: 'SCSI-2', note: 'ANSI X3.131-1994, which is where most parallel SCSI hardware sits' },
  { revision: 3, name: 'SPC', note: 'The first of the SCSI-3 command sets' },
  { revision: 4, name: 'SPC-2', note: 'Where USB mass storage and early SATA translation landed' },
  { revision: 5, name: 'SPC-3', note: 'What most disks answer: SATA through libata, and virtio-scsi' },
  { revision: 6, name: 'SPC-4', note: 'Modern SAS and USB devices, and the newer libata translations' },
  {
    revision: 7,
    name: 'SPC-5 or later',
    note: 'The ceiling of the three-bit field, so a device newer than SPC-5 answers 7 as well',
  },
];

/** The standard a printed revision names, or null for one outside the field. */
export function standardOf(revision: number | null): Standard | null {
  if (revision === null) return null;
  return STANDARDS.find((standard) => standard.revision === revision) ?? null;
}

/** The hosts the devices are spread over, in the order they were printed. */
export function hostsOf(table: ScsiTable): number[] {
  const hosts: number[] = [];

  for (const device of table.devices) {
    if (!hosts.includes(device.host)) hosts.push(device.host);
  }

  return hosts;
}

/** The devices of one host, which is one controller port's worth. */
export function devicesOfHost(table: ScsiTable, host: number): ScsiDevice[] {
  return table.devices.filter((device) => device.host === host);
}

/** Whether another device shares this one's target, which is what a LUN is for. */
export function sharesTarget(table: ScsiTable, device: ScsiDevice): boolean {
  return table.devices.some(
    (other) =>
      other !== device &&
      other.host === device.host &&
      other.channel === device.channel &&
      other.id === device.id,
  );
}

export interface ScsiSummary {
  devices: number;
  hosts: number[];
  /** The distinct type names, in the order they first appear. */
  types: string[];
  /** Devices behind libata's translation, which are SATA disks rather than SCSI. */
  ata: ScsiDevice[];
  /** Devices at a logical unit other than 0, which is one target holding several. */
  luns: ScsiDevice[];
  /** Devices whose model fills the field, so the name may be the front of one. */
  cut: ScsiDevice[];
  /** The oldest standard anything here claims, which is what the bus has to talk. */
  oldest: Standard | null;
  header: boolean;
}

export function summarize(table: ScsiTable): ScsiSummary {
  const types: string[] = [];
  for (const device of table.devices) {
    if (device.type !== '' && !types.includes(device.type)) types.push(device.type);
  }

  const revisions = table.devices
    .map((device) => device.revision)
    .filter((revision): revision is number => revision !== null);

  return {
    devices: table.devices.length,
    hosts: hostsOf(table),
    types,
    ata: table.devices.filter(isAtaBridge),
    luns: table.devices.filter((device) => device.lun !== 0),
    cut: table.devices.filter(isModelCut),
    oldest: revisions.length === 0 ? null : standardOf(Math.min(...revisions)),
    header: table.header,
  };
}
