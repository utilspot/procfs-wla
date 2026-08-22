import { useMemo } from 'react';
import {
  isEmpty,
  isMultiline,
  isSecret,
  isShadowed,
  parsePidEnviron,
  secretsIn,
  type EnvVariable,
  type Environment,
  type Secret,
} from '../lib/pid-environ';

function VariableRow({
  variable,
  environment,
  secrets,
}: {
  variable: EnvVariable;
  environment: Environment;
  secrets: readonly Secret[];
}) {
  const shadowed = isShadowed(environment, variable);

  return (
    <tr className={shadowed ? 'env__row env__row--shadowed' : 'env__row'}>
      <td className="env__name">
        {variable.name}
        {shadowed && (
          <span className="chip" title="Written earlier too, and getenv returns that one">
            shadowed
          </span>
        )}
      </td>
      <td className="env__value">
        {variable.value === '' ? (
          <span className="muted" title="Set, and set to nothing — which is not the same as unset">
            empty
          </span>
        ) : (
          <span className={isMultiline(variable) ? 'env__text env__text--wrapped' : 'env__text'}>
            {variable.value}
          </span>
        )}
        {isSecret(secrets, variable) && (
          <span
            className="chip chip--warn"
            title="Looks like a credential — and it is on this page now"
          >
            secret
          </span>
        )}
      </td>
    </tr>
  );
}

export function PidEnvironView({ content }: { content: string }) {
  const environment = useMemo(() => parsePidEnviron(content), [content]);
  const secrets = useMemo(() => secretsIn(environment.variables), [environment]);

  if (isEmpty(environment)) {
    return (
      <p className="notice" role="status">
        This file is empty, which is not an error: a kernel thread has no memory for an environment
        to be in, and neither has a process that has already exited. Which of the two this is
        cannot be told from here — <code>stat</code> beside it says.
      </p>
    );
  }

  return (
    <>
      {secrets.length > 0 && (
        <p className="notice notice--warn" role="status">
          {secrets.map((secret) => secret.name).join(', ')}{' '}
          {secrets.length === 1 ? 'looks like it carries' : 'look like they carry'} a
          credential. This file is <code>0400</code> and ptrace-checked, so unlike{' '}
          <code>cmdline</code> beside it the machine has not shown this to anyone — but the value
          lives as long as the process, is inherited by everything it starts, and is on this page
          now.
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table env__table" aria-label="Environment variables">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {environment.variables.map((variable) => (
              <VariableRow
                key={variable.index}
                variable={variable}
                environment={environment}
                secrets={secrets}
              />
            ))}
          </tbody>
        </table>
      </div>

      {environment.strays.length > 0 && (
        <p className="notice" role="status">
          {environment.strays.length === 1 ? 'One entry has' : `${environment.strays.length} entries have`}{' '}
          no <code>=</code> in{' '}
          {environment.strays.length === 1 ? 'it' : 'them'}:{' '}
          {environment.strays.map((stray) => (
            <code key={stray.index} className="env__stray">
              {stray.text}
            </code>
          ))}
          . <code>execve</code> takes an array of strings and asks nothing of them, so this is legal
          to be started with and unusable to read — <code>getenv</code> never returns it.
        </p>
      )}

      <p className="disks__note muted">
        The block is <code>NAME=value</code> one after another with a{' '}
        <strong>NUL between them</strong>, which is why <code>cat</code> runs the whole environment
        into one unreadable line — the separators print as nothing. A value may hold{' '}
        <code>=</code> itself, so an entry splits at its <strong>first</strong> one and{' '}
        <code>LS_COLORS=rs=0:di=01;34:…</code> is a single variable. What is here is the
        environment <strong>as <code>execve</code> was handed it</strong>: the kernel prints the
        bytes between <code>mm-&gt;env_start</code> and <code>mm-&gt;env_end</code>, and{' '}
        <code>setenv()</code> puts its new strings on the heap instead — so a variable changed
        after exec normally still reads here as whatever it was, and one added after exec is not
        here at all. A name written twice is kept twice, because nothing deduplicates the block and{' '}
        <code>getenv</code> walks it from the start: the <em>first</em> is the one that counts.
        Unlike <code>cmdline</code>, which is <code>0444</code> for every user on the machine, this
        file is <code>0400</code> with a ptrace check on top, so another user reading it gets{' '}
        <code>EACCES</code> — the 403 this page reports rather than a fault.
      </p>
    </>
  );
}
