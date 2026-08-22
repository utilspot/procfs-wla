import { useMemo } from 'react';
import {
  abisOf,
  isBuiltIn,
  parseExecDomains,
  personalityCount,
  summarize,
  type ExecDomain,
} from '../lib/execdomains';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** `0` for a single personality number, `1–5` for a range. */
function range(domain: ExecDomain): string {
  return domain.low === domain.high ? String(domain.low) : `${domain.low}–${domain.high}`;
}

function DomainRow({ domain }: { domain: ExecDomain }) {
  const abis = abisOf(domain);
  const count = personalityCount(domain);

  return (
    <tr className="execdom__row">
      <td
        className="execdom__personality"
        title={count === 1 ? 'one personality number' : `${count} personality numbers`}
      >
        {range(domain)}
      </td>
      <td className="execdom__name">{domain.name}</td>
      <td className="execdom__abis">
        {abis.length === 0 ? (
          // A number outside the PER_* list stands for no ABI the kernel names,
          // so nothing is put in its place.
          <span className="muted" title="No ABI in the kernel's list uses this personality number">
            —
          </span>
        ) : (
          <ul className="chips">
            {abis.map((abi) => (
              <li key={abi} className="chip">
                {abi}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="execdom__module">
        {isBuiltIn(domain) ? (
          <span className="muted" title="Compiled into the kernel, not loaded as a module">
            built in
          </span>
        ) : (
          domain.module
        )}
      </td>
    </tr>
  );
}

export function ExecDomainsView({ content }: { content: string }) {
  const info = useMemo(() => parseExecDomains(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  if (info.domains.length === 0) {
    return (
      <p className="notice notice--warn">
        No exec domains found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.overlapping.length > 0 && (
        <p className="notice notice--warn" role="status">
          More than one domain claims personality{' '}
          {summary.overlapping.length === 1 ? '' : 'numbers '}
          {summary.overlapping.join(', ')}. The kernel refused to register a domain overlapping one
          already there, so this is not something a running machine produced.
        </p>
      )}

      {/*
       * The single fixed line means nothing about this machine, so it is said
       * plainly rather than dressed up as a finding.
       */}
      {summary.stub && (
        <p className="notice" role="status">
          This is the fixed line every kernel since <strong>4.1</strong> prints — exec domains were
          removed then, and the file was kept only so that tools reading it do not break. An older
          kernel with no ABI module loaded printed the same line, so the file alone cannot tell the
          two apart.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="domains" value={String(summary.domains)} />
        <Stat label="personalities" value={String(summary.personalities)} />
        <Stat label="from modules" value={String(summary.fromModules.length)} />
      </section>

      {summary.fromModules.length > 0 && (
        <p className="models">
          {summary.fromModules.map((domain) => (
            <span key={`${domain.low}-${domain.name}`} className="chip chip--model">
              {domain.module} <span className="count">{domain.name}</span>
            </span>
          ))}
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table execdom__table" aria-label="Registered exec domains">
          <thead>
            <tr>
              <th scope="col">Personality</th>
              <th scope="col">Domain</th>
              <th scope="col">ABI</th>
              <th scope="col">Provided by</th>
            </tr>
          </thead>
          <tbody>
            {info.domains.map((domain) => (
              <DomainRow key={`${domain.low}-${domain.high}-${domain.name}`} domain={domain} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        An exec domain claimed a range of <strong>personality numbers</strong> — the low byte of
        what <code>personality(2)</code> sets — and gave processes running under them another
        system&rsquo;s signal numbering and syscall behaviour, which is how the loadable ABI modules
        ran SVR4, SCO or Solaris binaries. The <strong>ABI</strong> column names the numbers the
        kernel itself knows; a domain is free to claim one it does not, and nothing is said about
        those. Exec domains were removed in Linux 4.1, so on any current kernel this file is a
        single fixed line rather than a description of the machine.
      </p>
    </>
  );
}
