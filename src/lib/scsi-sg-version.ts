/**
 * Parser for `/proc/scsi/sg/version`.
 *
 * One line, three fields, printed by `sg_proc_seq_show_version` in
 * `drivers/scsi/sg.c` as `"%d\t%s [%s]\n"`:
 *
 *     30536	3.5.36 [20140603]
 *
 * The **number** is `sg_version_num`, the **string** is `SG_VERSION_STR` and the
 * **date** is `sg_version_date`. The first two are the same fact twice over:
 * the driver declares the number as "2 digits for each component", so 30536 is
 * 3.05.36 written as one integer. See {@link decodeNumber}, and
 * {@link numberAgrees} for the one case worth flagging — a build where they do
 * not.
 *
 * That doubling is not decoration. The number is what a **program** reads: the
 * `SG_GET_VERSION_NUM` ioctl hands back the same integer, so a tool that needs
 * a feature added in 3.5.30 compares against 30530 rather than parsing a string
 * of three numbers. The string is for the reader of this file.
 *
 * The date is the **driver's**, not the kernel's or the machine's. It is the
 * last time `sg.c` changed its own version, hard-coded beside the string — so a
 * kernel released years later still prints it, and a file dated 2014 says
 * nothing about the age of anything except the sg driver's interface. That
 * interface has been stable for exactly that reason: {@link SG_IO_NOTE}.
 *
 * The file exists where the sg driver does — `CONFIG_CHR_DEV_SG`, built in or
 * loaded — and it is one of a directory the driver makes for itself, beside
 * `devices`, `device_strs` and the debugging files. A machine with the SCSI
 * midlayer but no sg has `/proc/scsi` without an `sg` in it.
 */

/** The line: a number, a tab, a version, and a date in brackets. */
const VERSION_LINE = /^(\d+)\s+(\S+)\s*(?:\[([^\]]*)\])?\s*$/;

/** How the driver's number is packed: two digits for each component. */
export const COMPONENT_DIGITS = 2;

/** What a program calls to get the same number this file prints. */
export const IOCTL = 'SG_GET_VERSION_NUM';

/** Why the number has not moved in years, which is the file's other lesson. */
export const SG_IO_NOTE =
  'The sg character device is the old way in. The modern one is the SG_IO ioctl, which any block ' +
  'device takes, and the version 4 interface lives in /dev/bsg — so sg holds its interface still ' +
  'rather than growing one';

export interface SgVersion {
  /** `sg_version_num`, the packed integer — what `SG_GET_VERSION_NUM` returns. */
  number: number | null;
  /** `SG_VERSION_STR`, the same version for a reader. */
  version: string | null;
  /** `sg_version_date`, as printed: eight digits, or whatever was in brackets. */
  date: string | null;
  /** The line as it was read. */
  raw: string;
}

export interface Components {
  major: number;
  minor: number;
  patch: number;
}

/** Parses the one line, or null for a file that does not hold one. */
export function parseSgVersion(text: string): SgVersion | null {
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = VERSION_LINE.exec(line.trim());
    if (match === null) return null;

    return {
      number: Number(match[1]),
      version: match[2] ?? null,
      date: match[3] ?? null,
      raw: line.replace(/\s+$/, ''),
    };
  }

  return null;
}

/**
 * The packed number as the three components it holds: 30536 is 3, 5 and 36,
 * since each takes {@link COMPONENT_DIGITS} digits from the right.
 */
export function decodeNumber(number: number | null): Components | null {
  if (number === null || !Number.isInteger(number) || number < 0) return null;

  return {
    major: Math.floor(number / 10000),
    minor: Math.floor(number / 100) % 100,
    patch: number % 100,
  };
}

/** Those three written the way the string beside them is. */
export function versionFromNumber(number: number | null): string | null {
  const components = decodeNumber(number);
  if (components === null) return null;

  return `${components.major}.${components.minor}.${components.patch}`;
}

/**
 * Whether the number and the string say the same thing, which they do in every
 * stock kernel because the driver declares them together. A build where they
 * disagree has had one of the two patched, and the number is the one anything
 * reading this programmatically will believe.
 */
export function numberAgrees(version: SgVersion): boolean {
  const fromNumber = versionFromNumber(version.number);
  return fromNumber !== null && version.version !== null && fromNumber === version.version;
}

export interface ReleaseDate {
  year: number;
  month: number;
  day: number;
}

/** The bracketed date as its parts, or null for one that is not eight digits. */
export function decodeDate(date: string | null): ReleaseDate | null {
  if (date === null || !/^\d{8}$/.test(date)) return null;

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { year, month, day };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The same date for a reader: `3 June 2014`. */
export function formatDate(date: string | null): string | null {
  const parts = decodeDate(date);
  if (parts === null) return null;

  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

export interface SgSummary {
  /** The version as the file spells it, which is the string rather than the number. */
  version: string | null;
  number: number | null;
  /** The number read back as a version, for showing what it holds. */
  decoded: string | null;
  agrees: boolean;
  date: string | null;
  /** The date as prose, or null where the field is not a date at all. */
  dated: string | null;
  components: Components | null;
}

export function summarize(version: SgVersion): SgSummary {
  return {
    version: version.version,
    number: version.number,
    decoded: versionFromNumber(version.number),
    agrees: numberAgrees(version),
    date: version.date,
    dated: formatDate(version.date),
    components: decodeNumber(version.number),
  };
}
