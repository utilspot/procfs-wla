import { useMemo } from 'react';
import { parseVersion, preemption, series, type KernelVersion } from '../lib/version';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  );
}

/** The fields the banner did not carry are dropped rather than shown empty. */
function BuildFields({ version }: { version: KernelVersion }) {
  const builtBy =
    version.buildUser === null
      ? null
      : version.buildHost === null
        ? version.buildUser
        : `${version.buildUser} on ${version.buildHost}`;

  return (
    <table className="cpu-card__fields">
      <tbody>
        <Field label="Release">
          <code>{version.release}</code>
        </Field>
        <Field label="Version">{version.version}</Field>
        {version.localVersion !== null && (
          <Field label="Local version">{version.localVersion}</Field>
        )}
        {version.buildNumber !== null && (
          <Field label="Build">
            #{version.buildNumber}
            {version.buildTag !== null && ` (${version.buildTag})`}
          </Field>
        )}
        {builtBy !== null && <Field label="Built by">{builtBy}</Field>}
        {version.built !== null && <Field label="Built">{version.built}</Field>}
        {version.toolchain.length > 0 && (
          <Field label="Toolchain">
            <ul className="version__toolchain">
              {version.toolchain.map((tool) => (
                <li key={tool}>{tool}</li>
              ))}
            </ul>
          </Field>
        )}
      </tbody>
    </table>
  );
}

export function VersionView({ content }: { content: string }) {
  const version = useMemo(() => parseVersion(content), [content]);

  if (version === null) {
    return (
      <p className="notice notice--warn">
        This file is not a kernel version banner. Switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  return (
    <>
      <section className="summary">
        <Stat label="kernel" value={version.version} />
        <Stat label="series" value={series(version)} />
        {version.localVersion !== null && <Stat label="flavour" value={version.localVersion} />}
        <Stat label="preemption" value={preemption(version)} />
      </section>

      <p className="models">
        <span className="chip chip--model">{version.os}</span>
        {version.flags.map((flag) => (
          <span key={flag} className="chip chip--flag">
            {flag}
          </span>
        ))}
      </p>

      <section className="card machine">
        <h3>Build</h3>
        <BuildFields version={version} />
      </section>
    </>
  );
}
