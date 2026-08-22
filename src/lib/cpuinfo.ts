/**
 * Parser for `/proc/cpuinfo`.
 *
 * The file is a list of `key : value` lines grouped into blank-line separated
 * blocks. Field names differ per architecture (x86 has `model name`/`flags`,
 * ARM has `Features`/`CPU part`, RISC-V has `isa`/`uarch`), and some
 * architectures append a trailing block describing the machine rather than a
 * CPU, so the parser stays generic and keeps every field it sees.
 */

export interface CpuField {
  key: string;
  value: string;
}

export interface CpuEntry {
  /** Value of the `processor` field, when present. */
  index: number | null;
  fields: CpuField[];
  /** Case-insensitive lookup of the fields above. */
  get(key: string): string | undefined;
}

export interface CpuInfo {
  cpus: CpuEntry[];
  /** Trailing block without a `processor` field (ARM boards: Hardware, Model, Serial). */
  machine: CpuField[];
}

function makeEntry(fields: CpuField[]): CpuEntry {
  const lookup = new Map(fields.map((f) => [f.key.toLowerCase(), f.value]));
  const index = Number(lookup.get('processor'));
  return {
    index: Number.isInteger(index) ? index : null,
    fields,
    get: (key) => lookup.get(key.toLowerCase()),
  };
}

function parseBlock(block: string): CpuField[] {
  const fields: CpuField[] = [];
  for (const line of block.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (key === '') continue;
    fields.push({ key, value: line.slice(separator + 1).trim() });
  }
  return fields;
}

export function parseCpuInfo(text: string): CpuInfo {
  const cpus: CpuEntry[] = [];
  const machine: CpuField[] = [];

  for (const block of text.split(/\n\s*\n/)) {
    const fields = parseBlock(block);
    if (fields.length === 0) continue;

    const entry = makeEntry(fields);
    if (entry.get('processor') === undefined) {
      machine.push(...fields);
    } else {
      cpus.push(entry);
    }
  }

  return { cpus, machine };
}

/** Best-effort display name for a CPU across architectures. */
export function cpuModel(cpu: CpuEntry): string {
  // `cpu` is s390x, `uarch` RISC-V. ARM32 names the model in a `Processor`
  // field, which lowercases onto the `processor` index — so only use it when it
  // is not just a number.
  const armLegacy = cpu.get('processor');
  return (
    cpu.get('model name') ??
    cpu.get('uarch') ??
    cpu.get('cpu') ??
    (armLegacy !== undefined && !/^\d+$/.test(armLegacy) ? armLegacy : undefined) ??
    'Unknown model'
  );
}

/** The flags/features list, whatever the architecture calls it. */
export function cpuFlags(cpu: CpuEntry): string[] {
  const x86OrArm = cpu.get('flags') ?? cpu.get('Features');
  if (x86OrArm !== undefined) return x86OrArm.split(/\s+/).filter((flag) => flag !== '');

  // RISC-V reports one underscore-joined ISA string, e.g. `rv64imafd_zicsr_zifencei`.
  const isa = cpu.get('isa');
  if (isa !== undefined) return isa.split('_').filter((part) => part !== '');

  return [];
}

/** Known CPU bugs, x86 only. */
export function cpuBugs(cpu: CpuEntry): string[] {
  return (cpu.get('bugs') ?? '').split(/\s+/).filter((bug) => bug !== '');
}

export interface CpuInfoSummary {
  logicalCount: number;
  /** Distinct model names, in first-seen order. */
  models: string[];
  /** Distinct `physical id` values; null when the file does not report them. */
  sockets: number | null;
  /** Sum of `cpu cores` per socket; null when unavailable. */
  physicalCores: number | null;
  /** Current clock of each CPU in MHz, when reported. */
  clocksMHz: number[];
}

export function summarize(info: CpuInfo): CpuInfoSummary {
  const models = [...new Set(info.cpus.map(cpuModel))];

  const coresBySocket = new Map<string, number>();
  for (const cpu of info.cpus) {
    const socket = cpu.get('physical id');
    const cores = Number(cpu.get('cpu cores'));
    if (socket !== undefined && Number.isFinite(cores)) coresBySocket.set(socket, cores);
  }

  const clocksMHz = info.cpus
    .map((cpu) => Number(cpu.get('cpu MHz')))
    .filter((mhz) => Number.isFinite(mhz));

  return {
    logicalCount: info.cpus.length,
    models,
    sockets: coresBySocket.size > 0 ? coresBySocket.size : null,
    physicalCores:
      coresBySocket.size > 0 ? [...coresBySocket.values()].reduce((a, b) => a + b, 0) : null,
    clocksMHz,
  };
}
