import { useMemo } from 'react';
import {
  describeValue,
  INT_MAX,
  MEMORY_CLAMP,
  parseUcount,
  summarize,
  WRITE_CAPABILITY,
  type UcountLimit,
} from '../lib/sys-user-ucount';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * The page every file in `/proc/sys/user` gets, which is one page rather than
 * twelve: they are one mechanism, and what differs between them — the object,
 * the call that makes one, the errno and where the default comes from — is
 * carried by the {@link UcountLimit} this is handed.
 *
 * **It is about the one file.** The other eleven are named on the listing of
 * the directory they are all in — see {@link SysUserDirectoryView}, which is
 * where the table of every limit against what it bounds lives — and the trail
 * at the top of this page is the way there. Carrying that table here as well
 * put eleven rows a reader did not ask for under the one number they did, on
 * every one of the twelve pages.
 */
export function SysUserUcountView({ limit, content }: { limit: UcountLimit; content: string }) {
  const value = useMemo(() => parseUcount(content), [content]);
  const summary = useMemo(() => (value === null ? null : summarize(limit, value)), [limit, value]);

  if (value === null || summary === null) {
    return (
      <p className="notice notice--warn">
        No number in this file. A <code>ucount</code> limit is one whole number between 0 and{' '}
        <code>{INT_MAX.toLocaleString('en-US')}</code> and nothing else — switch to the raw view to
        see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.disabled && (
        <p className="notice notice--warn" role="status" data-testid="disabled">
          <strong>No {limit.object} can be created in this user namespace.</strong> The limit is 0,
          so the next <code>{limit.createdBy.split(' or ')[0]}</code> fails with{' '}
          <code>{limit.errno}</code> — whoever is asking, and however few exist. What already exists
          is untouched: lowering a ceiling stops new ones rather than destroying old ones.
        </p>
      )}

      {summary.fresh && (
        <p className="notice" role="status" data-testid="fresh">
          <strong>This is a user namespace with no limit of its own.</strong>{' '}
          <code>{INT_MAX.toLocaleString('en-US')}</code> is <code>INT_MAX</code>, which is what{' '}
          <code>create_user_ns</code> writes into every one of these counters for a namespace it
          makes — so a container in its own user namespace reads two billion here and in the eleven
          files beside it. It is not the licence it looks like: every {limit.object.replace(/s$/, '')}{' '}
          is charged to <strong>every ancestor user namespace as well</strong>, and the first of
          them to be at its own limit is the one that answers.
        </p>
      )}

      {summary.atMemoryCeiling && (
        <p className="notice" role="status" data-testid="clamped">
          That is the ceiling the default is clamped to. {limit.defaultNote}, so a machine with
          enough memory to pass {MEMORY_CLAMP.max.toLocaleString('en-US')} stops here — the number
          says the machine is large rather than that anybody chose it.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat
          label="ceiling"
          value={describeValue(value)}
          title={`How many ${limit.object} any one user in this user namespace may hold at once`}
        />
        <Stat
          label="counted per"
          value="uid × namespace"
          title="inc_ucount is charged to the effective uid in the creating user namespace, and to that uid in every ancestor of it"
        />
        <Stat
          label="at the limit"
          value={limit.errno}
          title={`What ${limit.createdBy.split(' or ')[0]} returns once the counter is there`}
        />
        {summary.impliedThreadsMax !== null && (
          <Stat
            label="if still default"
            value={summary.impliedThreadsMax.toLocaleString('en-US')}
            title="fork_init sets every namespace limit to max_threads/2 at boot, so a limit still at its default implies this threads-max"
          />
        )}
      </section>

      <p className="disks__note" data-testid="reading">
        {summary.disabled || summary.fresh ? (
          <>
            The number is a <strong>ceiling and not a count</strong>: nothing here says how many{' '}
            {limit.object} exist. The kernel keeps that figure beside this one and publishes none of
            it.
          </>
        ) : (
          <>
            Any one user in this user namespace may hold{' '}
            <strong>{summary.limit.toLocaleString('en-US')}</strong> {limit.object} at once — made
            with <code>{limit.createdBy}</code>, and refused with <code>{limit.errno}</code> past
            that. It is a <strong>ceiling and not a count</strong>: nothing here says how many
            exist, and the kernel keeps that figure beside this one and publishes none of it.
            {summary.impliedThreadsMax !== null && (
              <>
                {' '}
                If this is still the boot default it was set to half the thread limit, which is
                where the odd-looking number comes from —{' '}
                <code>/proc/sys/kernel/threads-max</code> would read{' '}
                {summary.impliedThreadsMax.toLocaleString('en-US')}.
              </>
            )}
          </>
        )}
      </p>

      <p className="notice" data-testid="note">
        {limit.note}
      </p>

      <p className="disks__note muted">
        Everything under <code>/proc/sys</code> is a <strong>setting rather than a report</strong>:
        it is writable, and what it holds is what the kernel will allow rather than what it has
        done. These twelve are one mechanism, declared together in{' '}
        <code>kernel/ucount.c</code> and listed together in{' '}
        <code>/proc/sys/user</code>, and four things are true of all of them.{' '}
        <strong>The limit is per user, per user namespace</strong> — each is charged with{' '}
        <code>inc_ucount(ns, current_euid(), …)</code>, so it is what any one uid may hold here,
        not a total for the namespace and not one for the machine.{' '}
        <strong>The charge is recursive</strong>: <code>inc_ucount</code> walks from the creating
        namespace up through every ancestor and checks each one&rsquo;s limit, which is the whole
        design — creating a user namespace cannot be a way out of the limits you already have, and
        that is why the <code>INT_MAX</code> a fresh namespace starts with is not a licence.{' '}
        <strong>The defaults come from three unrelated rules</strong>: the eight namespace limits
        are <code>max_threads/2</code>, the two that hand out descriptors are a flat 128, and the
        two that count watches and marks are 1% of memory clamped to{' '}
        {MEMORY_CLAMP.min.toLocaleString('en-US')} …{' '}
        {MEMORY_CLAMP.max.toLocaleString('en-US')}. And{' '}
        <strong>the mode is not what the table says</strong>: <code>set_permissions</code> gives a
        reader with <code>{WRITE_CAPABILITY}</code> in the owning user namespace the{' '}
        <code>0644</code> it declares and everyone else read-only access, so what{' '}
        <code>ls -l</code> shows depends on who is asking. What differs is the errno — this one is{' '}
        <code>{limit.errno}</code> — and, for four of them, a second name:{' '}
        {limit.alsoAt === undefined ? (
          <>
            the inotify and fanotify limits are also registered under{' '}
            <code>/proc/sys/fs</code>, pointing at the same counters.
          </>
        ) : (
          <>
            this counter is also <code>{limit.alsoAt}</code>, which is the same number by an older
            name — with one difference worth knowing, that the <code>fs/</code> spelling always
            names the initial user namespace&rsquo;s copy while this one is per namespace.
          </>
        )}
      </p>
    </>
  );
}
