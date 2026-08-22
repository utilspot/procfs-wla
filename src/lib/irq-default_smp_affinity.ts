/**
 * Parser for `/proc/irq/default_smp_affinity` — the CPU mask an interrupt is
 * handed when it is first set up.
 *
 * One line, a hex bitmask, and that is the whole file:
 *
 *   f
 *
 * or, on a machine with more CPU slots than a group holds:
 *
 *   ffffffff,ffffffff,ffffffff
 *
 * `default_affinity_show` in `kernel/irq/proc.c` prints it with `%*pb` over
 * `nr_cpu_ids` bits, which is `bitmap_string` in `lib/vsprintf.c`: **32 bits to
 * a group, most significant group first**, each group zero-padded to the hex
 * digits it needs. So the rightmost group holds CPUs 0-31, the one before it
 * 32-63, and the leftmost group is the one that may be narrower than eight
 * digits. There is a trailing newline, unlike `wchan` or `sessionid`.
 *
 * Four things about the file read wrong at first glance.
 *
 * **It is a default, not a control.** Nothing that already has an interrupt is
 * affected by what is here: `irq_setup_affinity` copies this mask into a
 * descriptor when that interrupt is first requested, and from then on the
 * descriptor's own copy is what counts — `/proc/irq/<N>/smp_affinity`. On a
 * booted machine nearly every interrupt already exists, so writing here changes
 * nothing visible until a driver is loaded or a device is plugged in.
 *
 * **The width is `nr_cpu_ids`, not the CPUs that are online.** The kernel
 * prints as many bits as it has CPU slots, so the number of hex digits says how
 * big the machine could be rather than how big it is. See {@link slotRange}.
 *
 * **A mask naming no online CPU is not an error.** `irq_setup_affinity`
 * intersects it with `cpu_online_mask` and falls back to every online CPU when
 * nothing is left, so a file holding `0` reads as "none" and behaves as "all".
 *
 * **Managed interrupts ignore it.** A multi-queue device — NVMe, a modern NIC —
 * gets affinities the kernel spreads across the CPUs itself, and neither this
 * file nor a write to `smp_affinity` can move them; that write answers `EIO`.
 *
 * The file exists on `CONFIG_SMP` kernels only, is mode 0600 so root alone can
 * read it, and — unlike a per-interrupt affinity, which has `smp_affinity_list`
 * beside it — has no list spelling at all. The hex is the only form there is,
 * which is why {@link cpuList} builds the other one here.
 */

/** `f`, `03`, `ffffffff,ffffffff` — hex groups with commas between them. */
const MASK = /^[0-9a-f]+(?:,[0-9a-f]+)*$/i;

/** Hex digits in a full group, which is the 32 bits `bitmap_string` chunks by. */
export const CHUNK_DIGITS = 8;

export interface DefaultAffinity {
  /** The file exactly as it was read. */
  raw: string;
  /** What it held, with the newline off. */
  value: string;
  /** Whether that is a mask this file could hold at all. */
  readable: boolean;
  /** The groups as written, most significant first. Empty when unreadable. */
  groups: string[];
  /** Hex digits across every group, which is what {@link slotRange} reads. */
  digits: number;
  /** Bits the mask spells out, i.e. four per digit. */
  slots: number;
  /** The CPUs it names, ascending. */
  cpus: number[];
  /** Whether every bit the mask spells is set. See {@link isDefault}. */
  full: boolean;
  /** Whether it names no CPU at all. */
  none: boolean;
  /**
   * Whether every group but the leftmost is a full 32-bit chunk, which is the
   * only shape the kernel writes. False says something reformatted the file.
   */
  chunked: boolean;
  /** Whether the file ended with a newline. The kernel writes one. */
  terminated: boolean;
  /** Bytes the file held. */
  bytes: number;
}

/** The CPUs a group of hex digits names, given where the groups start. */
function cpusIn(groups: readonly string[]): number[] {
  const cpus: number[] = [];
  // Bit 0 is the last digit of the last group, so the walk starts from the end
  // and counts up — which is what leaves the result ascending.
  let bit = 0;

  for (let group = groups.length - 1; group >= 0; group -= 1) {
    const digits = groups[group]!;

    for (let digit = digits.length - 1; digit >= 0; digit -= 1) {
      const nibble = Number.parseInt(digits[digit]!, 16);
      for (let offset = 0; offset < 4; offset += 1) {
        if ((nibble & (1 << offset)) !== 0) cpus.push(bit + offset);
      }
      bit += 4;
    }
  }

  return cpus;
}

export function parseDefaultAffinity(text: string): DefaultAffinity {
  const bytes = new TextEncoder().encode(text).length;
  const terminated = text.endsWith('\n');
  const value = text.trim();
  const readable = MASK.test(value);
  const groups = readable ? value.split(',') : [];
  const digits = groups.reduce((total, group) => total + group.length, 0);
  const cpus = cpusIn(groups);

  return {
    raw: text,
    value,
    readable,
    groups,
    digits,
    slots: digits * 4,
    cpus,
    full: readable && groups.every((group) => /^f+$/i.test(group)),
    none: readable && cpus.length === 0,
    chunked: groups.slice(1).every((group) => group.length === CHUNK_DIGITS),
    terminated,
    bytes,
  };
}

/** Whether there is nothing in the file at all. */
export function isEmpty(affinity: DefaultAffinity): boolean {
  return affinity.value === '';
}

/** Whether it held something that is not a mask the kernel would print. */
export function isUnreadable(affinity: DefaultAffinity): boolean {
  return !affinity.readable && !isEmpty(affinity);
}

/**
 * How many CPU slots the kernel has, as far as the width can say: the mask is
 * printed over `nr_cpu_ids` bits, rounded up to a whole hex digit, so a file
 * four digits wide was printed by a kernel with 13 to 16 of them.
 *
 * The lower bound is the useful half. A mask three groups wide is a machine
 * with room for ninety-odd CPUs whatever else is true of it — and it is *room*,
 * not CPUs that are online: `nr_cpu_ids` counts the slots the kernel booted
 * with, and a hotplugged-off CPU still has one.
 */
export function slotRange(affinity: DefaultAffinity): { min: number; max: number } {
  return { min: Math.max(affinity.slots - 3, 1), max: affinity.slots };
}

/**
 * Whether this is the mask a kernel starts with, as far as the file can say:
 * `init_irq_default_affinity` sets every bit unless `irqaffinity=` said
 * otherwise, so a mask with every bit set is one nothing has narrowed.
 *
 * "As far as it can say" is the caveat, and it is a real one. Where
 * `nr_cpu_ids` is not a multiple of four the top digit is printed with bits
 * above it that no CPU owns — a 33-slot machine prints `1,ffffffff` with every
 * CPU set — so a top group that is not all `f` may still be every CPU there is.
 * {@link DefaultAffinity.cpus} is what to show; this only claims the easy case.
 */
export function isDefault(affinity: DefaultAffinity): boolean {
  return affinity.full;
}

/**
 * Whether a mask that is not all `f` could still be every CPU the kernel has:
 * it runs unbroken from CPU 0 and stops inside the top hex digit.
 *
 * That is exactly the shape an `nr_cpu_ids` which is not a multiple of four
 * produces. A kernel with 33 slots prints its untouched default as
 * `1,ffffffff` — the three bits above CPU 32 belong to no CPU and are printed
 * as zeroes — so calling that mask narrowed would be reading padding as intent.
 * The file cannot settle it either way, which is why this is `could`.
 */
export function couldBeAll(affinity: DefaultAffinity): boolean {
  if (affinity.full || affinity.none) return false;

  // Unbroken from zero, and short of the width by less than one hex digit.
  const highest = affinity.cpus.at(-1)!;
  return affinity.cpus.length === highest + 1 && affinity.slots - affinity.cpus.length <= 3;
}

/** One 32-bit chunk of the mask, and the CPUs it covers. */
export interface Group {
  /** The hex digits as written. */
  digits: string;
  /** Lowest CPU this group covers, which is 0 for the last one. */
  first: number;
  /** Highest CPU it covers, i.e. four per digit. */
  last: number;
  /** Whether it names any CPU at all. */
  set: boolean;
}

/**
 * The groups with the CPUs each one covers, in the order they are written —
 * most significant first, so the *last* group is the one holding CPU 0.
 *
 * That order is the thing about the format worth showing rather than saying:
 * `ffffffff,ffffffff,ffffffff` reads left to right as CPUs 95-64, 63-32, 31-0.
 */
export function groupsOf(affinity: DefaultAffinity): Group[] {
  const groups: Group[] = [];
  let bit = 0;

  for (let index = affinity.groups.length - 1; index >= 0; index -= 1) {
    const digits = affinity.groups[index]!;
    const width = digits.length * 4;
    groups.unshift({ digits, first: bit, last: bit + width - 1, set: /[^0]/.test(digits) });
    bit += width;
  }

  return groups;
}

/**
 * The mask as a CPU list — `0-3`, `0-1,8` — which is the spelling
 * `/proc/irq/<N>/smp_affinity_list` has and this file does not.
 */
export function cpuList(cpus: readonly number[]): string {
  const ranges: string[] = [];

  for (let index = 0; index < cpus.length; ) {
    const first = cpus[index]!;
    let last = first;
    while (index + 1 < cpus.length && cpus[index + 1] === last + 1) {
      index += 1;
      last = cpus[index]!;
    }
    ranges.push(first === last ? String(first) : `${first}-${last}`);
    index += 1;
  }

  return ranges.join(',');
}
