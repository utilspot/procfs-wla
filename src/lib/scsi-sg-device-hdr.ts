/**
 * Parser for `/proc/scsi/sg/device_hdr`.
 *
 * One line, nine words, printed by `sg_proc_seq_show_devhdr` in
 * `drivers/scsi/sg.c`:
 *
 *     host	chan	id	lun	type	opens	qdepth	busy	online
 *
 * It is a `seq_puts` of a **string literal** — no device is looked at, no lock
 * taken — which makes this the least eventful file in `/proc` and the reason it
 * is worth a page at all: **it is the header of a different file**.
 * `/proc/scsi/sg/devices` prints nine tab-separated numbers per device and no
 * header, so these are the names those columns go by, kept apart so that a
 * program reading `devices` never has to skip a line it did not want.
 *
 * Because it is a literal, it says nothing whatever about the machine — not
 * even as much as `device_info`, which at least differs between kernel
 * versions. Two computers print the same nine words.
 *
 * That is also what makes it worth *checking*. If a kernel ever changed the
 * columns of `devices`, this file is where it would say so first — so the page
 * reads the names against {@link COLUMNS}, the order the app parses that file
 * in, and says plainly when they do not agree rather than assuming they do. See
 * {@link compareToExpected}.
 *
 * The names themselves are terse and one of them is a promise the driver does
 * not keep: `opens` is printed as a literal `1` for every device. What each of
 * the nine holds is {@link COLUMN_FACTS} — this file being the natural place to
 * put them, since naming the columns is the whole of what it does.
 */

import { COLUMNS } from './scsi-sg-devices';

/** The header as every kernel prints it, which is what a literal means. */
export const HEADER_LINE = COLUMNS.join('\t');

export interface ColumnFact {
  /** The name as this file prints it. */
  name: string;
  /** What the column of `devices` under it holds. */
  what: string;
  /** Where the name is not the whole truth, or null where it is. */
  caveat: string | null;
}

/**
 * What each name stands for in `/proc/scsi/sg/devices`, in the order this file
 * prints them.
 *
 * The `caveat` is the reason a page is better than a `cat` here: two of these
 * names are read wrongly more often than not, and one of them names something
 * the driver never fills in.
 */
export const COLUMN_FACTS: ColumnFact[] = [
  {
    name: 'host',
    what: 'The SCSI host, which is one controller port rather than one card — the scsi0 of /proc/scsi/scsi',
    caveat: null,
  },
  {
    name: 'chan',
    what: 'The channel: the bus below that host, which is a real bus only where a controller has several',
    caveat: null,
  },
  {
    name: 'id',
    what: 'The target on that bus — a SCSI id once, and whatever the transport made up since',
    caveat: null,
  },
  {
    name: 'lun',
    what: 'The logical unit inside the target, which is where one device answers as several',
    caveat: null,
  },
  {
    name: 'type',
    what: 'The peripheral device type as a number, which /proc/scsi/scsi prints as a name',
    caveat: 'A number here and a word there, out of one table read from the two ends',
  },
  {
    name: 'opens',
    what: 'Nothing. The driver passes a literal 1 where this name promises a count',
    caveat: 'Every device reads 1 whether or not anything has its node open',
  },
  {
    name: 'qdepth',
    what: 'How many commands the midlayer will keep in flight for the device at once',
    caveat: null,
  },
  {
    name: 'busy',
    what: 'How many were in flight when the file was read — the one live number in that file',
    caveat: 'It differs between two reads a second apart, where everything else holds still',
  },
  {
    name: 'online',
    what: 'scsi_device_online: 0 for a device the midlayer has stopped talking to and not yet forgotten',
    caveat: 'Which is not the same as the nine -1s a device that has gone leaves behind',
  },
];

export interface DeviceHeader {
  /** The names, in the order printed. */
  names: string[];
  /** The line as it was read. */
  raw: string;
  /** Anything printed after the header, which no kernel does. */
  extra: string[];
}

/** Parses the file, which is one line of names and nothing else. */
export function parseDeviceHdr(text: string): DeviceHeader | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return null;

  const first = lines[0]!;
  const names = first.trim().split(/\s+/);
  if (names.length === 0 || names.some((name) => name === '')) return null;

  return {
    names,
    raw: first.replace(/\s+$/, ''),
    extra: lines.slice(1).map((line) => line.replace(/\s+$/, '')),
  };
}

/** What each name means, for a header naming one this app knows. */
export function factFor(name: string): ColumnFact | null {
  return COLUMN_FACTS.find((column) => column.name === name) ?? null;
}

export interface HeaderComparison {
  /** Whether the names are exactly the ones the app parses `devices` in. */
  agrees: boolean;
  /** Names this header has that the app does not know. */
  unknown: string[];
  /** Names the app expects that this header does not have. */
  missing: string[];
  /** Whether the shared names are in the order the app reads them in. */
  reordered: boolean;
}

/**
 * The header against {@link COLUMNS} — the order `parseSgDevices` reads that
 * file in. A disagreement is worth saying out loud: it means the page for
 * `devices` is naming columns that are not where it thinks they are.
 */
export function compareToExpected(header: DeviceHeader): HeaderComparison {
  const expected = [...COLUMNS];
  const unknown = header.names.filter((name) => !expected.includes(name as (typeof COLUMNS)[number]));
  const missing = expected.filter((name) => !header.names.includes(name));

  const shared = header.names.filter((name) => expected.includes(name as (typeof COLUMNS)[number]));
  const sharedExpected = expected.filter((name) => header.names.includes(name));
  const reordered = shared.join('\t') !== sharedExpected.join('\t');

  return {
    agrees: unknown.length === 0 && missing.length === 0 && !reordered,
    unknown,
    missing,
    reordered,
  };
}

/** Whether the file holds exactly the line every kernel prints. */
export function isStockHeader(header: DeviceHeader): boolean {
  return header.raw === HEADER_LINE && header.extra.length === 0;
}
