import { useMemo } from 'react';
import {
  formatTunable,
  isDeferredToPair,
  isRescaled,
  isTrigger,
  meaningOf,
  parseTunable,
  UNIT_LABELS,
  WRITE_CAPABILITY,
  type VmTunable,
} from '../lib/sys-vm';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * The page every file in `/proc/sys/vm` gets, which is one page rather than
 * fifty: they are fifty settings read the same way — a line of one or a few
 * fields — and what differs between them is the row of facts in `TUNABLES`.
 *
 * **It is about the one file**: what it is set to, in the unit it is counted
 * in, and what that value means where the value is one of a set rather than a
 * point on a scale. Which knob belongs to which mechanism is the listing of the
 * directory, `sys/vm/index.html`, and the trail at the top of the page is the
 * way there.
 *
 * The value is shown **twice over** where the raw figure and the useful one
 * differ: `dirty_expire_centisecs` reads 3000 and means thirty seconds,
 * `min_free_kbytes` reads 67584 and means 66 MiB. The kernel's own spelling is
 * kept beside the reading, since that is what has to be written back.
 */
export function SysVmParameterView({
  tunable,
  content,
}: {
  tunable: VmTunable;
  content: string;
}) {
  const value = useMemo(() => parseTunable(content), [content]);

  if (value === null) {
    return (
      <p className="notice notice--warn" data-testid="unreadable">
        Nothing in this file. A setting under <code>/proc/sys</code> holds a line whenever it can be
        read at all — switch to the raw view to see what the server returned.
      </p>
    );
  }

  const reading = formatTunable(tunable, value);
  const meaning = meaningOf(tunable, value);
  const deferred = isDeferredToPair(tunable, value);
  const trigger = isTrigger(tunable);

  return (
    <>
      {trigger && (
        <p className="notice" role="status" data-testid="trigger">
          <strong>This file is written, not read.</strong> What it holds says nothing about the
          machine — it is the writing that does the work, and the kernel keeps no record of what was
          asked for or of what it freed.
        </p>
      )}

      {deferred && (
        <p className="notice notice--warn" role="status" data-testid="deferred">
          <strong>0 here does not mean the setting is off.</strong> This file and{' '}
          <code>{tunable.pairedWith}</code> are two spellings of one threshold, and writing either
          zeroes the other — so a 0 means the machine is being held to the figure in{' '}
          <code>{tunable.pairedWith}</code> rather than to this one.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat
          label="value"
          value={trigger ? value.raw : reading}
          title={`What ${tunable.name} holds on this machine`}
        />
        {!trigger && isRescaled(tunable) && reading !== value.raw && (
          <Stat label="as written" value={value.raw} title="The figure the kernel prints, which is what has to be written back" />
        )}
        <Stat
          label="set in"
          value={UNIT_LABELS[tunable.unit]}
          title="The unit this file is counted in"
        />
        <Stat label="part of" value={tunable.group} title="Which of the memory manager’s mechanisms this belongs to" />
      </section>

      <p className="disks__note" data-testid="sets">
        <code>{tunable.name}</code> sets {tunable.sets}.
      </p>

      {meaning !== undefined && (
        <p className="notice" data-testid="meaning">
          <strong>
            {value.raw} {trigger ? 'is what to write' : 'here means'}:
          </strong>{' '}
          {meaning}
        </p>
      )}

      {value.fields.length > 1 && (
        <p className="disks__note muted" data-testid="fields">
          This one holds {value.fields.length} fields rather than a single figure — one per memory
          zone, in the order the kernel lists the zones — so it is written back the same way, as a
          line of numbers.
        </p>
      )}

      <p className="disks__note muted">
        Everything under <code>/proc/sys/vm</code> is a{' '}
        <strong>setting rather than a report</strong>: what it holds is what the memory manager has
        been told to do rather than anything it has done, and none of these numbers says how much of
        anything is in use — <code>/proc/meminfo</code> and <code>/proc/vmstat</code> are where that
        is. Writing one takes <code>{WRITE_CAPABILITY}</code>; everyone else reads it and no more.
        The other files beside this one are listed at <code>/proc/sys/vm</code>, each against what
        it sets.
      </p>
    </>
  );
}
