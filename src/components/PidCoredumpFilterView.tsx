import { useMemo } from 'react';
import {
  againstDefault,
  beyondDefault,
  DEFAULT_MASK,
  filterMask,
  FILTER_BITS,
  formatMask,
  headersRedundant,
  isDefault,
  isEmpty,
  isEverything,
  isNothing,
  isUnreadable,
  missingFromDefault,
  parseCoredumpFilter,
  roundTrip,
  setBits,
  SHIFT,
  unsymbolisable,
  WIDTH,
  type BitState,
  type CoredumpFilter,
} from '../lib/pid-coredump_filter';

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide === true ? 'stat dump__stat--wide' : 'stat'}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** How the filter stands against the one every process starts with. */
const STANDING: Record<ReturnType<typeof againstDefault>, string> = {
  default: 'the kernel default',
  narrower: 'narrower',
  wider: 'wider',
  different: 'neither',
};

/** The bits named in a sentence: `anonymous private, ELF headers…`. */
function listOf(bits: readonly BitState[]): string {
  return bits.map((bit) => bit.what).join(', ');
}

/**
 * The number as the digits it is, with the nine bits under it — because the
 * whole of reading this file is knowing that `33` is bits 0, 1, 4 and 5 rather
 * than a number worth thirty-three of something.
 */
function Bits({ filter }: { filter: CoredumpFilter }) {
  return (
    <div className="card dump">
      <table className="mounts__table dump__table" aria-label="Core dump filter bits">
        <thead>
          <tr>
            <th scope="col">Bit</th>
            <th scope="col">In the core</th>
            <th scope="col">What it is</th>
          </tr>
        </thead>
        <tbody>
          {filter.bits.map((bit) => (
            <tr className={bit.set ? 'dump__row dump__row--set' : 'dump__row'} key={bit.bit}>
              <th scope="row" className="dump__bit">
                <span className="dump__index">{bit.bit}</span>
                <code className="dump__hex">{formatMask(bit.mask)}</code>
              </th>
              <td className="dump__state">
                <span className={bit.set ? 'chip dump__on' : 'chip muted'}>
                  {bit.set ? 'dumped' : 'left out'}
                </span>
                {bit.standard && (
                  <span className="chip muted" title="Set by MMF_DUMP_FILTER_DEFAULT">
                    default
                  </span>
                )}
              </td>
              <td className="dump__what">
                <span className="dump__mapping">{bit.what}</span>{' '}
                <code className="dump__flag muted">{bit.flag}</code>
                <span className="dump__note muted">{bit.note}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One number, and the five things it is read wrong for: it does not decide
 * whether there is a core, it is hex a write reads as octal, bit 4 does nothing
 * behind bit 2, a write cannot reach past the nine, and it is inherited rather
 * than set.
 */
export function PidCoredumpFilterView({ content }: { content: string }) {
  const filter = useMemo(() => parseCoredumpFilter(content), [content]);
  const set = useMemo(() => setBits(filter), [filter]);
  const back = useMemo(() => roundTrip(filter), [filter]);
  const standing = againstDefault(filter);

  const note = (
    <p className="disks__note muted">
      These nine bits decide <strong>what goes into a core file, not whether there is one</strong>.{' '}
      <code>RLIMIT_CORE</code> decides that, <code>/proc/sys/kernel/core_pattern</code> decides
      where it goes — or which program it is piped to — and <code>MMF_DUMPABLE</code>, which{' '}
      <code>/proc/sys/fs/suid_dumpable</code> and a change of credentials both move, decides whether
      one is allowed at all. The kernel prints{' '}
      <code>(mm-&gt;flags &amp; MMF_DUMP_FILTER_MASK) &gt;&gt; {SHIFT}</code> with{' '}
      <code>%0{WIDTH}lx</code>: the shift is there because the two bits below the filter are the
      dumpable ones, which is why bit 0 here is <code>MMF_DUMP_ANON_PRIVATE = {SHIFT}</code> there.
      The value is <strong>inherited</strong> — <code>mm_init</code> copies{' '}
      <code>MMF_INIT_MASK</code> from the parent and <code>execve</code> builds the new{' '}
      <code>mm</code> the same way — so writing your shell&rsquo;s filter is how you set it for a
      program that has not started yet, and it survives the <code>exec</code> that starts it. A
      write is parsed with <code>kstrtouint(…, 0, …)</code>, so <code>0x3f</code> and <code>63</code>{' '}
      both work and a leading zero means <em>octal</em>; bits above the {FILTER_BITS} are dropped
      rather than refused, so <code>echo 0xffffffff &gt;</code> leaves{' '}
      <code>{formatMask((1 << FILTER_BITS) - 1)}</code>. Two things no bit can override:{' '}
      <code>VM_DONTDUMP</code>, which <code>madvise(MADV_DONTDUMP)</code> sets and the kernel puts
      on mappings of its own, is never dumped; and <strong>huge pages ignore bits 0 to 4</strong>{' '}
      entirely — bits 5 and 6 are the whole of what decides a hugetlb mapping. The file exists only
      on a <code>CONFIG_ELF_CORE</code> kernel. It is mode <strong>0644</strong>: every user on the
      machine reads it and only the owner writes it, which is the other way round from{' '}
      <code>environ</code> beside it.
    </p>
  );

  if (isEmpty(filter)) {
    return (
      <>
        <p className="notice" role="status" data-testid="empty">
          This file is empty, which is not an error: the read takes{' '}
          <code>get_task_mm</code> first, and a kernel thread has no <code>mm</code> for the flags
          to be in — neither has a process that has already exited. Which of the two this is cannot
          be told from here; <code>stat</code> beside it says.
        </p>
        {note}
      </>
    );
  }

  if (isUnreadable(filter)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="unreadable">
          This file does not hold a number. The kernel prints {WIDTH} hex digits and a newline and
          nothing else, so whatever is here came from somewhere else — switch to the raw view to see
          it.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="filter" value={filter.value} />
        <Stat label="mappings dumped" value={`${set.length} of ${FILTER_BITS}`} />
        <Stat label="against the default" value={STANDING[standing]} wide={true} />
        <Stat label="bytes" value={String(filter.bytes)} />
      </section>

      <Bits filter={filter} />

      {isDefault(filter) && (
        <p className="notice" role="status" data-testid="untouched">
          <strong>
            This is <code>{formatMask(DEFAULT_MASK)}</code>, the filter every process is born with.
          </strong>{' '}
          <code>MMF_DUMP_FILTER_DEFAULT</code> is anonymous memory, private huge pages and the ELF
          headers of what is mapped — a core holding everything the program was working on, plus
          enough of each library for a debugger to identify it, and none of the libraries
          themselves. Nothing has written this file, and nothing that started this process wrote its
          own.
        </p>
      )}

      {isNothing(filter) && (
        <p className="notice notice--warn" role="status" data-testid="nothing">
          <strong>No mapping at all would be written into a core.</strong> There would still be a
          core file: the ELF headers, the note segment, the registers of every thread and the
          process&rsquo;s own accounting all sit outside the mappings. But there would be no stack
          behind those registers, so not even a backtrace — a crash here leaves the program counter
          and nothing to read it against. This is a deliberate setting rather than a fault; it is
          what keeps memory out of a core on a machine where a core would leave the machine.
        </p>
      )}

      {isEverything(filter) && (
        <p className="notice" role="status" data-testid="everything">
          <strong>Every bit is set, which is as wide as this file goes.</strong> A core would hold
          the mapped files, the shared memory and the huge pages as well as the process&rsquo;s own
          — so its size is roughly everything in <code>/proc/&lt;pid&gt;/smaps</code> rather than
          the anonymous part of it, and on a large process that is gigabytes written at the moment
          it crashed. Worth pairing with a <code>core_pattern</code> that pipes to something rather
          than a file, and with <code>RLIMIT_CORE</code> raised enough to let it finish.
        </p>
      )}

      {headersRedundant(filter) && (
        <p className="notice" role="status" data-testid="redundant">
          <strong>Bit 4 has nothing left to decide.</strong> It writes the first page of each
          file-backed private mapping so a debugger can identify the library; bit 2 is set, so the
          whole of every one of those mappings is already going in. The two are only ever a choice
          — the kernel&rsquo;s default takes 4 <em>instead of</em> 2, which is what keeps a core
          debuggable without copying every mapped library into it.
        </p>
      )}

      {unsymbolisable(filter) && !isNothing(filter) && (
        <p className="notice notice--warn" role="status" data-testid="no-headers">
          <strong>A core from this filter is hard to read back.</strong> Neither the mapped files
          (bit 2) nor their ELF headers (bit 4) go in, so a debugger has no build id to match a
          library against and nothing to resolve the addresses in a backtrace with — unless it can
          find the exact binaries the process was running, from somewhere other than the core.
        </p>
      )}

      {standing === 'narrower' && (
        <p className="notice" role="status" data-testid="narrowed">
          <strong>Something narrowed the default.</strong> {listOf(missingFromDefault(filter))} would
          be dumped by an untouched process and {missingFromDefault(filter).length === 1 ? 'is' : 'are'}{' '}
          left out here — a write to this file, an inherited one from whatever started this process,
          or a <code>CoredumpFilter=</code> in its service unit.
        </p>
      )}

      {standing === 'wider' && (
        <p className="notice" role="status" data-testid="widened">
          <strong>Something widened the default.</strong> The kernel&rsquo;s{' '}
          <code>{formatMask(DEFAULT_MASK)}</code> is here and {listOf(beyondDefault(filter))} with
          it, which a process is never given on its own — so this was written, either to this
          process or to something that started it and handed it down.
        </p>
      )}

      {standing === 'different' && (
        <p className="notice" role="status" data-testid="rearranged">
          <strong>This is not the default narrowed or widened, but rearranged.</strong> It drops{' '}
          {listOf(missingFromDefault(filter))} and adds {listOf(beyondDefault(filter))}, so whoever
          wrote it had a particular core in mind rather than simply more or less of one.
        </p>
      )}

      {back !== null && !back.same && (
        <p className="notice notice--warn" role="status" data-testid="round-trip">
          <strong>
            This file will not take its own output back.{' '}
            {back.mask === null ? (
              <>
                <code>echo {back.text} &gt;</code> is refused.
              </>
            ) : (
              <>
                <code>echo {back.text} &gt;</code> would set{' '}
                <code>{formatMask(back.mask)}</code>.
              </>
            )}
          </strong>{' '}
          The read prints hex with no <code>0x</code> in front of it; the write is parsed with{' '}
          <code>kstrtouint(…, 0, …)</code>, where a leading zero means <strong>octal</strong> — and{' '}
          <code>%0{WIDTH}lx</code> puts leading zeroes on nearly everything this file can hold.{' '}
          {back.mask === null
            ? `Base ${back.base} does not accept every digit here, so the write stops with EINVAL and the filter is left as it was.`
            : `So the digits are read in base ${back.base} instead of 16, and what lands is a filter nobody asked for.`}{' '}
          Write <code>0x{filterMask(filter).toString(16)}</code> to mean what this file says.
        </p>
      )}

      {filter.unknown.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unknown-bits">
          <strong>
            {filter.unknown.length === 1
              ? `Bit ${filter.unknown[0]} is set, and this file has no bit ${filter.unknown[0]}.`
              : `Bits ${filter.unknown.join(', ')} are set, and this file has none of them.`}
          </strong>{' '}
          <code>proc_coredump_filter_write</code> walks {FILTER_BITS} bits and sets or clears each
          one, so anything above them is dropped on the way in rather than stored — a value this
          wide cannot have come through the interface that writes this file. The nine above are read
          from the low digits regardless.
        </p>
      )}

      {!filter.printed && (
        <p className="notice notice--warn" role="status" data-testid="reformatted">
          This is not the shape <code>%0{WIDTH}lx</code> writes: {WIDTH} digits, lower case, zero
          padded. Something between here and the kernel has reformatted the number — the bits are
          read from it as it stands.
        </p>
      )}

      {!filter.terminated && (
        <p className="notice notice--warn" role="status" data-testid="unterminated">
          This file does not end with a newline. <code>proc_coredump_filter_read</code> prints one
          after the digits, so something in between has been trimming the answer.
        </p>
      )}

      {note}
    </>
  );
}
