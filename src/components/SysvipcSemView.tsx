import { useMemo } from 'react';
import {
  formatPermissions,
  formatTime,
  isAtSemmsl,
  isOverflowId,
  isPrivate,
  isSingle,
  keyHex,
  ownerChanged,
  parseSem,
  permissionsOf,
  SEMMSL_DEFAULT,
  sequenceOf,
  slotOf,
  summarize,
  TIMES,
  wasNeverUsed,
  wasSetAfterUse,
  type SemSet,
} from '../lib/sysvipc-sem';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The key, which is a bit pattern the kernel prints as a signed integer. */
function Key({ set }: { set: SemSet }) {
  if (isPrivate(set)) {
    return (
      <span
        className="muted"
        title="IPC_PRIVATE: no key at all, so nothing can look it up — only a process inheriting the id can reach it"
      >
        private
      </span>
    );
  }

  return (
    <span
      title={
        set.key < 0
          ? `Printed as ${set.key}: key_t is signed, and this key has its top bit set`
          : `Printed as ${set.key}`
      }
    >
      {keyHex(set)}
    </span>
  );
}

/** One of the two timestamps, where 0 means never rather than 1970. */
function Time({ seconds, never, title }: { seconds: number; never: string; title: string }) {
  const moment = formatTime(seconds);

  return moment === null ? (
    <span className="muted" title={title}>
      {never}
    </span>
  ) : (
    <span title={title}>{moment}</span>
  );
}

function SetRow({ set }: { set: SemSet }) {
  const unused = wasNeverUsed(set);

  return (
    <tr className={unused ? 'sem__row sem__row--unused' : 'sem__row'}>
      <td className="sem__key">
        <Key set={set} />
      </td>

      <td className="sem__id" title={`Slot ${slotOf(set)}, sequence ${sequenceOf(set)}`}>
        {set.semid}
      </td>

      <td className="sem__perms">
        <span
          title={`${permissionsOf(set).toString(8).padStart(3, '0')} — ${formatPermissions(set)}`}
        >
          {set.mode.toString(8)}
        </span>
      </td>

      <td className="sem__number">
        <span
          title={
            isSingle(set)
              ? 'One semaphore: a mutex, which is the commonest set there is'
              : `${set.nsems.toLocaleString('en-US')} semaphores in the set — their values are not in this file`
          }
        >
          {set.nsems.toLocaleString('en-US')}
        </span>
        {isAtSemmsl(set) && (
          <span
            className="chip"
            title={`At SEMMSL, the ${SEMMSL_DEFAULT.toLocaleString('en-US')} semaphores one set may hold`}
          >
            at SEMMSL
          </span>
        )}
      </td>

      <td className="sem__owner">
        <span
          title={
            ownerChanged(set)
              ? `Created by ${set.cuid}:${set.cgid}, handed on with semctl(IPC_SET)`
              : 'The creator still owns it'
          }
        >
          {set.uid}:{set.gid}
        </span>
        {ownerChanged(set) && (
          <span className="chip" title="The owner is no longer the creator">
            given away
          </span>
        )}
        {isOverflowId(set.uid) && (
          <span
            className="chip"
            title="The overflow id: this owner has no mapping in the reader's user namespace"
          >
            unmapped
          </span>
        )}
      </td>

      <td className="sem__time">
        <Time
          seconds={set.otime}
          never="never used"
          title={
            set.otime === 0
              ? 'No semop has ever run on this set — it was created and never operated on'
              : TIMES.otime
          }
        />
      </td>

      <td className="sem__time">
        <Time seconds={set.ctime} never="—" title={TIMES.ctime} />
        {wasSetAfterUse(set) && (
          <span
            className="chip"
            title="Changed after the last operation: SETVAL or SETALL wrote the values rather than anything waiting on them"
          >
            set since
          </span>
        )}
      </td>
    </tr>
  );
}

export function SysvipcSemView({ content }: { content: string }) {
  const info = useMemo(() => parseSem(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  /**
   * No semaphore sets, which is the ordinary answer on most machines rather
   * than a file that failed to say anything.
   */
  if (info.sets.length === 0) {
    return (
      <p className="notice" role="status">
        No System V semaphore sets on this machine — the file is its header and nothing else. That is
        ordinary: a set exists only because something called <code>semget</code>, and most of what
        needs to coordinate now uses a futex, a POSIX semaphore in shared memory, or a lock on a
        file instead.
      </p>
    );
  }

  return (
    <>
      {summary.neverUsed.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.neverUsed.length === 1
            ? '1 set has never been operated on'
            : `${summary.neverUsed.length} sets have never been operated on`}{' '}
          — an <code>otime</code> of 0, holding{' '}
          {summary.neverUsedSemaphores === 1
            ? '1 semaphore'
            : `${summary.neverUsedSemaphores.toLocaleString('en-US')} semaphores`}{' '}
          between them. A set outlives whatever created it, so one that was taken and never used is
          what a process that died between <code>semget</code> and its first <code>semop</code>
          leaves behind — until <code>ipcrm</code>, a matching <code>semctl(IPC_RMID)</code> or a
          reboot.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="sets" value={String(summary.sets)} />
        <Stat
          label="semaphores"
          value={summary.semaphores.toLocaleString('en-US')}
          title="Across every set, which is what SEMMNS caps machine-wide"
        />
        <Stat
          label="largest set"
          value={summary.largest.toLocaleString('en-US')}
          title={`Semaphores in one set, which is what SEMMSL caps — ${SEMMSL_DEFAULT.toLocaleString('en-US')} by default`}
        />
        {summary.mutexes > 0 && (
          <Stat
            label="of one"
            value={String(summary.mutexes)}
            title="Sets holding a single semaphore, which is a mutex"
          />
        )}
      </section>

      <div className="card mounts">
        <table className="mounts__table sem__table" aria-label="Semaphore sets">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">semid</th>
              <th scope="col">Perms</th>
              <th scope="col">Semaphores</th>
              <th scope="col">Owner</th>
              <th scope="col">Last operation</th>
              <th scope="col">Last change</th>
            </tr>
          </thead>
          <tbody>
            {info.sets.map((set) => (
              <SetRow key={set.semid} set={set} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>What this file leaves out is most of it.</strong> <code>nsems</code> is how many
        semaphores a set holds, not what any of them is worth: the values come from{' '}
        <code>semctl(GETALL)</code>, and nothing here says how many processes are blocked on one or
        which process last touched it — there is no pid in this file at all, where{' '}
        <code>/proc/sysvipc/shm</code> prints two. What it does say is that a set exists, and a set
        exists until something removes it, so <code>otime</code> is the column to read: 0 means no{' '}
        <code>semop</code> has ever run on it. That figure is <strong>not stored</strong> either —{' '}
        <code>get_semotime</code> takes the newest of the per-semaphore times, which is where the
        kernel has kept them since the fine-grained locking of 3.10. <code>ctime</code> beside it
        moves for <code>SETVAL</code> and <code>SETALL</code> as well as <code>IPC_SET</code>, so a
        change newer than the last operation is somebody writing the values rather than waiting on
        them. Three fields read as they do everywhere else in <code>/proc/sysvipc</code>:{' '}
        <code>perms</code> is <strong>octal</strong> — though a set carries no flags above the mode,
        having no <code>dest</code> state to be in, since <code>IPC_RMID</code> removes it at once
        and wakes every waiter with <code>EIDRM</code> — the <strong>key is printed signed</strong>,
        so one written as a hex constant with its top bit set reads negative, and a key of{' '}
        <strong>0 is no key</strong> but <code>IPC_PRIVATE</code>. <code>semid</code> is a sequence
        number above a slot, which is why ids jump by 32,768 rather than counting up. The ceilings
        are elsewhere: <code>/proc/sys/kernel/sem</code> holds <code>SEMMSL</code>,{' '}
        <code>SEMMNS</code>, <code>SEMOPM</code> and <code>SEMMNI</code>, and this file is scoped to
        one <strong>IPC namespace</strong> and world-readable, so it shows sets the reader has no
        permission to operate on and nothing of a namespace next door.
      </p>
    </>
  );
}
