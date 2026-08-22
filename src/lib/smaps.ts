/**
 * Parser for `/proc/<pid>/smaps`.
 *
 * `/proc/<pid>/maps` with the accounting filled in: a block per mapping, each
 * opening with the line `maps` would have printed and followed by what that
 * mapping costs.
 *
 *   7f4a1c000000-7f4a1c021000 rw-p 00000000 00:00 0                    [heap]
 *   Size:                132 kB
 *   Rss:                   8 kB
 *   Pss:                   8 kB
 *   Private_Dirty:         8 kB
 *   Swap:                  0 kB
 *   VmFlags: rd wr mr mw me ac sd
 *
 * The number this file exists for is **Pss**, the proportional set size: a
 * page mapped by four processes counts as a quarter of a page in each. Rss
 * counts it whole in all four, so adding Rss across processes invents memory
 * that is not there and adding Pss does not. On the machine this parser was
 * written against, a browser tab's `chrome` text mapping shows Rss 107,588 kB
 * against Pss 57,403 — the same pages, counted once and counted fairly.
 *
 * Three more things worth knowing:
 *
 * - **`Size` is address space, not memory.** A mapping can span gigabytes and
 *   hold nothing: a `---p` reservation exists so an allocator can hand out
 *   parts of it later. See {@link isReservation}.
 * - **`kB` means KiB**, as it does in `/proc/meminfo`, and the fields without
 *   one — `THPeligible`, `ProtectionKey` — are not memory at all.
 * - **`Rss` is the sum of the four Shared/Private, Clean/Dirty fields**, which
 *   is what says how much of a mapping is shared and how much has been written
 *   to. See {@link rssParts}.
 *
 * Reading this file walks the process's page tables, so it is expensive on a
 * large process — `smaps_rollup` exists to give the totals without the
 * per-mapping detail.
 */

/** What the two-letter codes in `VmFlags` mean. */
export const VM_FLAGS: Readonly<Record<string, string>> = {
  rd: 'Readable',
  wr: 'Writable',
  ex: 'Executable',
  sh: 'Shared',
  mr: 'May be made readable',
  mw: 'May be made writable',
  me: 'May be made executable',
  ms: 'May be shared',
  gd: 'A stack, which grows downwards',
  pf: 'Pure PFN range, with no page structures behind it',
  dw: 'Writes to the mapped file are disabled',
  lo: 'Locked into memory',
  io: 'Memory-mapped I/O — a device’s registers rather than RAM',
  sr: 'Sequential read advised',
  rr: 'Random read advised',
  dc: 'Not copied to the child on fork',
  de: 'Cannot be expanded by mremap',
  ac: 'Accounted against the commit limit',
  nr: 'No swap space reserved for it',
  ht: 'Uses hugetlb pages',
  sf: 'Synchronous page faults',
  ar: 'Architecture-specific flag',
  wf: 'Wiped on fork',
  dd: 'Left out of a core dump',
  sd: 'Soft-dirty tracking',
  mm: 'Mixed map — both page-backed and PFN ranges',
  hg: 'Transparent hugepages advised',
  nh: 'Transparent hugepages advised against',
  mg: 'Mergeable by KSM',
  bt: 'Guarded by arm64 branch target identification',
  mt: 'Carries arm64 memory tagging tags',
  um: 'Watched by userfaultfd for missing pages',
  uw: 'Write-protected by userfaultfd',
};

/** What the accounting fields mean. Anything absent is still shown. */
export const FIELDS: Readonly<Record<string, string>> = {
  Size: 'Address space the mapping covers, whether or not anything is behind it',
  KernelPageSize: 'Page size the kernel uses here',
  MMUPageSize: 'Page size the hardware uses here',
  Rss: 'Pages of it resident in memory, counted whole however many processes share them',
  Pss: 'The same pages counted fairly: one shared by four processes counts as a quarter',
  Pss_Dirty: 'The part of Pss that has been written to',
  Shared_Clean: 'Resident, shared with another process, and unmodified',
  Shared_Dirty: 'Resident, shared, and written to',
  Private_Clean: 'Resident, this process alone, and unmodified',
  Private_Dirty: 'Resident, this process alone, and written to — what it would cost to swap out',
  Referenced: 'Marked as used recently, which is what keeps it off the reclaim list',
  Anonymous: 'Backed by no file, so it has nowhere to go but swap',
  KSM: 'Pages the same-page merger has deduplicated',
  LazyFree: 'Marked MADV_FREE: the kernel may drop these without writing them anywhere',
  AnonHugePages: 'Anonymous memory backed by transparent hugepages',
  ShmemPmdMapped: 'Shared memory mapped with hugepages',
  FilePmdMapped: 'File pages mapped with hugepages',
  Shared_Hugetlb: 'Reserved hugetlb pages shared with another process',
  Private_Hugetlb: 'Reserved hugetlb pages this process alone',
  Swap: 'Pages of this mapping written out to swap',
  SwapPss: 'The same, counted proportionally',
  Locked: 'Pages locked into memory and never reclaimed',
  THPeligible: 'Whether a transparent hugepage could be used here — a flag, not an amount',
  ProtectionKey: 'The memory protection key this mapping carries — a number, not an amount',
};

/** The four fields Rss is made of. */
export const RSS_PARTS = ['Shared_Clean', 'Shared_Dirty', 'Private_Clean', 'Private_Dirty'];

/** Fields that carry a flag or an identifier rather than an amount of memory. */
const NOT_MEMORY = new Set(['THPeligible', 'ProtectionKey', 'KernelPageSize', 'MMUPageSize']);

export interface Mapping {
  /** Start of the range, as printed. */
  start: string;
  end: string;
  /** `rw-p`, `r-xp`, `---p`. */
  perms: string;
  /** Offset into the backing file. */
  offset: string;
  /** Device the file is on, as `major:minor`. */
  dev: string;
  inode: number;
  /**
   * The backing file, a bracketed name like `[heap]` or `[anon:jit-code]`, or
   * empty for an anonymous mapping nobody named.
   */
  path: string;
  /** The accounting lines, in the order the kernel printed them. */
  fields: { name: string; value: number; unit: string | null }[];
  /** The two-letter codes from `VmFlags`. */
  flags: string[];
}

const HEADER = /^([0-9a-f]+)-([0-9a-f]+) (\S{4}) (\S+) (\S+) (\d+)\s*(.*)$/;
const FIELD = /^(\w+):\s+(\d+)(?:\s+(\S+))?$/;
const VMFLAGS = /^VmFlags:\s*(.*)$/;

/**
 * One mapping's header line — which is one whole line of `/proc/<pid>/maps`.
 *
 * Exported because that is exactly what it is: a block here opens with the line
 * that file would have printed, so the two pages read it with one function
 * rather than two that have to agree. `src/lib/pid-maps.ts` is the other
 * caller; the `fields` and `flags` it leaves empty are what `smaps` adds.
 */
export function parseMapLine(line: string): Mapping | null {
  const header = HEADER.exec(line.trimEnd());
  if (header === null) return null;

  return {
    start: header[1]!,
    end: header[2]!,
    perms: header[3]!,
    offset: header[4]!,
    dev: header[5]!,
    inode: Number(header[6]),
    path: (header[7] ?? '').trim(),
    fields: [],
    flags: [],
  };
}

export function parseSmaps(text: string): Mapping[] {
  const mappings: Mapping[] = [];
  let current: Mapping | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed === '') continue;

    const header = parseMapLine(trimmed);
    if (header !== null) {
      current = header;
      mappings.push(current);
      continue;
    }

    if (current === null) continue;

    const flags = VMFLAGS.exec(trimmed);
    if (flags !== null) {
      current.flags = (flags[1] ?? '').trim().split(/\s+/).filter((flag) => flag !== '');
      continue;
    }

    const field = FIELD.exec(trimmed);
    if (field !== null) {
      current.fields.push({
        name: field[1]!,
        value: Number(field[2]),
        unit: field[3] ?? null,
      });
    }
  }

  return mappings;
}

/** One accounting field, or null where this kernel does not print it. */
export function field(mapping: Mapping, name: string): number | null {
  return mapping.fields.find((entry) => entry.name === name)?.value ?? null;
}

/** What a field means, or null for one this page has no note for. */
export function describeField(name: string): string | null {
  return FIELDS[name] ?? null;
}

/** What a VmFlags code means, or null for one this page has no note for. */
export function describeFlag(flag: string): string | null {
  return VM_FLAGS[flag] ?? null;
}

/** Whether this field counts memory, as opposed to being a flag or an id. */
export function isMemoryField(name: string): boolean {
  return !NOT_MEMORY.has(name);
}

export type MappingKind = 'file' | 'heap' | 'stack' | 'named-anon' | 'anon' | 'special';

/** What each kind of mapping is. */
export const KINDS: Readonly<Record<MappingKind, string>> = {
  file: 'Backed by a file, so its clean pages can be dropped and read back',
  heap: 'The heap the C library grows with brk',
  stack: 'The main thread’s stack',
  'named-anon': 'Anonymous memory an allocator named for itself, through prctl',
  anon: 'Anonymous memory: no file behind it, so it can only go to swap',
  special: 'A mapping the kernel puts in every process, such as the vDSO',
};

const SPECIAL = /^\[(vdso|vvar|vvar_vclock|vsyscall|uprobes)\]$/;

export function kindOf(mapping: Mapping): MappingKind {
  if (mapping.path === '[heap]') return 'heap';
  if (mapping.path === '[stack]') return 'stack';
  if (SPECIAL.test(mapping.path)) return 'special';
  if (mapping.path.startsWith('[anon:')) return 'named-anon';
  if (mapping.path === '' || mapping.path.startsWith('[')) return 'anon';
  return 'file';
}

/** A short name for the mapping: the file's basename, or what it is instead. */
export function labelOf(mapping: Mapping): string {
  if (mapping.path === '') return 'anonymous';
  if (mapping.path.startsWith('[')) return mapping.path;
  return mapping.path.slice(mapping.path.lastIndexOf('/') + 1);
}

export function isReadable(mapping: Mapping): boolean {
  return mapping.perms[0] === 'r';
}

export function isWritable(mapping: Mapping): boolean {
  return mapping.perms[1] === 'w';
}

export function isExecutable(mapping: Mapping): boolean {
  return mapping.perms[2] === 'x';
}

/** `s` for a shared mapping, `p` for a private one that copies on write. */
export function isShared(mapping: Mapping): boolean {
  return mapping.perms[3] === 's';
}

/**
 * Writable and executable at once, which is what a runtime that generates code
 * needs and what an exploit needs too. Rare enough to be worth pointing at.
 */
export function isWritableExecutable(mapping: Mapping): boolean {
  return isWritable(mapping) && isExecutable(mapping);
}

/** The four fields Rss is made of, and whether they add up to it. */
export function rssParts(mapping: Mapping): { parts: number; rss: number; agree: boolean } {
  const parts = RSS_PARTS.reduce((total, name) => total + (field(mapping, name) ?? 0), 0);
  const rss = field(mapping, 'Rss') ?? 0;
  return { parts, rss, agree: parts === rss };
}

/** Address space reserved with nothing behind it yet. */
export const RESERVATION_KIB = 1024;

/**
 * Whether this mapping is address space held rather than memory used: nothing
 * resident, and large enough that it was clearly taken on purpose. A `---p`
 * range is the usual shape — an allocator claiming room to hand out later.
 */
export function isReservation(mapping: Mapping): boolean {
  const size = field(mapping, 'Size') ?? 0;
  return (field(mapping, 'Rss') ?? 0) === 0 && size >= RESERVATION_KIB;
}

/** How much of a mapping's resident memory it shares, 0–1. */
export function sharedShare(mapping: Mapping): number | null {
  const rss = field(mapping, 'Rss') ?? 0;
  const pss = field(mapping, 'Pss');
  if (pss === null || rss === 0) return null;
  return Math.max(0, 1 - pss / rss);
}

export interface KindTotal {
  kind: MappingKind;
  mappings: number;
  sizeKib: number;
  rssKib: number;
  pssKib: number;
}

/** The mappings grouped by what they are, largest share of memory first. */
export function byKind(mappings: readonly Mapping[]): KindTotal[] {
  const totals = new Map<MappingKind, KindTotal>();

  for (const mapping of mappings) {
    const kind = kindOf(mapping);
    const existing = totals.get(kind) ?? {
      kind,
      mappings: 0,
      sizeKib: 0,
      rssKib: 0,
      pssKib: 0,
    };

    existing.mappings += 1;
    existing.sizeKib += field(mapping, 'Size') ?? 0;
    existing.rssKib += field(mapping, 'Rss') ?? 0;
    existing.pssKib += field(mapping, 'Pss') ?? 0;
    totals.set(kind, existing);
  }

  return Array.from(totals.values()).sort((a, b) => b.pssKib - a.pssKib);
}

export interface SmapsSummary {
  mappings: number;
  /** Address space the process has claimed. */
  sizeKib: number;
  /** Of that, what is resident — counted whole. */
  rssKib: number;
  /** And counted proportionally, which is the figure that adds up. */
  pssKib: number;
  /** What only this process has and has written to. */
  privateDirtyKib: number;
  swapKib: number;
  swapPssKib: number;
  anonHugeKib: number;
  /** Share of resident memory this process shares with another, 0–1. */
  sharedShare: number | null;
  byKind: KindTotal[];
  /** Mappings by proportional cost, largest first. */
  largest: Mapping[];
  /** Mappings that are writable and executable at once. */
  writableExecutable: Mapping[];
  /** Address space claimed with nothing in it. */
  reservations: Mapping[];
  /** Mappings whose four parts do not add up to Rss, which should not happen. */
  inconsistent: Mapping[];
}

export function summarize(mappings: readonly Mapping[]): SmapsSummary {
  const sum = (name: string): number =>
    mappings.reduce((total, mapping) => total + (field(mapping, name) ?? 0), 0);

  const rssKib = sum('Rss');
  const pssKib = sum('Pss');

  return {
    mappings: mappings.length,
    sizeKib: sum('Size'),
    rssKib,
    pssKib,
    privateDirtyKib: sum('Private_Dirty'),
    swapKib: sum('Swap'),
    swapPssKib: sum('SwapPss'),
    anonHugeKib: sum('AnonHugePages'),
    sharedShare: rssKib === 0 ? null : Math.max(0, 1 - pssKib / rssKib),
    byKind: byKind(mappings),
    largest: [...mappings].sort(
      (a, b) => (field(b, 'Pss') ?? 0) - (field(a, 'Pss') ?? 0),
    ),
    writableExecutable: mappings.filter(isWritableExecutable),
    reservations: mappings.filter(isReservation),
    inconsistent: mappings.filter((mapping) => !rssParts(mapping).agree),
  };
}

const UNITS = ['KiB', 'MiB', 'GiB', 'TiB'];

/** Binary units from a KiB figure, which is what `kB` means here. */
export function formatKib(value: number): string {
  if (value === 0) return '0';

  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${UNITS[unit]}`;
}

/** `43%`, and `<1%` for a share that is not quite nothing. */
export function formatShare(value: number): string {
  if (value === 0) return '0%';
  return value < 0.01 ? '<1%' : `${Math.round(value * 100)}%`;
}
