import { useMemo } from 'react';
import {
  formatBytes,
  formatCommand,
  MAX_ARG_STRLEN,
  parsePidCmdline,
  quoteArgument,
  summarize,
} from '../lib/pid-cmdline';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function PidCmdlineView({ content }: { content: string }) {
  const command = useMemo(() => parsePidCmdline(content), [content]);
  const summary = useMemo(() => summarize(command), [command]);

  if (summary.empty) {
    return (
      <p className="notice notice--warn" data-testid="empty">
        This process has <strong>no argument vector at all</strong> — the file is empty rather than
        unreadable. That is what a <strong>kernel thread</strong> looks like, since it was never
        started with arguments, and equally what a <strong>zombie</strong> looks like, since the
        memory its arguments were in is already gone. Nothing here can tell the two apart:{' '}
        <code>/proc/&lt;pid&gt;/stat</code> says which, with a state of <code>Z</code> and a name in
        brackets.
      </p>
    );
  }

  const secretAt = new Map(summary.secrets.map((secret) => [secret.index, secret.reason]));

  return (
    <>
      {summary.secrets.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="secrets">
          {summary.secrets.length === 1 ? 'An argument' : `${summary.secrets.length} arguments`}{' '}
          here {summary.secrets.length === 1 ? 'looks like it carries' : 'look like they carry'} a{' '}
          <strong>credential</strong> — {summary.secrets.map((secret) => secret.reason).join(', ')}.
          This file is mode <code>0444</code>: every user on the machine can read it, and every{' '}
          <code>ps</code> already has. A secret passed as an argument is disclosed the moment the
          process starts, which is why it belongs in the environment, a file, or a pipe —{' '}
          <code>/proc/&lt;pid&gt;/environ</code> is <code>0400</code>, readable by its owner alone.
        </p>
      )}

      {summary.title && (
        <p className="notice notice--warn" role="status" data-testid="title">
          This is not the vector the process was started with. It <strong>overwrote its own
          argv</strong> with a status line — what <code>postgres</code>, <code>nginx</code> and
          anything else using <code>setproctitle</code> do, so that <code>ps</code> shows what the
          worker is up to.{' '}
          {command.separated
            ? `The ${summary.padding} NULs behind it are the space the original arguments took and this no longer uses.`
            : 'There is no NUL anywhere in the file, so there is no argument boundary left to read.'}{' '}
          What the process is really running is in <code>/proc/&lt;pid&gt;/exe</code>.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="arguments" value={String(summary.count)} />
        <Stat label="bytes" value={String(summary.bytes)} />
        <Stat label="argv[0] says" value={summary.program ?? '—'} />
      </section>

      <p className="models" data-testid="flags">
        {summary.loginShell && (
          <span
            className="chip chip--flag"
            title="argv[0] carries a leading dash, which is how a shell is told it is a login shell — it is a marker, not part of the name"
          >
            login shell
          </span>
        )}
        {!summary.terminated && (
          <span
            className="chip chip--flag"
            title="No NUL after the last argument, where the kernel normally writes one"
          >
            no closing NUL
          </span>
        )}
        {summary.padding > 0 && (
          <span
            className="chip chip--model"
            title="NULs past the terminator: space a rewritten argv no longer uses, which is byte-for-byte the same as that many empty arguments at the end"
          >
            padding <span className="count">{summary.padding}</span>
          </span>
        )}
        {summary.blanks.length > 0 && (
          <span
            className="chip chip--model"
            title="Arguments that are the empty string, which are real arguments and easy to lose"
          >
            empty arguments <span className="count">{summary.blanks.length}</span>
          </span>
        )}
        {summary.quoted.length > 0 && (
          <span
            className="chip chip--model"
            title="Arguments holding whitespace: the ones the rebuilt line below has to quote"
          >
            need quoting <span className="count">{summary.quoted.length}</span>
          </span>
        )}
      </p>

      <section className="card pcmd__block">
        <h3 className="pcmd__heading">As a shell would take it</h3>
        <pre className="pcmd__command" data-testid="command">
          {formatCommand(command)}
        </pre>
        <p className="pcmd__caption muted">
          Reconstructed. The spaces and quotes are this page&rsquo;s — the file had neither, only
          NULs, which is exactly what makes this line safe to read and unsafe to trust as the
          original text.
        </p>
      </section>


      <div className="card mounts pcmd">
        <table className="mounts__table pcmd__table" aria-label="Arguments">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Argument</th>
              <th scope="col">Bytes</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {command.args.map((argument, index) => (
              <tr
                // The index is the identity here: two arguments can be equal.
                key={index}
                className={secretAt.has(index) ? 'pcmd__row pcmd__row--secret' : 'pcmd__row'}
              >
                <td className="pcmd__index">{index}</td>
                <td className="pcmd__arg">
                  {argument === '' ? (
                    <span className="muted">(empty)</span>
                  ) : (
                    argument
                  )}
                </td>
                <td className="pcmd__number">{argument.length}</td>
                <td className="pcmd__notes">
                  {index === 0 && (
                    <span
                      className="chip chip--type"
                      title="What the caller passed as argv[0] — chosen by whoever called execve, so it need not be the program at all"
                    >
                      argv[0]
                    </span>
                  )}
                  {secretAt.has(index) && (
                    <span className="chip chip--ro" title="World-readable, and already read">
                      {secretAt.get(index)}
                    </span>
                  )}
                  {argument === '' && (
                    <span className="chip" title="The empty string, passed as an argument">
                      empty
                    </span>
                  )}
                  {/\s/.test(argument) && (
                    <span className="chip" title={`Quoted above as ${quoteArgument(argument)}`}>
                      holds whitespace
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        This is <code>argv</code> as <code>execve</code> left it: the arguments one after another
        with a <strong>NUL between them</strong> and one after the last. Nothing separates them but
        that, which is why <code>cat</code> runs them together and why a page like this one has to
        put the spaces back. Three things it is easy to read wrongly.{' '}
        <strong>
          <code>argv[0]</code> is not the program
        </strong>{' '}
        — it is whatever the caller passed, which is how <code>busybox</code> knows which applet to
        be and how a login shell is told to read the profile;{' '}
        <code>/proc/&lt;pid&gt;/exe</code> is the answer to what is actually running.{' '}
        <strong>A process can overwrite all of it</strong> with a status line, so what is here may
        be a title rather than a vector. And <strong>an empty file is not an error</strong>: a
        kernel thread never had arguments and a zombie no longer has the memory they were in.{' '}
        <code>execve</code> caps a single argument at {formatBytes(MAX_ARG_STRLEN)} and the whole
        vector at a quarter of <code>RLIMIT_STACK</code>, which is where{' '}
        <em>Argument list too long</em> comes from. And the file is world-readable, where{' '}
        <code>/proc/&lt;pid&gt;/environ</code> is not — the reason a secret passed as an argument
        is already public.
      </p>
    </>
  );
}
