/**
 * Parser for `/proc/<pid>/auxv` — the auxiliary vector, which is what the
 * kernel told the C library about the machine as this program was exec'd.
 *
 * **This is the one entry here that is not text.** It is an array of pairs of
 * native words — a type and a value — ending at a pair of zeros, `AT_NULL`:
 *
 *   21 00 00 00 00 00 00 00  00 90 3f 8d fd 7f 00 00
 *   ^ AT_SYSINFO_EHDR        ^ 0x7ffd8d3f9000
 *
 * so it arrives as bytes and is read as bytes; see `readFileBytes`. `cat` on
 * this file prints rubbish, and any tool that decodes it as characters has
 * already lost the pointers in it.
 *
 * Four things read wrong at first glance.
 *
 * **The word size is the process's, not the kernel's.** A 32-bit program on a
 * 64-bit kernel has four-byte words here, so nothing about the layout can be
 * assumed from the machine — {@link detectLayout} works it out from the bytes.
 *
 * **It is a snapshot from `execve`, not a live reading.** The kernel wrote
 * these pairs onto the new stack as the program was loaded and kept a copy in
 * `mm->saved_auxv`, which is what this file reads. Nothing updates it
 * afterwards, so `AT_UID` is the uid the process exec'd with — a process that
 * has since called `setuid()` still shows the old one, and that is the file
 * being accurate about a different moment rather than being stale.
 *
 * **Several values are addresses, not data.** `AT_EXECFN` is a pointer to the
 * pathname on the process's own stack, not the pathname; `AT_RANDOM` points at
 * sixteen random bytes the C library seeds its stack canary from. Following one
 * needs `/proc/<pid>/mem` and the right to read it.
 *
 * **Reading it is a `ptrace`-level right.** `proc_pid_auxv` checks
 * `PTRACE_MODE_READ_FSCREDS`, so another user's process answers `EPERM` rather
 * than an empty file. An *empty* file is a different thing: a process with no
 * `mm` — a kernel thread, or a zombie — has no vector to show.
 */

/** How wide a word is in the process this file belongs to. */
export type WordSize = 4 | 8;

export type Endian = 'little' | 'big';

export interface Layout {
  words: WordSize;
  endian: Endian;
}

export interface AuxEntry {
  /** The `AT_*` number. */
  type: number;
  /** Its value, as a 64-bit word even where the process's are 32. */
  value: bigint;
  /** Where the pair starts in the file, for the raw view beside it. */
  offset: number;
}

export interface Auxv {
  /** Bytes the file held. */
  bytes: number;
  /** The layout the pairs were read with, or null where none fitted. */
  layout: Layout | null;
  /** The pairs before `AT_NULL`, in file order. */
  entries: AuxEntry[];
  /** Whether the `AT_NULL` pair that ends the vector was found. */
  terminated: boolean;
  /** Bytes after that pair, which a whole vector has none of. */
  trailing: number;
}

/**
 * The layouts to try, likeliest first. Every machine this app is likely to meet
 * is little-endian; the other two are here because the file is the process's
 * own byte order and s390x and some POWER builds are big-endian, and guessing
 * would turn one of those into nonsense rather than into an error.
 */
const LAYOUTS: readonly Layout[] = [
  { words: 8, endian: 'little' },
  { words: 4, endian: 'little' },
  { words: 8, endian: 'big' },
  { words: 4, endian: 'big' },
];

/**
 * The largest `AT_*` the kernel allocates, with room above it. Types are small
 * and values are not, which is the whole of how a layout is told from a wrong
 * one: read with the wrong word size or the wrong byte order, a pointer lands
 * where a type should be and fails this at once.
 */
const MAX_TYPE = 256;

/** Reads one word at `offset`, as the given layout spells one. */
function wordAt(view: DataView, offset: number, layout: Layout): bigint {
  const little = layout.endian === 'little';

  return layout.words === 8
    ? view.getBigUint64(offset, little)
    : BigInt(view.getUint32(offset, little));
}

/** Reads the pairs under one layout, stopping at `AT_NULL`. */
function readWith(bytes: Uint8Array, layout: Layout): Auxv {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pair = layout.words * 2;
  const entries: AuxEntry[] = [];

  for (let offset = 0; offset + pair <= bytes.byteLength; offset += pair) {
    const type = wordAt(view, offset, layout);
    const value = wordAt(view, offset + layout.words, layout);

    // AT_NULL ends the vector, and anything past it is not part of it.
    if (type === 0n && value === 0n) {
      return {
        bytes: bytes.byteLength,
        layout,
        entries,
        terminated: true,
        trailing: bytes.byteLength - (offset + pair),
      };
    }

    entries.push({ type: Number(type), value, offset });
  }

  return {
    bytes: bytes.byteLength,
    layout,
    entries,
    terminated: false,
    trailing: 0,
  };
}

/** Whether reading the file this way produced a vector rather than noise. */
function fits(auxv: Auxv): boolean {
  return (
    auxv.terminated &&
    auxv.trailing === 0 &&
    auxv.entries.every((entry) => entry.type < MAX_TYPE)
  );
}

/**
 * The layout this file is written in, or null where none of the four fits.
 *
 * There is nothing in the file that says: it is the process's own memory, in
 * the process's own word size and byte order, so the only way to know is to
 * read it each way and see which one comes out as a vector. A wrong guess is
 * loud rather than quiet — a pointer read as a type is enormous, and the
 * terminator lands in the middle of a pair — which is what makes this safe.
 */
export function detectLayout(bytes: Uint8Array): Layout | null {
  return LAYOUTS.find((layout) => fits(readWith(bytes, layout))) ?? null;
}

export function parseAuxv(bytes: Uint8Array): Auxv {
  const layout = detectLayout(bytes);

  if (layout === null) {
    return {
      bytes: bytes.byteLength,
      layout: null,
      entries: [],
      terminated: false,
      trailing: 0,
    };
  }

  return readWith(bytes, layout);
}

/** Whether the process had no vector to show: a kernel thread, or a zombie. */
export function isEmpty(auxv: Auxv): boolean {
  return auxv.bytes === 0;
}

/** Whether there are bytes here that are not a vector in any layout. */
export function isUnreadable(auxv: Auxv): boolean {
  return auxv.layout === null && !isEmpty(auxv);
}

/** How a value is worth showing, which differs more than the numbers do. */
export type Format = 'address' | 'number' | 'flags' | 'boolean' | 'pointer-to-string';

interface KnownType {
  /** The constant as `include/uapi/linux/auxvec.h` spells it. */
  name: string;
  format: Format;
  description: string;
}

/**
 * The `AT_*` numbers, from `include/uapi/linux/auxvec.h` and the arch headers
 * that extend it. Keyed by number, because the number is what is in the file
 * and the name is what this page is for.
 */
const KNOWN: Record<number, KnownType> = {
  0: { name: 'AT_NULL', format: 'number', description: 'ends the vector — the pair of zeros this file stops at' },
  1: { name: 'AT_IGNORE', format: 'number', description: 'a pair to skip over, left where one was removed' },
  2: {
    name: 'AT_EXECFD',
    format: 'number',
    description: 'a file descriptor already open on the program, for a loader that could not be given a path',
  },
  3: {
    name: 'AT_PHDR',
    format: 'address',
    description: 'where the program headers are in this process — the table the dynamic loader walks to find everything else',
  },
  4: { name: 'AT_PHENT', format: 'number', description: 'the size of one program header, 56 bytes on a 64-bit ELF' },
  5: { name: 'AT_PHNUM', format: 'number', description: 'how many of them there are' },
  6: {
    name: 'AT_PAGESZ',
    format: 'number',
    description: 'the page size, which is where getpagesize() and sysconf(_SC_PAGESIZE) get their answer without a system call',
  },
  7: {
    name: 'AT_BASE',
    format: 'address',
    description: 'where the dynamic loader itself was mapped — 0 for a static binary, which has none',
  },
  8: { name: 'AT_FLAGS', format: 'flags', description: 'flags, unused on every architecture Linux runs on today' },
  9: { name: 'AT_ENTRY', format: 'address', description: 'the program’s entry point, which the loader jumps to when it has finished' },
  10: { name: 'AT_NOTELF', format: 'boolean', description: 'set where the thing being run is not an ELF file' },
  11: { name: 'AT_UID', format: 'number', description: 'the real uid — as it was at exec, not as it is now' },
  12: { name: 'AT_EUID', format: 'number', description: 'the effective uid at exec, which is what a set-uid binary changed' },
  13: { name: 'AT_GID', format: 'number', description: 'the real gid at exec' },
  14: { name: 'AT_EGID', format: 'number', description: 'the effective gid at exec' },
  15: {
    name: 'AT_PLATFORM',
    format: 'pointer-to-string',
    description: 'a pointer to a string naming the CPU, which the loader uses to pick an optimised library path',
  },
  16: {
    name: 'AT_HWCAP',
    format: 'flags',
    description: 'a bitmask of what this CPU can do, read per architecture — how a library picks an AVX or NEON routine without asking the CPU itself',
  },
  17: { name: 'AT_CLKTCK', format: 'number', description: 'how many times a second times() counts, which is what sysconf(_SC_CLK_TCK) returns' },
  18: { name: 'AT_FPUCW', format: 'flags', description: 'the FPU control word, PowerPC only' },
  19: { name: 'AT_DCACHEBSIZE', format: 'number', description: 'data cache block size, PowerPC only' },
  20: { name: 'AT_ICACHEBSIZE', format: 'number', description: 'instruction cache block size, PowerPC only' },
  21: { name: 'AT_UCACHEBSIZE', format: 'number', description: 'unified cache block size, PowerPC only' },
  22: { name: 'AT_IGNOREPPC', format: 'number', description: 'a pair PowerPC leaves for alignment' },
  23: {
    name: 'AT_SECURE',
    format: 'boolean',
    description: 'set where the program gained privilege at exec — set-uid, set-gid, or file capabilities. The C library drops LD_PRELOAD and its like when this is 1',
  },
  24: { name: 'AT_BASE_PLATFORM', format: 'pointer-to-string', description: 'a pointer to the name of the real CPU, where AT_PLATFORM names an emulated one' },
  25: {
    name: 'AT_RANDOM',
    format: 'address',
    description: 'a pointer to sixteen random bytes the kernel put on the stack — where the C library’s stack canary and pointer guard come from',
  },
  26: { name: 'AT_HWCAP2', format: 'flags', description: 'more capability bits, because the first word filled up' },
  27: { name: 'AT_RSEQ_FEATURE_SIZE', format: 'number', description: 'how much of the restartable-sequences structure this kernel supports' },
  28: { name: 'AT_RSEQ_ALIGN', format: 'number', description: 'what that structure has to be aligned to' },
  29: { name: 'AT_HWCAP3', format: 'flags', description: 'a third word of capability bits' },
  30: { name: 'AT_HWCAP4', format: 'flags', description: 'a fourth' },
  31: {
    name: 'AT_EXECFN',
    format: 'pointer-to-string',
    description: 'a pointer to the pathname this program was exec’d with, at the very top of the stack — the string itself is not here',
  },
  32: { name: 'AT_SYSINFO', format: 'address', description: 'the entry point for a fast system call, on 32-bit x86' },
  33: {
    name: 'AT_SYSINFO_EHDR',
    format: 'address',
    description: 'where the vDSO was mapped — the small ELF object the kernel puts in every process so gettimeofday() need not enter the kernel. This is what ldd shows as linux-vdso.so.1',
  },
  34: { name: 'AT_L1I_CACHESHAPE', format: 'flags', description: 'L1 instruction cache shape, on the architectures that report one' },
  35: { name: 'AT_L1D_CACHESHAPE', format: 'flags', description: 'L1 data cache shape' },
  36: { name: 'AT_L2_CACHESHAPE', format: 'flags', description: 'L2 cache shape' },
  37: { name: 'AT_L3_CACHESHAPE', format: 'flags', description: 'L3 cache shape' },
  40: { name: 'AT_L1I_CACHESIZE', format: 'number', description: 'L1 instruction cache size' },
  41: { name: 'AT_L1I_CACHEGEOMETRY', format: 'flags', description: 'its line size and associativity' },
  42: { name: 'AT_L1D_CACHESIZE', format: 'number', description: 'L1 data cache size' },
  43: { name: 'AT_L1D_CACHEGEOMETRY', format: 'flags', description: 'its line size and associativity' },
  44: { name: 'AT_L2_CACHESIZE', format: 'number', description: 'L2 cache size' },
  45: { name: 'AT_L2_CACHEGEOMETRY', format: 'flags', description: 'its line size and associativity' },
  46: { name: 'AT_L3_CACHESIZE', format: 'number', description: 'L3 cache size' },
  47: { name: 'AT_L3_CACHEGEOMETRY', format: 'flags', description: 'its line size and associativity' },
  51: {
    name: 'AT_MINSIGSTKSZ',
    format: 'number',
    description: 'the smallest signal stack this CPU can actually deliver a signal on, which grew past the old SIGSTKSZ constant once CPUs gained wider register state',
  },
};

/** The `AT_*` name for a number, or null for one this page does not know. */
export function nameFor(type: number): string | null {
  return KNOWN[type]?.name ?? null;
}

/** What the entry is for, or null for a number not known here. */
export function describeType(type: number): string | null {
  return KNOWN[type]?.description ?? null;
}

/** How this entry's value is worth showing. Unknown numbers get plain hex. */
export function formatOf(type: number): Format {
  return KNOWN[type]?.format ?? 'address';
}

/** An entry under a number this page has no name for: newer, or arch-specific. */
export function isUnknown(entry: AuxEntry): boolean {
  return KNOWN[entry.type] === undefined;
}

/** The entry of one type, or null where the vector has none. */
export function entryFor(auxv: Auxv, type: number): AuxEntry | null {
  return auxv.entries.find((entry) => entry.type === type) ?? null;
}

/** The value of one type, or null where the vector has none. */
export function valueOf(auxv: Auxv, type: number): bigint | null {
  return entryFor(auxv, type)?.value ?? null;
}

/** The value as it is worth reading: `0x7ffd8d3f9000`, `4096`, `yes`. */
export function formatValue(entry: AuxEntry): string {
  switch (formatOf(entry.type)) {
    case 'number':
      return entry.value.toString(10);
    case 'boolean':
      return entry.value === 0n ? 'no' : 'yes';
    default:
      return `0x${entry.value.toString(16)}`;
  }
}

/** `AT_SECURE`: whether the program gained privilege as it was exec'd. */
export const AT_SECURE = 23;

/** `AT_BASE`: where the dynamic loader is, and 0 where there is none. */
export const AT_BASE = 7;

/** `AT_PAGESZ`, `AT_SYSINFO_EHDR`, and the ids — the ones a page speaks about. */
export const AT_PAGESZ = 6;
export const AT_SYSINFO_EHDR = 33;
export const AT_UID = 11;
export const AT_EUID = 12;

/**
 * Whether the C library will treat this process as privileged: it drops
 * `LD_PRELOAD`, `LD_LIBRARY_PATH` and the rest of the environment's hooks when
 * `AT_SECURE` is set, which is the whole reason a set-uid binary cannot be made
 * to load a library of your choosing.
 */
export function isSecure(auxv: Auxv): boolean {
  return valueOf(auxv, AT_SECURE) === 1n;
}

/**
 * Whether this program was linked statically — `AT_BASE` is where the dynamic
 * loader was mapped, and a program with no loader has nothing to put there.
 */
export function isStatic(auxv: Auxv): boolean {
  const base = valueOf(auxv, AT_BASE);
  return base === 0n || (base === null && auxv.entries.length > 0);
}

/** The page size the C library will report without asking the kernel. */
export function pageSize(auxv: Auxv): number | null {
  const size = valueOf(auxv, AT_PAGESZ);
  return size === null ? null : Number(size);
}

/** Whether the real and effective ids differ, i.e. exec changed who this is. */
export function gainedPrivilege(auxv: Auxv): boolean {
  const uid = valueOf(auxv, AT_UID);
  const euid = valueOf(auxv, AT_EUID);
  return uid !== null && euid !== null && uid !== euid;
}
