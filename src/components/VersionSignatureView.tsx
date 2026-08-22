import { useMemo } from 'react';
import {
  DERIVATIVE_ABI,
  describeFlavour,
  fieldsOf,
  parseVersionSignature,
  summarize,
} from '../lib/version_signature';

/** The two things a chip has to explain, kept out of the markup. */
const BACKPORT_TITLE =
  'A newer series built for an older release, which is what an HWE kernel is — and this suffix ' +
  'is not in uname -r';

const DERIVATIVE_TITLE =
  `Cloud and board kernels number their ABI from ${DERIVATIVE_ABI} upwards, ` +
  `separately from generic's`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function VersionSignatureView({ content }: { content: string }) {
  const signature = useMemo(() => parseVersionSignature(content), [content]);
  const summary = useMemo(() => (signature === null ? null : summarize(signature)), [signature]);
  const fields = useMemo(() => (signature === null ? [] : fieldsOf(signature)), [signature]);

  if (signature === null || summary === null) {
    return (
      <p className="notice notice--warn">
        No version signature found in this file. It is one line of a vendor, a package version and
        an upstream release — switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.seriesMismatch && (
        <p className="notice notice--warn" role="status">
          The package version and the upstream release do not agree on the series:{' '}
          <code>{signature.base}</code> against <code>{summary.upstream}</code>. A package is built
          from the upstream tree it names, so these two should never point at different series.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="really running" value={summary.upstream === '' ? '—' : summary.upstream} />
        <Stat label="uname -r says" value={summary.uname ?? '—'} />
        <Stat label="flavour" value={summary.flavour ?? '—'} />
        <Stat
          label="ABI · upload"
          value={
            summary.abi === null ? '—' : `${summary.abi} · ${summary.upload ?? '—'}`
          }
        />
      </section>

      {/* Suppressed when the series disagree: that warning supersedes this,
          since the upstream release is then the field in doubt. */}
      {summary.hidesUpstream && !summary.seriesMismatch && (
        <p className="notice" role="status" data-testid="hidden-upstream">
          <code>uname -r</code> reports <strong>{summary.uname}</strong> on this machine, and the
          source tree is really upstream <strong>{summary.upstream}</strong>. Ubuntu freezes the
          last component of the base version, so the number in <code>uname -r</code> and in{' '}
          <code>/proc/version</code> names the series and says nothing about how far through its
          stable releases you are. Asked whether a fix released in a particular stable version is
          present, this is the field that answers.
        </p>
      )}

      <p className="models" data-testid="flags">
        <span className="chip chip--model" title="Only Ubuntu kernels ship this file at all">
          {summary.vendor}
        </span>
        {summary.backport !== null && (
          <span
            className="chip chip--flag"
            title={BACKPORT_TITLE}
          >
            backported to <span className="count">{summary.backport}</span>
          </span>
        )}
        {summary.derivative && (
          <span
            className="chip chip--flag"
            title={DERIVATIVE_TITLE}
          >
            derivative ABI <span className="count">{summary.abi}</span>
          </span>
        )}
        {summary.flavour !== null && describeFlavour(summary.flavour) !== null && (
          <span className="chip chip--model" title={describeFlavour(summary.flavour) ?? undefined}>
            {summary.flavour}
          </span>
        )}
      </p>

      <div className="card mounts vsig">
        <table className="mounts__table vsig__table" aria-label="Version signature fields">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Value</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.label} className="vsig__row">
                <td className="vsig__label">{field.label}</td>
                <td className="vsig__value">{field.value}</td>
                <td className="vsig__note">{field.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        This file exists because <code>uname -r</code> does not answer the question people ask it.
        Ubuntu freezes the last component of the base version at the series&rsquo; <code>.0</code>{' '}
        and never moves it, so the release in <code>uname -r</code> and in{' '}
        <code>/proc/version</code> tells you the series and nothing more — the third field here is
        the stable release the source actually is. The package version also carries{' '}
        <strong>two numbers where it looks like one</strong>: the <code>-{summary.abi ?? 'N'}</code>{' '}
        is the ABI number, bumped only when the kernel ABI changes and the part{' '}
        <code>uname -r</code> shows, while the <code>.{summary.upload ?? 'N'}</code> after it is the
        upload number, bumped on every build and shown nowhere in <code>uname -r</code> — two
        machines that agree there can still be running different builds. A{' '}
        <code>~24.04.1</code>-style suffix marks a backport, which is what an HWE kernel is, and it
        does not reach <code>uname -r</code> either. A four-digit ABI is a cloud or board
        derivative counting from {DERIVATIVE_ABI} rather than a machine that has seen a thousand
        ABI breaks. And the file being here at all says the host is Ubuntu: nothing else ships it.
      </p>
    </>
  );
}
