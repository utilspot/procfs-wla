/**
 * Parser for `/proc/scsi/sg/debug`.
 *
 * The only file in `/proc/scsi/sg` that is not flat, and the only one that is
 * about **users** rather than devices:
 *
 *     max_active_device=2  def_reserved_size=32768
 *      >>> device=sg0 0:0:0:0   em=1 sg_tablesize=127 excl=0 open_cnt=1
 *        FD(1): timeout=60000ms bufflen=32768 (res)sgat=1 low_dma=0
 *        cmd_q=0 f_packid=0 k_orphan=0 closed=0
 *          No requests active
 *
 * `sg_proc_seq_show_debug` prints the header once and then, **for each device
 * with an open descriptor**, a block naming the device and a block per open
 * file. A device nothing has open prints nothing at all — so on an idle machine
 * this file is its first line and no more, which is not a fault and is the
 * ordinary state. `devices` beside it lists what exists; this lists what is in
 * use.
 *
 * Three of the numbers here are not what they look like.
 *
 * - `low_dma` is passed a **literal 0**, and `closed=0` is not passed at all —
 *   it is text in the format string. Two fields that cannot say anything else.
 *   See {@link LOW_DMA_IS_CONSTANT} and {@link CLOSED_IS_CONSTANT}.
 * - `bufflen` on an `FD` line is **that descriptor's own reserved buffer**,
 *   which it took from `def_reserved_size` when it was opened — so a machine
 *   whose default has been changed since shows the old size here and the new
 *   one in the header. That is the one place the two files can be seen
 *   disagreeing, and it is not a disagreement. See {@link inheritedReserve}.
 * - `em` is the **host template's** `emulated` flag rather than anything about
 *   the device: 1 for the hosts libata puts under an ATAPI drive.
 *
 * And a device that is going away prints a third spelling of the same absence
 * its neighbours spell in two others: `detaching pending close` here, nine
 * `-1`s in `devices`, `<no active device>` in `device_strs`. See
 * {@link SgDebugDevice.detaching}.
 */

/** `low_dma` is printed from a literal 0 rather than from anything. */
export const LOW_DMA_IS_CONSTANT =
  'The driver passes a literal 0 here: low DMA has not been a thing the sg driver tracks since ' +
  'the buffers stopped coming from the bottom of memory';

/** And `closed=0` is text in the format string, so it is not even passed. */
export const CLOSED_IS_CONSTANT =
  'Not a field at all: `closed=0` is written into the format string, so it reads 0 for every ' +
  'descriptor that this file can print';

/** What the driver prints for a device that is going away with a file still open. */
export const DETACHING = 'detaching pending close';

export interface SgDebugHeader {
  /** How many sg indices exist, which is the count `devices` prints lines for. */
  maxActiveDevice: number;
  /** `sg_big_buff` — the same number `/proc/scsi/sg/def_reserved_size` holds. */
  defReservedSize: number;
}

export type RequestBuffer = 'reserved' | 'mmap' | 'direct' | 'ordinary';
export type RequestState = 'active' | 'received' | 'finished';

export interface SgRequest {
  /** Which buffer it is using, which the driver says with a prefix. */
  buffer: RequestBuffer;
  /** Where it has got to: in flight, done and unread, or done and read. */
  state: RequestState;
  /** `pack_id`, the tag a program can find its own request by. */
  packId: number;
  /** Bytes of data the request carries. */
  bytes: number;
  /** How long it took, for one that is done. */
  durationMs: number | null;
  /** What it was given, for one still in flight. */
  timeoutMs: number | null;
  /** And how much of that has gone. */
  elapsedMs: number | null;
  /** Scatter-gather entries the transfer needed. */
  sgat: number;
  /** The SCSI opcode, which is the command itself. */
  opcode: number;
  raw: string;
}

export interface SgFileDescriptor {
  /** `FD(n)`, counted per device from 1 as the driver walks its open files. */
  index: number;
  /** The timeout commands on this descriptor get. */
  timeoutMs: number;
  /** This descriptor's reserved buffer, taken from the default when it opened. */
  bufflen: number;
  /** Scatter-gather entries that reserve took. */
  reserveSgat: number;
  /** Always 0. See {@link LOW_DMA_IS_CONSTANT}. */
  lowDma: number;
  /** Whether command queueing is on for it. */
  cmdQ: boolean;
  /** Whether it insists on its own pack ids. */
  forcePackId: boolean;
  /** Whether it keeps requests whose owner has gone. */
  keepOrphan: boolean;
  /** Always 0. See {@link CLOSED_IS_CONSTANT}. */
  closed: number;
  requests: SgRequest[];
  /** Whether the driver printed its "nothing in flight" line for this one. */
  idle: boolean;
}

export interface SgDebugDevice {
  /** `sg0` and so on, which is the node without its directory. */
  name: string;
  /** The address, or null for a device that is detaching. */
  address: string | null;
  /** Whether it is going away with a descriptor still open. */
  detaching: boolean;
  /** The host template's `emulated` flag, not a fact about the device. */
  emulated: boolean | null;
  /** Scatter-gather entries the host will take in one command. */
  tablesize: number | null;
  /** Whether a descriptor holds it exclusively. */
  exclusive: boolean | null;
  /** How many descriptors are open on it. */
  openCount: number | null;
  fds: SgFileDescriptor[];
  raw: string;
}

export interface SgDebug {
  header: SgDebugHeader | null;
  devices: SgDebugDevice[];
  /** Lines this parser could not place, which a working driver does not print. */
  unread: string[];
}

const HEADER = /^max_active_device=(\d+)\s+def_reserved_size=(\d+)\s*$/;
const DEVICE = /^\s*>>>\s+device=(\S+)\s*(.*)$/;
const DEVICE_TAIL =
  /^(\d+):(\d+):(\d+):(\d+)\s+em=(\d+)\s+sg_tablesize=(\d+)\s+excl=(\d+)\s+open_cnt=(\d+)\s*$/;
const FD = /^\s*FD\((\d+)\):\s+timeout=(\d+)ms\s+bufflen=(\d+)\s+\(res\)sgat=(\d+)\s+low_dma=(\d+)\s*$/;
const FD_FLAGS = /^\s*cmd_q=(\d+)\s+f_packid=(\d+)\s+k_orphan=(\d+)\s+closed=(\d+)\s*$/;
const NO_REQUESTS = /^\s*No requests active\s*$/;
const REQUEST =
  /^\s*(mmap>>|rb>>|dio>>)?\s*(act|rcv|fin):\s+id=(\d+)\s+blen=(\d+)(?:\s+dur=(\d+)|\s+t_o\/elap=(\d+)\/(\d+))ms\s+sgat=(\d+)\s+op=0x([0-9a-fA-F]+)\s*$/;

const BUFFERS: Record<string, RequestBuffer> = {
  'rb>>': 'reserved',
  'mmap>>': 'mmap',
  'dio>>': 'direct',
};

const STATES: Record<string, RequestState> = {
  act: 'active',
  rcv: 'received',
  fin: 'finished',
};

/** Parses the file, which is a header and then a block per device in use. */
export function parseSgDebug(text: string): SgDebug {
  const devices: SgDebugDevice[] = [];
  const unread: string[] = [];
  let header: SgDebugHeader | null = null;
  let device: SgDebugDevice | null = null;
  let fd: SgFileDescriptor | null = null;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const headerLine = HEADER.exec(line.trim());
    if (headerLine !== null && header === null) {
      header = {
        maxActiveDevice: Number(headerLine[1]),
        defReservedSize: Number(headerLine[2]),
      };
      continue;
    }

    const deviceLine = DEVICE.exec(line);
    if (deviceLine !== null) {
      const tail = deviceLine[2]!.trim();
      const detaching = tail.startsWith(DETACHING);
      const fields = DEVICE_TAIL.exec(tail);

      device = {
        name: deviceLine[1]!,
        address:
          fields === null ? null : `${fields[1]}:${fields[2]}:${fields[3]}:${fields[4]}`,
        detaching,
        emulated: fields === null ? null : fields[5] !== '0',
        tablesize: fields === null ? null : Number(fields[6]),
        exclusive: fields === null ? null : fields[7] !== '0',
        openCount: fields === null ? null : Number(fields[8]),
        fds: [],
        raw: line.replace(/\s+$/, ''),
      };
      devices.push(device);
      fd = null;
      continue;
    }

    const fdLine = FD.exec(line);
    if (fdLine !== null && device !== null) {
      fd = {
        index: Number(fdLine[1]),
        timeoutMs: Number(fdLine[2]),
        bufflen: Number(fdLine[3]),
        reserveSgat: Number(fdLine[4]),
        lowDma: Number(fdLine[5]),
        cmdQ: false,
        forcePackId: false,
        keepOrphan: false,
        closed: 0,
        requests: [],
        idle: false,
      };
      device.fds.push(fd);
      continue;
    }

    const flags = FD_FLAGS.exec(line);
    if (flags !== null && fd !== null) {
      fd.cmdQ = flags[1] !== '0';
      fd.forcePackId = flags[2] !== '0';
      fd.keepOrphan = flags[3] !== '0';
      fd.closed = Number(flags[4]);
      continue;
    }

    if (NO_REQUESTS.test(line) && fd !== null) {
      fd.idle = true;
      continue;
    }

    const request = REQUEST.exec(line);
    if (request !== null && fd !== null) {
      const done = request[5] !== undefined;

      fd.requests.push({
        buffer: request[1] === undefined ? 'ordinary' : BUFFERS[request[1]]!,
        state: STATES[request[2]!]!,
        packId: Number(request[3]),
        bytes: Number(request[4]),
        durationMs: done ? Number(request[5]) : null,
        timeoutMs: done ? null : Number(request[6]),
        elapsedMs: done ? null : Number(request[7]),
        sgat: Number(request[8]),
        opcode: Number.parseInt(request[9]!, 16),
        raw: line.replace(/\s+$/, ''),
      });
      continue;
    }

    unread.push(line.replace(/\s+$/, ''));
  }

  return { header, devices, unread };
}

export interface Opcode {
  code: number;
  name: string;
}

/**
 * The commands common enough to be worth naming where this file prints one.
 * A code with no entry is left as the number, which is what the file gives.
 */
export const OPCODES: Opcode[] = [
  { code: 0x00, name: 'TEST UNIT READY' },
  { code: 0x03, name: 'REQUEST SENSE' },
  { code: 0x08, name: 'READ(6)' },
  { code: 0x0a, name: 'WRITE(6)' },
  { code: 0x12, name: 'INQUIRY' },
  { code: 0x1a, name: 'MODE SENSE(6)' },
  { code: 0x1b, name: 'START STOP UNIT' },
  { code: 0x25, name: 'READ CAPACITY(10)' },
  { code: 0x28, name: 'READ(10)' },
  { code: 0x2a, name: 'WRITE(10)' },
  { code: 0x35, name: 'SYNCHRONIZE CACHE(10)' },
  { code: 0x43, name: 'READ TOC' },
  { code: 0x4d, name: 'LOG SENSE' },
  { code: 0x5a, name: 'MODE SENSE(10)' },
  { code: 0x88, name: 'READ(16)' },
  { code: 0x8a, name: 'WRITE(16)' },
  { code: 0x9e, name: 'SERVICE ACTION IN(16)' },
  { code: 0xa0, name: 'REPORT LUNS' },
  { code: 0xa8, name: 'READ(12)' },
];

/** The command a code names, or null for one this app does not carry. */
export function opcodeName(code: number): string | null {
  return OPCODES.find((opcode) => opcode.code === code)?.name ?? null;
}

/** The opcode as the file writes it, which is two hex digits. */
export function formatOpcode(code: number): string {
  return `0x${code.toString(16).padStart(2, '0')}`;
}

/**
 * Whether this descriptor's reserve is the default the header names. A
 * descriptor keeps what it took at open, so one that differs is older than the
 * last change to `def_reserved_size` rather than wrong.
 */
export function inheritedReserve(fd: SgFileDescriptor, header: SgDebugHeader | null): boolean {
  return header === null || fd.bufflen === header.defReservedSize;
}

/** Requests on this descriptor that are still in flight. */
export function activeRequests(fd: SgFileDescriptor): SgRequest[] {
  return fd.requests.filter((request) => request.state === 'active');
}

/** How much of its timeout an in-flight request has used, or null if it is done. */
export function timeoutUse(request: SgRequest): number | null {
  if (request.timeoutMs === null || request.elapsedMs === null || request.timeoutMs <= 0) {
    return null;
  }
  return request.elapsedMs / request.timeoutMs;
}

export interface SgDebugSummary {
  /** Whether the file is its header and nothing else, which is the usual state. */
  headerOnly: boolean;
  /** Devices with a descriptor open, which is all this file prints. */
  devices: number;
  /** Descriptors across all of them. */
  fds: number;
  /** Requests in flight across all of them. */
  active: number;
  /** Requests done but not yet collected. */
  waiting: number;
  detaching: SgDebugDevice[];
  /** Descriptors whose reserve is not the default the header names. */
  oldReserve: SgFileDescriptor[];
  unread: string[];
}

export function summarize(debug: SgDebug): SgDebugSummary {
  const fds = debug.devices.flatMap((device) => device.fds);
  const requests = fds.flatMap((fd) => fd.requests);

  return {
    headerOnly: debug.devices.length === 0 && debug.unread.length === 0,
    devices: debug.devices.length,
    fds: fds.length,
    active: requests.filter((request) => request.state === 'active').length,
    waiting: requests.filter((request) => request.state === 'received').length,
    detaching: debug.devices.filter((device) => device.detaching),
    oldReserve: fds.filter((fd) => !inheritedReserve(fd, debug.header)),
    unread: debug.unread,
  };
}
