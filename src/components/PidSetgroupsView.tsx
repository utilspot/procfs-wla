import { useMemo } from 'react';
import {
  certainlyFails,
  conditions,
  describeOrigin,
  isAllowed,
  isDenied,
  isEmpty,
  isFinal,
  isUnreadable,
  parseSetgroups,
  SETGROUPS_ALLOW,
  SETGROUPS_CVE,
  SETGROUPS_DENY,
  SETGROUPS_SINCE,
  summarize,
} from '../lib/pid-setgroups';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * One word, and the thing worth knowing about it: it is one of **three**
 * conditions `setgroups()` has to clear, so `allow` is necessary and not
 * sufficient — while `deny` settles the question for good.
 */
export function PidSetgroupsView({ content }: { content: string }) {
  const setgroups = useMemo(() => parseSetgroups(content), [content]);
  const summary = useMemo(() => summarize(setgroups), [setgroups]);
  const checks = useMemo(() => conditions(setgroups), [setgroups]);
  const origin = describeOrigin(setgroups);

  const note = (
    <p className="disks__note muted">
      One flag bit — <code>USERNS_SETGROUPS_ALLOWED</code> — printed as one of two words. It is the
      file <code>/proc/&lt;pid&gt;/gid_map</code> cannot be written without: since Linux{' '}
      {SETGROUPS_SINCE} an unprivileged process must write <code>{SETGROUPS_DENY}</code> here{' '}
      <em>first</em>, which closed {SETGROUPS_CVE} — before it, a user could make a namespace and{' '}
      <strong>drop</strong> a supplementary group, defeating a <em>negative</em> group permission, a
      file whose group bits grant less than its other bits, where being in the group is exactly what
      denies you. Five things read wrong.{' '}
      <strong>
        <code>{SETGROUPS_ALLOW}</code> does not mean <code>setgroups()</code> will work
      </strong>{' '}
      — <code>userns_may_setgroups</code> wants three things and this file reports one of them, so a
      brand-new namespace reads <code>{SETGROUPS_ALLOW}</code> and every call still fails, there
      being no <code>gid_map</code> yet.{' '}
      <strong>
        <code>{SETGROUPS_DENY}</code> is final and <code>{SETGROUPS_ALLOW}</code> is only a maybe
      </strong>
      : denying is one-way, and writing <code>{SETGROUPS_ALLOW}</code> over a{' '}
      <code>{SETGROUPS_DENY}</code> is <code>EPERM</code> for the life of the namespace.{' '}
      <strong>It belongs to the namespace, not the process</strong> — the flag hangs off{' '}
      <code>user_namespace</code>, so every process sharing one reads the same word and asking under
      a different pid is not a different question, which the <code>/proc/&lt;pid&gt;/</code> path
      makes it look like. <strong>Each write closes the other door</strong>: once{' '}
      <code>gid_map</code> has any extent, writing <code>{SETGROUPS_DENY}</code> here is{' '}
      <code>EPERM</code> — so a namespace gave up <code>setgroups()</code> before it had any groups
      to speak of, or it never can. And <strong>a denial is inherited</strong> by a namespace
      created inside a denied one, which is what stops the restriction being escaped by nesting.
      Mode 0644: everyone reads it, and writing needs privilege over the namespace. In the initial
      user namespace it reads <code>{SETGROUPS_ALLOW}</code> and can never be written, that
      namespace&rsquo;s <code>gid_map</code> having been filled in before anything could ask.
    </p>
  );

  if (isEmpty(setgroups)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="empty">
          There is nothing in this file. Every process on a kernel with user namespaces has one of
          two words here — <code>{SETGROUPS_ALLOW}</code> or <code>{SETGROUPS_DENY}</code>, never
          nothing — so an empty file means the backend could not read it. Switch to the raw view to
          see what the server returned.
        </p>
        {note}
      </>
    );
  }

  if (isUnreadable(setgroups)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="unreadable">
          This file holds neither <code>{SETGROUPS_ALLOW}</code> nor <code>{SETGROUPS_DENY}</code>,
          and those are the only two things <code>proc_setgroups_show</code> can print — it reads
          one flag bit and picks one of two words. Whatever is here came from somewhere else;
          switch to the raw view to see it.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="setgroups() in this namespace" value={setgroups.setting!} />
        <Stat label="can this answer change" value={summary.final ? 'never again' : 'yes — deny is still writable'} />
        <Stat label="conditions this file reports" value={`1 of ${checks.length}`} />
      </section>

      {isDenied(setgroups) && (
        <p className="notice notice--warn" role="status" data-testid="denied">
          <strong>
            <code>setgroups()</code> and <code>initgroups()</code> answer <code>EPERM</code> in this
            namespace, and will for as long as it exists.
          </strong>{' '}
          A process in here cannot drop a supplementary group and cannot pick one up: the groups it
          came in with are the groups it has. Denying is <strong>one-way</strong> — writing{' '}
          <code>{SETGROUPS_ALLOW}</code> back is <code>EPERM</code> — and a namespace created inside
          this one starts denied too, so there is no nesting out of it either. This is the only
          value of the two that settles anything.
        </p>
      )}

      {isAllowed(setgroups) && (
        <p className="notice" role="status" data-testid="allowed">
          <strong>
            This says one of three conditions is met, and nothing about the other two.
          </strong>{' '}
          <code>userns_may_setgroups</code> also wants a <code>gid_map</code> that has been written
          — groups mean nothing in a namespace with no mapping, so a <em>brand-new</em> namespace
          reads <code>{SETGROUPS_ALLOW}</code> here and every <code>setgroups()</code> in it still
          fails — and it wants <code>CAP_SETGID</code> in this namespace. So{' '}
          <code>{SETGROUPS_ALLOW}</code> is necessary and not sufficient, which is the opposite of
          how the word reads.
        </p>
      )}

      <div className="card mounts setg">
        <table className="mounts__table setg__table" aria-label="Conditions setgroups needs">
          <thead>
            <tr>
              <th scope="col">Condition</th>
              <th scope="col">This file</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((condition) => (
              <tr
                className={condition.reported ? 'setg__row setg__row--reported' : 'setg__row'}
                key={condition.name}
              >
                <th scope="row" className="setg__name">
                  {condition.name}
                </th>
                <td className="setg__answer">
                  {condition.met === null ? (
                    <>
                      <span className="chip muted">not here</span>
                      {condition.where !== undefined && (
                        <span className="setg__where muted">
                          <code>{condition.where}</code>
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={condition.met ? 'chip setg__chip--met' : 'chip chip--warn'}>
                      {condition.met ? 'met' : 'not met'}
                    </span>
                  )}
                </td>
                <td className="setg__what muted">{condition.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {certainlyFails(setgroups) && (
        <p className="notice" role="status" data-testid="short-circuit">
          <strong>The other two conditions do not matter here.</strong> This one is not met, and
          they are an <em>and</em> — so however the <code>gid_map</code> reads and whatever
          capabilities a process holds, <code>setgroups()</code> fails. It is the one case where
          this file alone is the whole answer.
        </p>
      )}

      {origin !== null && (
        <p className="notice" role="status" data-testid="origin">
          <strong>How this namespace came to say {setgroups.setting}:</strong> {origin.summary}.{' '}
          {isDenied(setgroups) ? (
            <>
              The kernel refuses <code>{SETGROUPS_DENY}</code> once <code>gid_map</code> has any
              extent, so the write must have come first — and the reason to make it is to be allowed
              to write the map, which is the bargain an unprivileged writer has to strike.{' '}
              <code>/proc/&lt;pid&gt;/gid_map</code> beside this will very likely show a single
              range of a single id, which is all such a writer may ask for.
            </>
          ) : (
            <>
              <code>/proc/&lt;pid&gt;/gid_map</code> beside this says which: the identity map is the
              initial namespace, and anything wider than one id took <code>CAP_SETGID</code> in the
              parent — the path that never needs a denial.
            </>
          )}
        </p>
      )}

      <p className="notice" role="status" data-testid="namespace">
        <strong>This is the namespace&rsquo;s answer, not this process&rsquo;s.</strong> The flag
        hangs off <code>user_namespace</code>, so every process sharing one reads the same word, and
        reading it under another pid in the same namespace asks the same question over again. Two
        pids differ here only when they are in different user namespaces — the same way{' '}
        <code>uid_map</code> and <code>gid_map</code> do.
      </p>

      {!isFinal(setgroups) && (
        <p className="notice" role="status" data-testid="still-writable">
          <strong>
            This answer can still become <code>{SETGROUPS_DENY}</code>, but only while no{' '}
            <code>gid_map</code> has been written.
          </strong>{' '}
          After that the door shuts: writing <code>{SETGROUPS_DENY}</code> to a namespace whose map
          has any extent is <code>EPERM</code>. Which of the two states this namespace is in is not
          in this file — the <code>gid_map</code> beside it says, by being empty or not.
        </p>
      )}

      {!setgroups.printed && (
        <p className="notice notice--warn" role="status" data-testid="reformatted">
          This is not the shape <code>proc_setgroups_show</code> writes:{' '}
          {setgroups.terminated ? 'the word in lower case' : 'the word'} and one newline after it.
          Something between here and the kernel has reformatted the answer — the value above is read
          from it as it stands.
        </p>
      )}

      {note}
    </>
  );
}
