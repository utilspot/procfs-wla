import { useMemo } from 'react';
import { isEmpty, isUnreadable, isUnset, parseSessionId, UNSET } from '../lib/sessionid';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * One number, and the two things a reader has to know about it: that it is not
 * the session `setsid()` makes, and that {@link UNSET} means no login session
 * rather than session zero.
 */
export function SessionIdView({ content }: { content: string }) {
  const session = useMemo(() => parseSessionId(content), [content]);

  const note = (
    <p className="disks__note muted">
      This is the <strong>audit</strong> session id, not the session{' '}
      <code>setsid()</code> makes — that one is a pid, it is what <code>getsid()</code> returns, and
      it is field 6 of <code>/proc/&lt;pid&gt;/stat</code>. This is a counter the kernel bumps when
      a login is recorded, handed to that login&rsquo;s first process and inherited by everything it
      starts. <strong>It survives <code>su</code> and <code>sudo</code></strong>: changing user
      changes the uid and not this, which is what lets <code>auditd</code> put &ldquo;root deleted
      the file&rdquo; and &ldquo;this person logged in at 09:14&rdquo; on the same string. It pairs
      with <code>/proc/&lt;pid&gt;/loginuid</code>, which holds <em>who</em> that login was. The
      kernel allocates it when <code>loginuid</code> is written — <code>pam_loginuid</code> does
      that at login — and with <code>CONFIG_AUDIT_LOGINUID_IMMUTABLE</code> it can never be written
      again, not even by root. The file exists only on a kernel built with{' '}
      <code>CONFIG_AUDIT</code>; without it there is nothing here to read at all, which is a
      different answer from <code>{UNSET}</code> and reads much the same. Unlike{' '}
      <code>/proc/&lt;pid&gt;/wchan</code> it needs no <code>ptrace</code> access — every process on
      the machine will show you this one. The kernel writes the number with no trailing newline.
    </p>
  );

  if (isEmpty(session)) {
    return (
      <>
        <p className="notice notice--warn" data-testid="empty">
          There is nothing in this file. A process on a kernel with auditing always has a number
          here, even if that number is <code>{UNSET}</code> — so an empty one means the process is
          gone or the backend could not read it. Switch to the raw view to see what the server
          returned.
        </p>
        {note}
      </>
    );
  }

  if (isUnreadable(session)) {
    return (
      <>
        <p className="notice notice--warn" data-testid="unreadable">
          This file does not hold a number. The kernel prints the session id with <code>%u</code>{' '}
          and nothing else, so whatever is here came from somewhere else — switch to the raw view to
          see it.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat
          label={session.set ? 'audit session' : 'no login session'}
          value={session.set ? String(session.id) : '—'}
        />
        <Stat label="raw value" value={String(session.id)} />
        <Stat label="bytes" value={String(session.bytes)} />
      </section>

      {isUnset(session) && (
        <p className="notice" role="status" data-testid="unset">
          <strong>
            <code>{UNSET}</code> is <code>(unsigned int)-1</code>, which means no login session owns
            this process — not session zero.
          </strong>{' '}
          Nothing ever wrote <code>loginuid</code> for it, so the kernel had no session to give it:{' '}
          <code>init</code>, a daemon the boot brought up, a kernel thread, or anything in a
          container where no login happened. It is the ordinary answer for most of a machine&rsquo;s
          processes rather than a fault, and it means an audit trail cannot tie what this process
          does back to a person.
        </p>
      )}

      {session.terminated && (
        <p className="notice notice--warn" role="status" data-testid="terminated">
          This file ends with a newline. The kernel writes the number and stops, so something
          between here and it has been reformatting the answer.
        </p>
      )}

      {note}
    </>
  );
}
