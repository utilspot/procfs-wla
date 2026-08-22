import { useMemo } from 'react';
import {
  couldBeAll,
  cpuList,
  groupsOf,
  isDefault,
  isEmpty,
  isUnreadable,
  parseDefaultAffinity,
  slotRange,
  type DefaultAffinity,
} from '../lib/irq-default_smp_affinity';

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide === true ? 'stat affinity__stat--wide' : 'stat'}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * How many slots are worth drawing a chip each. A 96-way server is a grid worth
 * reading; a machine built for four thousand CPUs is a wall, and the mask and
 * the CPU list above it already say what it would.
 */
const GRID_LIMIT = 256;

/** The groups as written, with the CPUs each covers under it. */
function Groups({ affinity }: { affinity: DefaultAffinity }) {
  const groups = useMemo(() => groupsOf(affinity), [affinity]);

  return (
    <div className="card affinity__mask" data-testid="mask">
      <ol className="affinity__groups">
        {groups.map((group) => (
          <li
            className={group.set ? 'affinity__group affinity__group--set' : 'affinity__group'}
            key={group.first}
          >
            <span className="affinity__digits">{group.digits}</span>
            <span className="affinity__span muted">
              {group.first === group.last ? `CPU ${group.last}` : `CPUs ${group.last}–${group.first}`}
            </span>
          </li>
        ))}
      </ol>
      <p className="affinity__order muted">
        Most significant group first, 32 bits to a group — so the group on the right is the one
        holding CPU 0, and reading the file left to right counts <em>down</em>.
      </p>
    </div>
  );
}

/** A chip per slot the mask spells, lit for the CPUs it names. */
function Slots({ affinity }: { affinity: DefaultAffinity }) {
  const named = useMemo(() => new Set(affinity.cpus), [affinity]);
  const slots = useMemo(
    () => Array.from({ length: affinity.slots }, (_, cpu) => cpu),
    [affinity.slots],
  );

  return (
    <div className="card affinity__slots" data-testid="slots">
      <ol className="chips affinity__cpus" aria-label="CPU slots the mask spells">
        {slots.map((cpu) => (
          <li
            className={named.has(cpu) ? 'chip affinity__cpu affinity__cpu--set' : 'chip affinity__cpu'}
            key={cpu}
          >
            {cpu}
          </li>
        ))}
      </ol>
      <p className="affinity__order muted">
        One per bit the mask spells out, which is <code>nr_cpu_ids</code> rounded up to a whole hex
        digit — so up to three at the end can be padding rather than slots the kernel has, and none
        of them says whether that CPU is online.
      </p>
    </div>
  );
}

/**
 * One mask, and the two things that read wrong about it: it is the default a
 * *new* interrupt starts with rather than a control over the ones that exist,
 * and its width is the CPU slots the kernel has rather than the CPUs running.
 */
export function IrqDefaultSmpAffinityView({ content }: { content: string }) {
  const affinity = useMemo(() => parseDefaultAffinity(content), [content]);
  const slots = slotRange(affinity);

  const note = (
    <p className="disks__note muted">
      This is the mask an interrupt is given <strong>when it is first set up</strong>, and nothing
      else. <code>irq_setup_affinity</code> copies it into the descriptor as that interrupt is
      requested; from then on the descriptor&rsquo;s own copy is what counts, and that copy is{' '}
      <code>/proc/irq/&lt;N&gt;/smp_affinity</code>. On a booted machine nearly every interrupt
      already exists, so <strong>writing here moves nothing</strong> — it takes effect on the next
      driver loaded or device plugged in. The kernel sets every bit at boot unless{' '}
      <code>irqaffinity=</code> on the command line said otherwise, which is why an untouched
      machine shows a mask of all <code>f</code>. Two more things this file cannot tell you on its
      own. <strong>Managed interrupts ignore it</strong>: a multi-queue device — NVMe, a modern
      NIC — gets affinities the kernel spreads across the CPUs itself, and neither this file nor a
      write to <code>smp_affinity</code> can move them, that write answering <code>EIO</code>. And{' '}
      <code>irqbalance</code> rewrites per-interrupt affinities as it runs without reading this
      file at all, so a narrowed default can be undone minutes after boot. The file is mode 0600 —
      root alone reads it — exists only on a <code>CONFIG_SMP</code> kernel, and has{' '}
      <strong>no list spelling</strong>: a per-interrupt affinity has{' '}
      <code>smp_affinity_list</code> beside it, this one has the hex and nothing else, so the CPU
      list above is worked out here.
    </p>
  );

  if (isEmpty(affinity)) {
    return (
      <>
        <p className="notice notice--warn" data-testid="empty">
          There is nothing in this file. An SMP kernel always has a mask here, even one naming no
          CPU at all — so an empty one means the backend could not read it. Switch to the raw view
          to see what the server returned.
        </p>
        {note}
      </>
    );
  }

  if (isUnreadable(affinity)) {
    return (
      <>
        <p className="notice notice--warn" data-testid="unreadable">
          This file does not hold a CPU mask. The kernel prints hex digits in groups of eight with
          commas between them and nothing else, so whatever is here came from somewhere else —
          switch to the raw view to see it.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="CPUs in the mask" value={String(affinity.cpus.length)} />
        <Stat
          label="as a CPU list"
          value={affinity.none ? '—' : cpuList(affinity.cpus)}
          wide={true}
        />
        <Stat
          label="CPU slots the kernel has"
          value={slots.min === slots.max ? String(slots.max) : `${slots.min}–${slots.max}`}
        />
        <Stat label="bytes" value={String(affinity.bytes)} />
      </section>

      <Groups affinity={affinity} />

      {affinity.slots <= GRID_LIMIT && <Slots affinity={affinity} />}

      {isDefault(affinity) && (
        <p className="notice" role="status" data-testid="untouched">
          <strong>Every bit is set, which is the mask a kernel starts with.</strong>{' '}
          <code>init_irq_default_affinity</code> fills it in at boot and only{' '}
          <code>irqaffinity=</code> or a write to this file narrows it, so nothing here has been
          narrowed — a new interrupt may be routed to any CPU the machine has.
        </p>
      )}

      {affinity.none && (
        <p className="notice notice--warn" role="status" data-testid="no-cpus">
          <strong>This mask names no CPU, and the kernel will not honour it.</strong> The write that
          set it was accepted — outside ia64 nothing validates a mask on the way in — but{' '}
          <code>irq_setup_affinity</code> intersects it with the online CPUs and falls back to{' '}
          <em>all</em> of them when nothing is left. So it reads as &ldquo;none&rdquo; and behaves
          as &ldquo;every CPU&rdquo;, which is the opposite of what it looks like.
        </p>
      )}

      {couldBeAll(affinity) && (
        <p className="notice" role="status" data-testid="padded">
          <strong>
            {affinity.cpus.length} of the {affinity.slots} slots this mask spells are set — and
            that is very likely every CPU there is.
          </strong>{' '}
          The mask runs unbroken from CPU 0 and stops inside the top hex digit, which is what a{' '}
          <code>nr_cpu_ids</code> that is not a multiple of four looks like: a kernel with{' '}
          {affinity.cpus.length} CPU slots prints its untouched default as{' '}
          <code>{affinity.value}</code>, the bits above the last CPU belonging to nothing. The file
          cannot settle it — a machine really built for {affinity.slots} would be showing a default
          narrowed by the last {affinity.slots - affinity.cpus.length} — but the first reading is
          the likely one.
        </p>
      )}

      {!isDefault(affinity) && !affinity.none && !couldBeAll(affinity) && (
        <p className="notice" role="status" data-testid="narrowed">
          <strong>
            {affinity.cpus.length} of the {affinity.slots} slots this mask spells are set.
          </strong>{' '}
          Something narrowed the default: <code>irqaffinity={cpuList(affinity.cpus)}</code> on the
          kernel command line, or a write to this file since. New interrupts will be set up on{' '}
          <code>{cpuList(affinity.cpus)}</code> and leave the rest for whatever the machine keeps
          them clear for — though only new ones, and only until <code>irqbalance</code> has an
          opinion.
        </p>
      )}

      {!affinity.chunked && (
        <p className="notice notice--warn" role="status" data-testid="ungrouped">
          The groups here are not the 32-bit chunks the kernel writes: every group but the leftmost
          should be exactly eight hex digits. Something between here and the kernel has been
          reformatting the mask, and the CPU numbers above are read from the digits as they stand.
        </p>
      )}

      {!affinity.terminated && (
        <p className="notice notice--warn" role="status" data-testid="unterminated">
          This file does not end with a newline. <code>default_affinity_show</code> prints one after
          the mask, so something in between has been trimming the answer.
        </p>
      )}

      {note}
    </>
  );
}
