import { useMemo } from 'react';
import {
  averageMessageOf,
  fillShareOf,
  formatBytes,
  formatPermissions,
  formatTime,
  hasRaisedLimit,
  isAtDefaultLimit,
  isOverflowId,
  isPidVisible,
  isPrivate,
  keyHex,
  MSGMNB_DEFAULT,
  ownerChanged,
  parseMsg,
  permissionsOf,
  sequenceOf,
  slotOf,
  summarize,
  TIMES,
  wasNeverReceived,
  wasNeverUsed,
  type MsgQueue,
} from '../lib/sysvipc-msg';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The key, which is a bit pattern the kernel prints as a signed integer. */
function Key({ queue }: { queue: MsgQueue }) {
  if (isPrivate(queue)) {
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
        queue.key < 0
          ? `Printed as ${queue.key}: key_t is signed, and this key has its top bit set`
          : `Printed as ${queue.key}`
      }
    >
      {keyHex(queue)}
    </span>
  );
}

/**
 * A pid the kernel printed as 0, which is either a process the reader's
 * namespace cannot see or nothing having sent or received at all. The time
 * beside it is what says which.
 */
function Pid({
  pid,
  used,
  hidden,
  never,
}: {
  pid: number;
  /** Whether the matching time says this end has been used at all. */
  used: boolean;
  hidden: string;
  never: string;
}) {
  if (isPidVisible(pid)) return <>{pid}</>;

  return used ? (
    <span className="muted" title={hidden}>
      hidden
    </span>
  ) : (
    <span className="muted" title={never}>
      never
    </span>
  );
}

/** One of the three timestamps, where 0 means never rather than 1970. */
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

function QueueRow({ queue }: { queue: MsgQueue }) {
  const stalled = wasNeverReceived(queue);
  const average = averageMessageOf(queue);
  const share = fillShareOf(queue);

  return (
    <tr className={stalled ? 'msg__row msg__row--stalled' : 'msg__row'}>
      <td className="msg__key">
        <Key queue={queue} />
      </td>

      <td className="msg__id" title={`Slot ${slotOf(queue)}, sequence ${sequenceOf(queue)}`}>
        {queue.msqid}
      </td>

      <td className="msg__perms">
        <span
          title={`${permissionsOf(queue).toString(8).padStart(3, '0')} — ${formatPermissions(queue)}`}
        >
          {queue.mode.toString(8)}
        </span>
      </td>

      <td className="msg__number">
        {queue.qnum === 0 ? (
          <span
            className="muted"
            title={
              wasNeverUsed(queue)
                ? 'Empty, and nothing has ever sent to it'
                : 'Empty: everything sent has been received'
            }
          >
            0
          </span>
        ) : (
          <span
            className={stalled ? 'msg__hit' : undefined}
            title={`${queue.qnum.toLocaleString('en-US')} messages waiting${average === null ? '' : `, averaging ${formatBytes(average)} of text each`}`}
          >
            {queue.qnum.toLocaleString('en-US')}
          </span>
        )}
      </td>

      <td className="msg__number">
        <span
          className={isAtDefaultLimit(queue) ? 'msg__hit' : queue.cbytes === 0 ? 'muted' : undefined}
          title={`${queue.cbytes.toLocaleString('en-US')} bytes of message text — ${Math.round(share * 100)}% of the ${formatBytes(MSGMNB_DEFAULT)} msgmnb allows a queue by default`}
        >
          {formatBytes(queue.cbytes)}
        </span>
        {hasRaisedLimit(queue) ? (
          <span
            className="chip"
            title={`Past the ${formatBytes(MSGMNB_DEFAULT)} default, which only a raised q_qbytes allows — and this file does not print it`}
          >
            limit raised
          </span>
        ) : (
          isAtDefaultLimit(queue) && (
            <span
              className="chip"
              title={`Full at the ${formatBytes(MSGMNB_DEFAULT)} msgmnb allows by default: a further msgsnd blocks unless this queue's own limit was raised`}
            >
              at msgmnb
            </span>
          )
        )}
      </td>

      <td className="msg__pid">
        <Pid
          pid={queue.lspid}
          used={queue.stime > 0}
          hidden="The last process to send is not visible in this pid namespace"
          never="Nothing has ever sent to this queue"
        />
      </td>

      <td className="msg__pid">
        <Pid
          pid={queue.lrpid}
          used={queue.rtime > 0}
          hidden="The last process to receive is not visible in this pid namespace"
          never="Nothing has ever received from this queue"
        />
      </td>

      <td className="msg__owner">
        <span
          title={
            ownerChanged(queue)
              ? `Created by ${queue.cuid}:${queue.cgid}, handed on with msgctl(IPC_SET)`
              : 'The creator still owns it'
          }
        >
          {queue.uid}:{queue.gid}
        </span>
        {ownerChanged(queue) && (
          <span className="chip" title="The owner is no longer the creator">
            given away
          </span>
        )}
        {isOverflowId(queue.uid) && (
          <span
            className="chip"
            title="The overflow id: this owner has no mapping in the reader's user namespace"
          >
            unmapped
          </span>
        )}
      </td>

      <td className="msg__time">
        <Time seconds={queue.stime} never="never sent" title={TIMES.stime} />
      </td>

      <td className="msg__time">
        <Time
          seconds={queue.rtime}
          never={stalled ? 'never received' : 'never'}
          title={
            stalled
              ? 'No msgrcv has ever run on this queue, though something has sent to it'
              : TIMES.rtime
          }
        />
      </td>

      <td className="msg__time">
        <Time seconds={queue.ctime} never="—" title={TIMES.ctime} />
      </td>
    </tr>
  );
}

export function SysvipcMsgView({ content }: { content: string }) {
  const info = useMemo(() => parseMsg(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  /**
   * No queues, which is what nearly every machine says — the graphical capture
   * here included — rather than a file that failed to answer.
   */
  if (info.queues.length === 0) {
    return (
      <p className="notice" role="status">
        No System V message queues on this machine — the file is its header and nothing else. That is
        the ordinary answer: a queue exists only because something called <code>msgget</code>, and
        what needs to pass messages now reaches for a socket, a pipe or a POSIX queue under{' '}
        <code>/dev/mqueue</code> instead.
      </p>
    );
  }

  return (
    <>
      {summary.neverReceived.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.neverReceived.length === 1
            ? '1 queue has been sent to and never read from'
            : `${summary.neverReceived.length} queues have been sent to and never read from`}{' '}
          — an <code>rtime</code> of 0 with messages still on them. That is a receiver that never
          started rather than one falling behind, and the messages sit in kernel memory until
          something takes them off or the queue is removed.
        </p>
      )}

      {summary.atLimit.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.atLimit.length === 1 ? '1 queue holds' : `${summary.atLimit.length} queues hold`}{' '}
          as much as <code>msgmnb</code> allows one to by default —{' '}
          {formatBytes(MSGMNB_DEFAULT)}. A <code>msgsnd</code> to a full queue blocks, or fails with{' '}
          <code>EAGAIN</code> under <code>IPC_NOWAIT</code>, so a sender is waiting on a receiver
          that is not keeping up. The limit is per queue and this file does not print it: a queue
          past the default has had its own raised.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="queues" value={String(summary.queues)} />
        <Stat
          label="messages"
          value={summary.messages.toLocaleString('en-US')}
          title="Waiting across every queue, whatever their types are"
        />
        <Stat
          label="waiting"
          value={formatBytes(summary.bytes)}
          title={`${summary.bytes.toLocaleString('en-US')} bytes of message text — what counts against msgmnb, excluding the types and the kernel's own overhead`}
        />
        {summary.backedUp.length > 0 && (
          <Stat
            label="not empty"
            value={String(summary.backedUp.length)}
            title="Queues with something still on them"
          />
        )}
      </section>

      <div className="card mounts">
        <table className="mounts__table msg__table" aria-label="Message queues">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">msqid</th>
              <th scope="col">Perms</th>
              <th scope="col">Messages</th>
              <th scope="col">Waiting</th>
              <th scope="col">Sender</th>
              <th scope="col">Receiver</th>
              <th scope="col">Owner</th>
              <th scope="col">Last send</th>
              <th scope="col">Last receive</th>
              <th scope="col">Last change</th>
            </tr>
          </thead>
          <tbody>
            {info.queues.map((queue) => (
              <QueueRow key={queue.msqid} queue={queue} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        This is the one <code>/proc/sysvipc</code> file that shows{' '}
        <strong>live state</strong>: a segment&rsquo;s size and a semaphore set&rsquo;s{' '}
        <code>nsems</code> are fixed when the object is made, while <code>qnum</code> and{' '}
        <code>cbytes</code> are what is sitting in the queue at the moment it is read. Four things
        about them read wrong at first glance. <strong>
          <code>cbytes</code> is message text only
        </strong>{' '}
        — the type in front of each message and the <code>struct msg_msg</code> the kernel wraps it
        in are not counted, so a queue of many small messages costs more than it admits.{' '}
        <strong>What it is measured against is not in this file</strong>: a sender blocks when{' '}
        <code>cbytes</code> plus its message would pass the queue&rsquo;s own{' '}
        <code>q_qbytes</code>, which starts at <code>msgmnb</code> —{' '}
        {formatBytes(MSGMNB_DEFAULT)}, from <code>/proc/sys/kernel/msgmnb</code> — and which root
        can raise per queue, so the share above is a reading against the default and a queue past it
        has had its own moved. Sixteen 1 KiB messages fill a queue on the default, which surprises
        most people the first time. <strong>
          <code>qnum</code> does not say a receiver can proceed
        </strong>{' '}
        either: every message carries a type and <code>msgrcv</code> can ask for one, so a process
        waiting for type 5 blocks with a hundred messages of type 3 in front of it — and nothing here
        says how many processes are blocked at either end. And a <strong>0 is not a zero</strong> in
        five places: <code>stime</code>, <code>rtime</code> and <code>ctime</code> mean never rather
        than 1970, while <code>lspid</code> and <code>lrpid</code> are printed through{' '}
        <code>pid_nr_ns</code>, so a 0 there is a process this <code>/proc</code> cannot see — which
        the times beside it are what tell apart. The rest reads as it does across{' '}
        <code>/proc/sysvipc</code>: the key is printed signed, a key of 0 is{' '}
        <code>IPC_PRIVATE</code>, <code>msqid</code> is a sequence number above a slot, an owner
        outside the reader&rsquo;s user namespace reads as the overflow id, and <code>perms</code> is
        octal but flagless — a queue has no <code>dest</code> state, since{' '}
        <code>msgctl(IPC_RMID)</code> removes it at once, wakes every blocked call with{' '}
        <code>EIDRM</code>, and throws away whatever was still on it.
      </p>
    </>
  );
}
