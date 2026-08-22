/**
 * Parser for `/proc/scsi/device_info`.
 *
 * The SCSI midlayer's **blacklist**: a vendor, a model and a bitmask of the
 * special treatment devices answering to that pair need. `devinfo_seq_show` in
 * `drivers/scsi/scsi_devinfo.c` prints a line each —
 *
 *     'HITACHI' 'DK312C' 0x1
 *     'HP' 'C1557A' 0x400
 *     'IBM' '3526' 0x100000
 *
 * — as `"'%.8s' '%.16s' 0x%x"`, which is the same 8 and 16 bytes the INQUIRY
 * fields hold in `/proc/scsi/scsi`. The quotes are the file's own, and they are
 * what makes a trailing space or an empty field visible: `'Promise' ''` is an
 * entry with no model at all.
 *
 * **Nothing here is about the hardware attached to this machine.** The list is
 * compiled into the kernel — `scsi_static_device_list[]` — so two machines
 * running the same kernel print the same file whether or not either has ever
 * seen one of these devices. It is a table of *what the kernel knows to work
 * around*, which is why it reads as a museum: Maxtor drives from the 1980s,
 * scanners, magneto-optical libraries.
 *
 * The flags are the point, and {@link FLAGS} carries them: 35 `BLIST_*` bits,
 * their numbers and what each makes the midlayer do, taken from
 * `include/scsi/scsi_devinfo.h`. Five numbers in that range are explicitly
 * **unused** — see {@link UNUSED_BITS} — so a bit set there is not an
 * unrecognised flag but one this kernel has retired.
 *
 * Two things the file does not say.
 *
 * The first is **how an entry matches**. A compiled-in entry is `compatible`:
 * its model is a *prefix*, so `'IBM' '3526'` catches `3526-43X` as well, and
 * `'Promise' ''` catches every Promise device there is. An entry added through
 * this file is not: `scsi_dev_info_list_add` space-pads it to the full 8 and 16
 * bytes, and `scsi_dev_info_list_find` then compares the whole of both. The two
 * kinds print identically. See {@link matchesAnyModel}, which reads the empty
 * model for what it is on a compiled-in entry.
 *
 * The second is **which entry won**. The list is searched in order and the
 * first match is taken, so an entry added here — written as
 * `vendor:model:flags`, which is also the `scsi_mod.dev_flags=` boot parameter's
 * spelling — takes effect from the next scan rather than for what is already
 * attached. Nothing in the file marks which lines came that way.
 */

/** What the printer wraps each field in, and what makes an empty one visible. */
export const QUOTE = "'";

/** Bytes of each field, which are the INQUIRY widths `/proc/scsi/scsi` prints. */
export const VENDOR_WIDTH = 8;
export const MODEL_WIDTH = 16;

export interface DeviceInfoEntry {
  /** The vendor, exactly as INQUIRY would answer it — matched exactly. */
  vendor: string;
  /** The model, which on a compiled-in entry is a prefix of the real one. */
  model: string;
  /** The mask, which needs 64 bits: the highest flag in use is bit 34. */
  flags: bigint;
  /** The line as it was read. */
  raw: string;
}

export interface DeviceInfoList {
  entries: DeviceInfoEntry[];
  /** Lines that were not an entry, which a stock kernel has none of. */
  unread: string[];
}

export interface BlistFlag {
  /** The bit's number, which is how `scsi_devinfo.h` declares it. */
  bit: number;
  /** `BLIST_NOLUN` and the rest, without the prefix — the file prints neither. */
  name: string;
  /** What the midlayer does differently for a device matching this entry. */
  what: string;
}

/** `1ULL << bit`, as a mask that survives the top of the range. */
export function maskOf(bit: number): bigint {
  return 1n << BigInt(bit);
}

/**
 * Every `BLIST_*` flag, from `include/scsi/scsi_devinfo.h`.
 *
 * The order is the header's, which is the bit order, and the wording is what
 * the flag does rather than what it is called — the name is already in the
 * left-hand column of the page that shows this.
 */
export const FLAGS: BlistFlag[] = [
  { bit: 0, name: 'NOLUN', what: 'Only scan LUN 0. The oldest quirk here, and the commonest: a device that answers for every logical unit it is asked about, so scanning further finds the same disk seven more times' },
  { bit: 1, name: 'FORCELUN', what: 'Known to have LUNs, so scan for them. Deprecated in favour of the max_luns parameter' },
  { bit: 2, name: 'BORKEN', what: 'Broken handshaking, which the midlayer works around by being slower with it' },
  { bit: 3, name: 'KEY', what: 'Unlocked by a special command before it will answer anything else' },
  { bit: 4, name: 'SINGLELUN', what: 'Do not use its LUNs in parallel: one command at a time across the whole target, since the units share one mechanism' },
  { bit: 5, name: 'NOTQ', what: 'Tagged command queueing is buggy here, so the midlayer does not use it' },
  { bit: 6, name: 'SPARSELUN', what: 'The LUN numbering has holes in it, so scanning must not stop at the first one that answers nothing' },
  { bit: 7, name: 'MAX5LUN', what: 'Avoid logical units 5 and above, which this device answers wrongly for' },
  { bit: 8, name: 'ISROM', what: 'Treat it as a removable CD-ROM whatever its INQUIRY type says' },
  { bit: 9, name: 'LARGELUN', what: 'It has LUNs past 7 although it claims SCSI-2, where 8 is as far as the standard goes' },
  { bit: 10, name: 'INQUIRY_36', what: 'Its INQUIRY additional-length field lies, so take the answer as the standard 36 bytes' },
  { bit: 11, name: 'IGN_MEDIA_CHANGE', what: 'Ignore the MEDIA CHANGE unit attention it raises on waking from runtime suspend, which is not a media change' },
  { bit: 12, name: 'NOSTARTONADD', what: 'Do not send START UNIT when it is added: this one spins up on its own, or should not be spun up at all' },
  { bit: 13, name: 'NO_VPD_SIZE', what: 'Do not ask how big a VPD page is before reading it, which some targets answer badly' },
  { bit: 17, name: 'REPORTLUN2', what: 'Try REPORT LUNS even though it claims SCSI-2, where the command is not required — for the arrays that answer it anyway' },
  { bit: 18, name: 'NOREPORTLUN', what: 'Do not try REPORT LUNS at all, although it claims SCSI-3 and so should answer it' },
  { bit: 19, name: 'NOT_LOCKABLE', what: 'Do not send PREVENT ALLOW MEDIUM REMOVAL: the door is not lockable, and asking upsets it' },
  { bit: 20, name: 'NO_ULD_ATTACH', what: 'This is a RAID controller’s configuration channel rather than a volume, so no upper-level driver binds it — the reason such a device has no /dev node of its own' },
  { bit: 21, name: 'SELECT_NO_ATN', what: 'Select it without asserting ATN, on the parallel bus where that was a wire' },
  { bit: 22, name: 'RETRY_HWERROR', what: 'Retry a HARDWARE ERROR from it rather than giving up, since it raises one where it means something softer' },
  { bit: 23, name: 'MAX_512', what: 'Cap a transfer at 512 sectors, which is as much as it will take in one command' },
  { bit: 25, name: 'NO_DIF', what: 'Disable T10 protection information, which it claims and does not do' },
  { bit: 26, name: 'SKIP_VPD_PAGES', what: 'Skip the SBC-3 VPD pages entirely, so nothing asks it for the ones it answers wrongly' },
  { bit: 28, name: 'TRY_VPD_PAGES', what: 'Read the VPD pages after all, for a device that claims a standard too old to have them but answers them' },
  { bit: 29, name: 'NO_RSOC', what: 'Do not issue REPORT SUPPORTED OPERATION CODES, which it does not handle' },
  { bit: 30, name: 'MAX_1024', what: 'Cap a transfer at 1024 sectors' },
  { bit: 31, name: 'UNMAP_LIMIT_WS', what: 'Use its UNMAP limit for WRITE SAME as well, since the two share a ceiling here' },
  { bit: 32, name: 'RETRY_ITF', what: 'Always retry an ABORTED COMMAND carrying Internal Target Failure' },
  { bit: 33, name: 'RETRY_ASC_C1', what: 'Always retry an ABORTED COMMAND with additional sense code 0xc1' },
  { bit: 34, name: 'SKIP_IO_HINTS', what: 'Do not ask it for the IO Advice Hints Grouping mode page' },
];

/**
 * The bits `scsi_devinfo.h` declares as `__BLIST_UNUSED_*`: numbers inside the
 * range that name nothing on this kernel, having been retired rather than never
 * assigned. A file setting one is saying something no kernel reads.
 */
export const UNUSED_BITS = [14, 15, 16, 24, 27];

/** The flag of that number, or null for one this kernel does not name. */
export function flagAt(bit: number): BlistFlag | null {
  return FLAGS.find((flag) => flag.bit === bit) ?? null;
}

/** `'HITACHI' 'DK312C' 0x1` — the quotes are the printer's, the fields are not. */
const ENTRY = /^'(.*)'\s+'(.*)'\s+0x([0-9a-fA-F]+)\s*$/;

/** Parses the file: one entry a line, and nothing else on a stock kernel. */
export function parseDeviceInfo(text: string): DeviceInfoList {
  const entries: DeviceInfoEntry[] = [];
  const unread: string[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const entry = ENTRY.exec(line);
    if (entry === null) {
      unread.push(line.replace(/\s+$/, ''));
      continue;
    }

    entries.push({
      vendor: entry[1]!,
      model: entry[2]!,
      flags: BigInt(`0x${entry[3]!}`),
      raw: line.replace(/\s+$/, ''),
    });
  }

  return { entries, unread };
}

/** The named flags an entry sets, in bit order. */
export function flagsOf(entry: DeviceInfoEntry): BlistFlag[] {
  return FLAGS.filter((flag) => (entry.flags & maskOf(flag.bit)) !== 0n);
}

/**
 * The bits it sets that this app has no name for, as their numbers: a kernel
 * newer than this table, or one of the {@link UNUSED_BITS} the header retired.
 */
export function unnamedBits(entry: DeviceInfoEntry): number[] {
  const bits: number[] = [];

  for (let bit = 0; bit < 64; bit += 1) {
    if ((entry.flags & maskOf(bit)) !== 0n && flagAt(bit) === null) bits.push(bit);
  }

  return bits;
}

/** Whether a bit is one the header declares and then does not use. */
export function isUnusedBit(bit: number): boolean {
  return UNUSED_BITS.includes(bit);
}

/**
 * Whether the entry names no model, which on a **compiled-in** entry means
 * every device of that vendor: the model there is a prefix, and the empty
 * string is a prefix of everything. An entry added through this file is padded
 * and compared whole, where the same line would match only a device whose model
 * is blank — a difference the file does not print. See the module comment.
 */
export function matchesAnyModel(entry: DeviceInfoEntry): boolean {
  return entry.model === '';
}

/** And the same for the vendor, which is matched exactly either way. */
export function hasNoVendor(entry: DeviceInfoEntry): boolean {
  return entry.vendor === '';
}

/** Whether a field fills its INQUIRY width, so a longer one would not fit. */
export function fillsField(value: string, width: number): boolean {
  return value.length >= width;
}

/** The mask as the file prints it, which is hex with no padding. */
export function formatFlags(flags: bigint): string {
  return `0x${flags.toString(16)}`;
}

/** How the same entry is written back into the file, or given at boot. */
export function writeSpellingOf(entry: DeviceInfoEntry): string {
  return `${entry.vendor}:${entry.model}:${formatFlags(entry.flags)}`;
}

/** The distinct vendors named, in the order they first appear. */
export function vendorsOf(list: DeviceInfoList): string[] {
  const vendors: string[] = [];

  for (const entry of list.entries) {
    if (!vendors.includes(entry.vendor)) vendors.push(entry.vendor);
  }

  return vendors;
}

export interface FlagUse {
  flag: BlistFlag;
  /** How many entries set it, which is what says whether it is a rule or a case. */
  count: number;
}

/** Every named flag the list uses, commonest first, then by bit. */
export function flagsUsed(list: DeviceInfoList): FlagUse[] {
  const uses = new Map<number, number>();

  for (const entry of list.entries) {
    for (const flag of flagsOf(entry)) uses.set(flag.bit, (uses.get(flag.bit) ?? 0) + 1);
  }

  return [...uses.entries()]
    .map(([bit, count]) => ({ flag: flagAt(bit)!, count }))
    .sort((a, b) => b.count - a.count || a.flag.bit - b.flag.bit);
}

/** Entries whose only flag is `NOLUN`, which is the list's largest single group. */
export function isLunZeroOnly(entry: DeviceInfoEntry): boolean {
  return entry.flags === maskOf(0);
}

export interface DeviceInfoSummary {
  entries: number;
  vendors: string[];
  flags: FlagUse[];
  /** Entries matching every model of their vendor, which only a prefix does. */
  anyModel: DeviceInfoEntry[];
  /** Entries carrying a bit this app cannot name. */
  unnamed: DeviceInfoEntry[];
  /** The `NOLUN`-only entries, the oldest and largest group in the list. */
  lunZeroOnly: DeviceInfoEntry[];
  unread: string[];
}

export function summarize(list: DeviceInfoList): DeviceInfoSummary {
  return {
    entries: list.entries.length,
    vendors: vendorsOf(list),
    flags: flagsUsed(list),
    anyModel: list.entries.filter(matchesAnyModel),
    unnamed: list.entries.filter((entry) => unnamedBits(entry).length > 0),
    lunZeroOnly: list.entries.filter(isLunZeroOnly),
    unread: list.unread,
  };
}
