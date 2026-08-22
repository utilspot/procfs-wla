import { useMemo } from 'react';
import {
  AT_BASE,
  describeType,
  entryFor,
  formatValue,
  gainedPrivilege,
  isEmpty,
  isSecure,
  isStatic,
  isUnknown,
  isUnreadable,
  nameFor,
  pageSize,
  parseAuxv,
  valueOf,
  type AuxEntry,
  type Layout,
} from '../lib/auxv';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** `64-bit, little-endian` — how the pairs in this file are laid out. */
function describeLayout(layout: Layout): string {
  return `${layout.words * 8}-bit, ${layout.endian}-endian`;
}

function EntryRow({ entry }: { entry: AuxEntry }) {
  const name = nameFor(entry.type);
  const description = describeType(entry.type);

  return (
    <tr className="auxv__row">
      <td className="auxv__offset" title={`byte ${entry.offset} of the file`}>
        {entry.offset}
      </td>
      <td className="auxv__type">{entry.type}</td>
      <td className="auxv__name">
        {name ?? <span className="muted">—</span>}
        {isUnknown(entry) && (
          <span className="chip chip--bug" title="No AT_* constant for this number on this page">
            not known here
          </span>
        )}
      </td>
      <td className="auxv__value">{formatValue(entry)}</td>
      <td className="auxv__what">
        {description ?? <span className="muted">Nothing here knows this number.</span>}
      </td>
    </tr>
  );
}

/**
 * The vector the kernel handed this program as it started, decoded — and the
 * two things about it that surprise: it is a snapshot from `execve` rather than
 * a live reading, and several of its values are addresses into the process
 * rather than anything you can read here.
 */
export function AuxvView({ bytes }: { bytes: Uint8Array }) {
  const auxv = useMemo(() => parseAuxv(bytes), [bytes]);
  const page = pageSize(auxv);

  const note = (
    <p className="disks__note muted">
      The auxiliary vector is what the kernel told the C library about the machine as this program
      was <code>execve</code>&rsquo;d: pairs of native words, a type and a value, ending at{' '}
      <code>AT_NULL</code>. <strong>It is the one entry here that is not text</strong>: a pointer
      holds bytes no character encoding can carry, so this page reads the file as the bytes it is
      and a tool that reads it as characters has already lost them — which is what the raw view
      beside this one shows, and what <code>cat</code> would put on a terminal.{' '}
      <strong>It is a snapshot, not a reading</strong>: the kernel wrote these pairs onto the new
      stack as the program was loaded and kept a copy in <code>mm-&gt;saved_auxv</code>, which is
      what this file shows. Nothing updates it afterwards, so <code>AT_UID</code> is the uid this
      process <em>exec&rsquo;d</em> with — one that has since called <code>setuid()</code> still
      shows the old one, which is the file being exact about a different moment rather than being
      stale. <strong>Several values are addresses, not data</strong>: <code>AT_EXECFN</code> points
      at the pathname near the top of the process&rsquo;s own stack and <code>AT_RANDOM</code> at
      sixteen random bytes the C library seeds its stack canary from, and following either needs{' '}
      <code>/proc/&lt;pid&gt;/mem</code> and the right to read it. That right is the same one this
      file wants: <code>proc_pid_auxv</code> checks <code>PTRACE_MODE_READ_FSCREDS</code>, so
      another user&rsquo;s process answers <code>EPERM</code> rather than showing you an empty
      vector. And the word size is the <em>process&rsquo;s</em>, not the kernel&rsquo;s — a 32-bit
      program on a 64-bit machine has four-byte words here, so this page works the layout out from
      the bytes rather than assuming one.
    </p>
  );

  if (isEmpty(auxv)) {
    return (
      <>
        <p className="notice" role="status" data-testid="empty">
          <strong>This process has no auxiliary vector.</strong> The file is empty rather than
          missing, which is what a task with no memory of its own reads like: a kernel thread never
          went through <code>execve</code>, and a zombie has had its <code>mm</code> taken away
          already. There is nothing for <code>proc_pid_auxv</code> to copy out, so it copies out
          nothing. A process you are not allowed to look at is a different answer — that one is{' '}
          <code>EPERM</code>, not emptiness.
        </p>
        {note}
      </>
    );
  }

  if (isUnreadable(auxv)) {
    return (
      <>
        <p className="notice notice--warn" data-testid="unreadable">
          These bytes are not an auxiliary vector in any layout this page can read — not 32- or
          64-bit, not either byte order. A vector is pairs of words ending at a pair of zeros with
          nothing after it, and {auxv.bytes} bytes of this are not that. The raw view shows what
          arrived.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="entries" value={String(auxv.entries.length)} />
        <Stat label="layout" value={auxv.layout === null ? '—' : describeLayout(auxv.layout)} />
        <Stat label="page size" value={page === null ? '—' : String(page)} />
        <Stat label="bytes" value={String(auxv.bytes)} />
      </section>

      {isSecure(auxv) && (
        <p className="notice notice--warn" role="status" data-testid="secure">
          <strong>
            <code>AT_SECURE</code> is set: this program gained privilege as it was exec&rsquo;d.
          </strong>{' '}
          It is set-uid, set-gid, or carries file capabilities
          {gainedPrivilege(auxv) && (
            <>
              {' '}
              — its real uid is <code>{String(valueOf(auxv, 11))}</code> and its effective one{' '}
              <code>{String(valueOf(auxv, 12))}</code>
            </>
          )}
          . This is the bit the C library reads to decide it is being run by someone who should not
          be able to steer it: <code>LD_PRELOAD</code>, <code>LD_LIBRARY_PATH</code> and the rest of
          the environment&rsquo;s hooks are dropped when it is 1, which is why a set-uid binary
          cannot be made to load a library of your choosing.
        </p>
      )}

      {isStatic(auxv) && (
        <p className="notice" role="status" data-testid="static">
          <strong>
            <code>AT_BASE</code> is 0, so this program was linked statically.
          </strong>{' '}
          That field is where the dynamic loader was mapped, and a program with no loader has
          nothing to put there — it was handed control directly rather than through{' '}
          <code>ld.so</code>, and its <code>AT_PHDR</code> points into the program at the address it
          was linked for rather than wherever it happened to land.
        </p>
      )}

      {!auxv.terminated && (
        <p className="notice notice--warn" role="status" data-testid="unterminated">
          This vector does not end with <code>AT_NULL</code>. Every one the kernel writes does, so
          the file has been cut short somewhere between here and it.
        </p>
      )}

      <div className="card auxv">
        <table className="mounts__table auxv__table" aria-label="Auxiliary vector">
          <thead>
            <tr>
              <th scope="col">At</th>
              <th scope="col">Type</th>
              <th scope="col">Name</th>
              <th scope="col">Value</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            {auxv.entries.map((entry) => (
              <EntryRow entry={entry} key={entry.offset} />
            ))}
          </tbody>
        </table>
      </div>

      {entryFor(auxv, AT_BASE) === null && !isStatic(auxv) && (
        <p className="notice notice--warn" role="status" data-testid="no-base">
          This vector has no <code>AT_BASE</code>, which every ELF program the kernel loads is given
          — so either it is not one, or the file was written by something other than a kernel.
        </p>
      )}

      {note}
    </>
  );
}
