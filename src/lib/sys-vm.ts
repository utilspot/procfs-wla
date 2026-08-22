/**
 * Table of facts for the tunables in `/proc/sys/vm`, for the page that lists
 * that directory.
 *
 * `/proc/sys/vm` is the memory manager's control panel: three or four dozen
 * files, every one of them a **setting rather than a report** — writable, and
 * holding what the kernel has been told to do rather than what it has done.
 * That is the whole of what they have in common. Unlike `/proc/sys/user`, whose
 * twelve entries are one mechanism read one way, these are a dozen unrelated
 * mechanisms that happen to share a directory: a percentage of memory, a count
 * of pages, a bitmask, a mode, one that holds a word rather than a number, and
 * a few that do something when written and hold nothing worth reading.
 *
 * So this carries no parser. What a name in there *is* — which knob, of which
 * mechanism, in what units — is what a reader arriving at a directory of forty
 * one-word names does not have, and it is what {@link TUNABLES} says. The value
 * is one click away at the file's own page, where the bytes are shown as they
 * came; nothing here reads it.
 *
 * **A name this table does not carry is still listed**, as a file like any
 * other: the set differs by kernel version and by architecture — `mmap_rnd_bits`
 * is not on every machine, `hugetlb_optimize_vmemmap` arrived in 5.18,
 * `percpu_pagelist_fraction` became `percpu_pagelist_high_fraction` in 5.14 —
 * and a directory listing that hid what it had no facts for would be lying
 * about what is on the machine.
 */

/** What a tunable is set in, which is the column that keeps the rows honest. */
export type VmUnit =
  /** A percentage, 0 … 100 — or of another whole named in the line. */
  | 'percent'
  /** A count of bytes. */
  | 'bytes'
  /** A count of kibibytes, which is what most of the memory knobs take. */
  | 'kilobytes'
  /** A count of pages, or of objects the line names. */
  | 'count'
  /** Hundredths of a second, which is how the writeback timers are spelled. */
  | 'centisecs'
  /** Whole seconds. */
  | 'seconds'
  /** One of a small set of numbers, each meaning something different. */
  | 'mode'
  /** 0 or 1, and nothing else. */
  | 'toggle'
  /** Written to make something happen; what it holds is not the point. */
  | 'trigger'
  /** A word rather than a number, which one file in this directory holds. */
  | 'text';

/**
 * The areas of the memory manager these knobs belong to. A directory of forty
 * names sorted alphabetically puts `dirty_ratio` between `compact_memory` and
 * `drop_caches`, which are three different subsystems; grouped, the page reads
 * as the handful of mechanisms it actually is.
 *
 * The order is the order they are shown in, which is roughly how often a reader
 * has business with them.
 */
export const VM_GROUPS = [
  'Writeback',
  'Overcommit',
  'Reclaim and watermarks',
  'Huge pages',
  'Out of memory',
  'Address space and faults',
  'Counters and triggers',
] as const;

export type VmGroup = (typeof VM_GROUPS)[number];

export interface VmTunable {
  /** The file's name, which is also the last segment of its path. */
  name: string;
  group: VmGroup;
  /** What setting it is, in one line — the row is the whole of what is said. */
  sets: string;
  unit: VmUnit;
  /**
   * The other file that spells the same setting, for the three that come in
   * pairs. Writing either zeroes the other, so a 0 in one of them does not mean
   * the setting is off — it means the other spelling is the one in force, and a
   * page showing a bare `0` without saying so would be actively misleading.
   */
  pairedWith?: string;
  /**
   * What each value means, for a file that holds one of a small set rather than
   * an amount. Keyed by the value as the file spells it, so `numa_zonelist_order`
   * — which holds a word — is carried the same way as the numbered modes.
   */
  meanings?: Record<string, string>;
}

/**
 * The tunables this app has facts for, grouped by what they are part of and
 * within a group in the order they are worth reading rather than alphabetically
 * — the pair that spells a threshold as a ratio comes before the pair that
 * spells the same threshold in bytes, because the ratio is the one a machine is
 * usually on.
 *
 * Where two files are two spellings of one number, the line says so: writing
 * either of `dirty_ratio` and `dirty_bytes` zeroes the other, and so does the
 * `overcommit_ratio` and `overcommit_kbytes` pair. A reader who does not know
 * that reads a 0 as "off" rather than as "the other spelling is in force".
 */
export const TUNABLES: readonly VmTunable[] = [
  {
    name: 'dirty_ratio',
    group: 'Writeback',
    sets: 'how much of available memory may be dirty before a process that is writing is made to write back itself, rather than leaving it to the flusher threads',
    unit: 'percent',
    pairedWith: 'dirty_bytes',
  },
  {
    name: 'dirty_background_ratio',
    group: 'Writeback',
    sets: 'how much may be dirty before the flusher threads start writing in the background, which is the threshold a healthy machine sits under',
    unit: 'percent',
    pairedWith: 'dirty_background_bytes',
  },
  {
    name: 'dirty_bytes',
    group: 'Writeback',
    sets: 'the same threshold as an absolute amount instead of a share of memory; writing this zeroes dirty_ratio, and writing that zeroes this',
    unit: 'bytes',
    pairedWith: 'dirty_ratio',
  },
  {
    name: 'dirty_background_bytes',
    group: 'Writeback',
    sets: 'the background threshold as an absolute amount, paired with dirty_background_ratio the same way',
    unit: 'bytes',
    pairedWith: 'dirty_background_ratio',
  },
  {
    name: 'dirty_expire_centisecs',
    group: 'Writeback',
    sets: 'how old dirty data may get before the flusher threads write it out whatever the thresholds say',
    unit: 'centisecs',
  },
  {
    name: 'dirty_writeback_centisecs',
    group: 'Writeback',
    sets: 'how often the flusher threads wake up to look for expired data; 0 stops the periodic writeback entirely',
    unit: 'centisecs',
  },
  {
    name: 'dirtytime_expire_seconds',
    group: 'Writeback',
    sets: 'how long a lazytime inode may hold unwritten timestamps before they are flushed',
    unit: 'seconds',
  },
  {
    name: 'laptop_mode',
    group: 'Writeback',
    sets: 'how long after a disk spins up its writeback is batched with whatever else is waiting, so the disk can go back to sleep; 0 is off',
    unit: 'seconds',
  },
  {
    name: 'overcommit_memory',
    group: 'Overcommit',
    sets: 'how an allocation larger than the memory there is answered: 0 refuses only what is obviously absurd, 1 never refuses, 2 refuses past the CommitLimit',
    unit: 'mode',
    meanings: {
      '0': 'heuristic — a request is compared against total memory plus swap and the obvious overcommits are refused, which is what nearly every machine runs',
      '1': 'always overcommit — the kernel pretends there is enough until there actually is not, which is what a program that maps far more than it touches wants and what leaves the OOM killer to settle it',
      '2': 'never overcommit — the total committed may not pass the CommitLimit, so an allocation is refused while there is still memory rather than a process being killed later',
    },
  },
  {
    name: 'overcommit_ratio',
    group: 'Overcommit',
    sets: 'how much of RAM goes into the CommitLimit under mode 2, which is swap plus this share of RAM',
    unit: 'percent',
    pairedWith: 'overcommit_kbytes',
  },
  {
    name: 'overcommit_kbytes',
    group: 'Overcommit',
    sets: 'the same limit as an absolute amount of RAM rather than a share; writing this zeroes overcommit_ratio, and writing that zeroes this',
    unit: 'kilobytes',
    pairedWith: 'overcommit_ratio',
  },
  {
    name: 'admin_reserve_kbytes',
    group: 'Overcommit',
    sets: 'what is held back from the CommitLimit so that a privileged process is still able to start and repair the machine',
    unit: 'kilobytes',
  },
  {
    name: 'user_reserve_kbytes',
    group: 'Overcommit',
    sets: 'what is held back so that an unprivileged process cannot commit the whole limit to itself and leave nothing to recover with',
    unit: 'kilobytes',
  },
  {
    name: 'swappiness',
    group: 'Reclaim and watermarks',
    sets: 'how much the kernel prefers evicting anonymous pages to swap over dropping page cache; 0 is not "never swap", it is "only when reclaim is failing"',
    unit: 'count',
  },
  {
    name: 'vfs_cache_pressure',
    group: 'Reclaim and watermarks',
    sets: 'how hard the dentry and inode caches are reclaimed against the page cache, where 100 is even-handed and more is harder on them',
    unit: 'count',
  },
  {
    name: 'vfs_cache_pressure_denom',
    group: 'Reclaim and watermarks',
    sets: 'what that number is counted against — 100 by default, which is what makes it the percentage it has always been, and larger is how a pressure below one percent is spelled on a machine whose caches are worth keeping',
    unit: 'count',
  },
  {
    name: 'min_free_kbytes',
    group: 'Reclaim and watermarks',
    sets: 'the reserve the kernel keeps free per zone, from which all three watermarks are derived — the one number the rest of reclaim is scaled from',
    unit: 'kilobytes',
  },
  {
    name: 'watermark_scale_factor',
    group: 'Reclaim and watermarks',
    sets: 'how far apart those watermarks sit, in ten-thousandths of a zone, which is how much headroom reclaim is given before an allocation has to wait',
    unit: 'count',
  },
  {
    name: 'watermark_boost_factor',
    group: 'Reclaim and watermarks',
    sets: 'how far the watermarks are raised for a while after an allocation had to steal from another migrate type, so reclaim and compaction undo the fragmentation',
    unit: 'count',
  },
  {
    name: 'lowmem_reserve_ratio',
    group: 'Reclaim and watermarks',
    sets: 'how much of each zone is kept back from allocations that a higher zone could have satisfied — one value per zone, not a single number',
    unit: 'count',
  },
  {
    name: 'page-cluster',
    group: 'Reclaim and watermarks',
    sets: 'how many pages are read from swap around a fault, as a power of two, so 0 is one page and 3 is eight',
    unit: 'count',
  },
  {
    name: 'zone_reclaim_mode',
    group: 'Reclaim and watermarks',
    sets: 'whether a node reclaims its own memory before allocating from another one, and what it is willing to reclaim to do it — a mask, where 1 turns it on, 2 lets it write dirty pages out and 4 lets it swap; 0, which is the default, sends the allocation to another node instead',
    unit: 'mode',
  },
  {
    name: 'numa_zonelist_order',
    group: 'Reclaim and watermarks',
    sets: 'which way the fallback list is ordered when an allocation cannot be satisfied where it asked — kept only so that writing to it does not fail: node ordering is the one answer the kernel still accepts, and anything else is refused',
    unit: 'text',
    meanings: {
      Node: 'the fallback list runs through this node’s zones first and only then to another node, which since the zone ordering was removed is the only order there is',
    },
  },
  {
    name: 'min_unmapped_ratio',
    group: 'Reclaim and watermarks',
    sets: 'how much of a node must be unmapped page cache before that node-local reclaim is allowed to run at all',
    unit: 'percent',
  },
  {
    name: 'min_slab_ratio',
    group: 'Reclaim and watermarks',
    sets: 'how much of a node must be reclaimable slab before node-local reclaim will shrink it',
    unit: 'percent',
  },
  {
    name: 'compaction_proactiveness',
    group: 'Reclaim and watermarks',
    sets: 'how much work the kernel does compacting memory nobody has asked for yet, against the latency that work costs; 0 leaves compaction to allocations that need it',
    unit: 'count',
  },
  {
    name: 'extfrag_threshold',
    group: 'Reclaim and watermarks',
    sets: 'how fragmented a zone has to look before a high-order allocation compacts rather than reclaims',
    unit: 'count',
  },
  {
    name: 'defrag_mode',
    group: 'Reclaim and watermarks',
    sets: 'whether the allocator works harder to keep whole pageblocks to one migrate type, so that huge pages stay obtainable — worth turning on right after boot, since fragmentation once it has happened can be long-lasting or permanent',
    unit: 'toggle',
  },
  {
    name: 'compact_unevictable_allowed',
    group: 'Reclaim and watermarks',
    sets: 'whether compaction may move unevictable pages, which is cheaper for fragmentation and a source of latency for whoever mlocked them',
    unit: 'toggle',
  },
  {
    name: 'percpu_pagelist_high_fraction',
    group: 'Reclaim and watermarks',
    sets: 'how large each CPU may let its own list of free pages grow, as a fraction of a zone — the cache that keeps allocation off the zone lock',
    unit: 'count',
  },
  {
    name: 'nr_hugepages',
    group: 'Huge pages',
    sets: 'how many huge pages the static pool holds; writing it tries to grow or shrink the pool there and then, and a machine that has been up a while may not manage it',
    unit: 'count',
  },
  {
    name: 'nr_hugepages_mempolicy',
    group: 'Huge pages',
    sets: 'the same pool, sized according to the writing process’s NUMA policy rather than spread across every node',
    unit: 'count',
  },
  {
    name: 'nr_overcommit_hugepages',
    group: 'Huge pages',
    sets: 'how many huge pages beyond the pool may be conjured on demand and given back afterwards, which is what makes a surplus page',
    unit: 'count',
  },
  {
    name: 'movable_gigantic_pages',
    group: 'Huge pages',
    sets: 'whether a gigantic page may be taken from ZONE_MOVABLE, which is where a contiguous gigabyte is easiest to find and where it makes memory hot-remove unreliable — a removal can then wait indefinitely for somewhere to migrate to',
    unit: 'toggle',
  },
  {
    name: 'hugetlb_shm_group',
    group: 'Huge pages',
    sets: 'the group id allowed to create SHM_HUGETLB segments without CAP_IPC_LOCK',
    unit: 'count',
  },
  {
    name: 'hugetlb_optimize_vmemmap',
    group: 'Huge pages',
    sets: 'whether the page structures describing a huge page are folded away, which buys back most of their overhead and makes the pool slower to resize',
    unit: 'toggle',
  },
  {
    name: 'panic_on_oom',
    group: 'Out of memory',
    sets: 'whether running out of memory kills something or panics the machine: 0 kills, 1 panics unless the shortage is one cpuset’s or one policy’s, 2 always panics',
    unit: 'mode',
    meanings: {
      '0': 'the OOM killer picks a process and kills it, which is what a machine that is meant to stay up does',
      '1': 'the machine panics — except where the shortage belongs to one mempolicy or one cpuset rather than to the machine, and there a process is killed instead',
      '2': 'the machine panics whatever the shortage was confined to, which is what a cluster node with somewhere to fail over to is set to',
    },
  },
  {
    name: 'oom_kill_allocating_task',
    group: 'Out of memory',
    sets: 'whether the process that happened to ask is killed instead of the one the scan finds worst, which is cheaper and rather less fair',
    unit: 'toggle',
  },
  {
    name: 'oom_dump_tasks',
    group: 'Out of memory',
    sets: 'whether every process is dumped to the log with its memory when the killer runs — the table that says why it chose what it chose',
    unit: 'toggle',
  },
  {
    name: 'memory_failure_early_kill',
    group: 'Out of memory',
    sets: 'whether a process mapping a page the hardware has just reported as corrupt is killed at once, or only if it touches it',
    unit: 'toggle',
  },
  {
    name: 'memory_failure_recovery',
    group: 'Out of memory',
    sets: 'whether a machine check on a page is recovered from at all; 0 panics instead',
    unit: 'toggle',
  },
  {
    name: 'enable_soft_offline',
    group: 'Out of memory',
    sets: 'whether a page the hardware has reported a correctable error on is retired quietly, its contents moved somewhere sound first; 0 makes the attempt fail with EOPNOTSUPP and leaves the page in use',
    unit: 'toggle',
  },
  {
    name: 'max_map_count',
    group: 'Address space and faults',
    sets: 'how many separate mappings one process may have — the limit an allocator, a JVM heap or a program mapping many files runs into, and what mmap() returns ENOMEM for',
    unit: 'count',
  },
  {
    name: 'mmap_min_addr',
    group: 'Address space and faults',
    sets: 'the lowest address a process may map anything at, which is what stops a kernel null-pointer bug being turned into an exploit by mapping page zero',
    unit: 'bytes',
  },
  {
    name: 'mmap_rnd_bits',
    group: 'Address space and faults',
    sets: 'how many bits of randomness the mmap base gets, which is the strength of that half of ASLR',
    unit: 'count',
  },
  {
    name: 'mmap_rnd_compat_bits',
    group: 'Address space and faults',
    sets: 'the same, for a 32-bit process on a 64-bit kernel, where there are fewer bits to spend',
    unit: 'count',
  },
  {
    name: 'legacy_va_layout',
    group: 'Address space and faults',
    sets: 'whether new mappings grow up from a fixed low address the way they did before the flexible layout, which caps how far the heap can go',
    unit: 'toggle',
  },
  {
    name: 'unprivileged_userfaultfd',
    group: 'Address space and faults',
    sets: 'whether a process without CAP_SYS_PTRACE may handle its own page faults in user space — a live migration feature, and a way of holding a kernel fault open',
    unit: 'mode',
    meanings: {
      '0': 'an unprivileged caller is restricted to faults taken in user mode, which is the default and what closes the trick of holding a kernel fault open while something else races',
      '1': 'an unprivileged caller may use userfaultfd with no restriction',
    },
  },
  {
    name: 'memfd_noexec',
    group: 'Address space and faults',
    sets: 'what memfd_create() does for a caller that asked for neither MFD_EXEC nor MFD_NOEXEC_SEAL: 0 hands it an executable memfd, 1 a sealed non-executable one, 2 refuses the call — and it is per pid namespace, the most restrictive setting between here and the root being the one that applies',
    unit: 'mode',
    meanings: {
      '0': 'the call acts as though MFD_EXEC had been passed, which is how memfd_create() behaved before either flag existed',
      '1': 'it acts as though MFD_NOEXEC_SEAL had been passed: the memfd is non-executable and sealed that way, so old software gets the safe default and new software can still ask for MFD_EXEC',
      '2': 'a call that did not pass MFD_NOEXEC_SEAL is rejected outright',
    },
  },
  {
    name: 'page_lock_unfairness',
    group: 'Address space and faults',
    sets: 'how many times a waiter for a locked page may be jumped ahead of before the lock is handed straight to it, which is where waiting on a page under I/O stops being first come first served',
    unit: 'count',
  },
  {
    name: 'drop_caches',
    group: 'Counters and triggers',
    sets: 'writing 1 frees the page cache, 2 the dentries and inodes, 3 both — a non-destructive way of throwing away everything cached, and no way of finding out what was',
    unit: 'trigger',
    meanings: {
      '1': 'writing 1 frees the page cache',
      '2': 'writing 2 frees the reclaimable slab, which is the dentries and inodes',
      '3': 'writing 3 frees both',
    },
  },
  {
    name: 'compact_memory',
    group: 'Counters and triggers',
    sets: 'writing anything makes every zone compact itself, which is what a machine with plenty free and no huge page available needs',
    unit: 'trigger',
  },
  {
    name: 'stat_refresh',
    group: 'Counters and triggers',
    sets: 'reading it folds the per-CPU vm counters into the global ones first, so that /proc/vmstat is exact rather than a second stale',
    unit: 'trigger',
  },
  {
    name: 'stat_interval',
    group: 'Counters and triggers',
    sets: 'how often that folding happens on its own, which is why two reads of /proc/vmstat can disagree by less than this',
    unit: 'seconds',
  },
  {
    name: 'numa_stat',
    group: 'Counters and triggers',
    sets: 'whether the per-node hit and miss counters are kept up to date, which costs a little on every allocation and is what /proc/zoneinfo’s numa lines come from',
    unit: 'toggle',
  },
];

/** The tunable of this name, or undefined for a file this app has no facts for. */
export function tunableFor(name: string): VmTunable | undefined {
  return TUNABLES.find((tunable) => tunable.name === name);
}

/** The tunables of one group, in the order the table declares them. */
export function tunablesIn(group: VmGroup): readonly VmTunable[] {
  return TUNABLES.filter((tunable) => tunable.group === group);
}

/** How the unit column reads, which is a word rather than the tag above. */
export const UNIT_LABELS: Record<VmUnit, string> = {
  percent: '%',
  bytes: 'bytes',
  kilobytes: 'kB',
  count: 'number',
  centisecs: '1/100 s',
  seconds: 'seconds',
  mode: 'mode',
  toggle: '0 or 1',
  trigger: 'write-only',
  text: 'word',
};

/** The capability a writer needs, which for the whole of `/proc/sys/vm` is one. */
export const WRITE_CAPABILITY = 'CAP_SYS_ADMIN';

/**
 * What one of these files holds, read as far as anything here can read it.
 *
 * There is no one format: most hold a single whole number, `lowmem_reserve_ratio`
 * holds one per zone, and `numa_zonelist_order` holds a word. So this keeps the
 * **tokens as they were written** and says whether they were all numbers — a
 * page that has to show a value it cannot place is better off showing what came
 * than showing nothing.
 */
export interface VmValue {
  /** The line as read, trimmed, which is what is shown when nothing else fits. */
  raw: string;
  /** The whitespace-separated fields of it, which is one for nearly every file. */
  fields: string[];
  /** Those fields as numbers, or null where any of them is not one. */
  numbers: number[] | null;
  /** Whether the file ended with the newline the kernel writes after it. */
  terminated: boolean;
}

/** A whole number, which is what all but two of these files hold. */
const NUMBER = /^-?\d+$/;

/**
 * Reads the first non-empty line of the file, or null for a file with nothing
 * in it — which under `/proc/sys` means the read failed rather than that the
 * setting is empty.
 */
export function parseTunable(text: string): VmValue | null {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '');
  if (line === undefined) return null;

  const raw = line.trim();
  const fields = raw.split(/\s+/);
  const numbers = fields.every((field) => NUMBER.test(field))
    ? fields.map(Number).filter((value) => Number.isSafeInteger(value))
    : null;

  return {
    raw,
    fields,
    // A field that is a number too large to be one exactly is not a number this
    // will do arithmetic on, so the whole reading falls back to the text.
    numbers: numbers !== null && numbers.length === fields.length ? numbers : null,
    terminated: text.endsWith('\n'),
  };
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** `8 MiB` — the amounts here are round binary figures nearly every time. */
export function formatBytes(value: number): string {
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? size : size.toFixed(Number.isInteger(size) ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

/** `30 s`, `12 h` — for the timers, which are spelled in seconds or in tenths. */
export function formatDuration(seconds: number): string {
  if (seconds === 0) return '0 s';
  if (seconds < 60) return `${Number(seconds.toFixed(2))} s`;
  if (seconds < 3600) return `${Number((seconds / 60).toFixed(1))} min`;
  if (seconds < 86400) return `${Number((seconds / 3600).toFixed(1))} h`;
  return `${Number((seconds / 86400).toFixed(1))} d`;
}

/**
 * The value in the unit its file is counted in: `20%`, `8 MiB`, `30 s`.
 *
 * Only where the reading is **one number and the unit is an amount**. A mode is
 * a number that means something rather than measures something, a mask is not a
 * quantity either, and `lowmem_reserve_ratio` is a list — those are shown as
 * they were written, and what they mean is {@link meaningOf} and the file's own
 * line.
 */
export function formatTunable(tunable: VmTunable, value: VmValue): string {
  const numbers = value.numbers;
  if (numbers === null || numbers.length !== 1) return value.raw;

  const number = numbers[0]!;

  switch (tunable.unit) {
    case 'percent':
      return `${number}%`;
    case 'bytes':
      return number === 0 ? '0' : `${formatBytes(number)}`;
    case 'kilobytes':
      return number === 0 ? '0' : `${formatBytes(number * 1024)}`;
    case 'centisecs':
      return number === 0 ? '0' : formatDuration(number / 100);
    case 'seconds':
      return number === 0 ? '0' : formatDuration(number);
    case 'toggle':
      return number === 0 ? 'off' : 'on';
    case 'count':
    case 'mode':
    case 'trigger':
    case 'text':
      return number.toLocaleString('en-US');
  }
}

/** What this reading means, for a file whose values are a set rather than a scale. */
export function meaningOf(tunable: VmTunable, value: VmValue): string | undefined {
  return tunable.meanings?.[value.raw];
}

/**
 * Whether this reading is the **0 that means the other spelling is in force**
 * rather than the 0 that means off: `dirty_ratio` reads 0 on a machine where
 * `dirty_bytes` was written, and the setting is very much on.
 */
export function isDeferredToPair(tunable: VmTunable, value: VmValue): boolean {
  return tunable.pairedWith !== undefined && value.numbers?.length === 1 && value.numbers[0] === 0;
}

/** Whether reading this file is beside the point: it is written, not read. */
export function isTrigger(tunable: VmTunable): boolean {
  return tunable.unit === 'trigger';
}

/** The units whose reading is a different figure rather than the same one dressed. */
const RESCALED: readonly VmUnit[] = ['bytes', 'kilobytes', 'centisecs', 'seconds', 'toggle'];

/**
 * Whether {@link formatTunable} restates the value in another scale — `3000`
 * read as `30 s`, `67584` read as `66 MiB`, `0` read as `off` — in which case
 * the figure the kernel prints is worth showing beside it, since that is what
 * has to be written back. A percentage read as `20%` is the same figure with a
 * sign on it, and showing `20` beside it would say nothing.
 */
export function isRescaled(tunable: VmTunable): boolean {
  return RESCALED.includes(tunable.unit);
}
