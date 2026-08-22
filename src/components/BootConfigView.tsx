import { useMemo } from 'react';
import {
  isFlag,
  parseBootConfig,
  sections,
  summarize,
  type BootConfigEntry,
  type Section,
} from '../lib/bootconfig';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function EntryRow({ entry }: { entry: BootConfigEntry }) {
  // The section name is the heading above, so the row shows the rest of the path.
  const rest = entry.path.slice(1);

  return (
    <tr className="boot__row">
      <td className="boot__key">
        {rest.length === 0 ? (
          <span className="muted">(section itself)</span>
        ) : (
          rest.map((segment, index) => (
            <span key={`${segment}-${index}`}>
              {index > 0 && <span className="boot__dot">.</span>}
              {segment}
            </span>
          ))
        )}
      </td>
      <td className="boot__values">
        {isFlag(entry) ? (
          <span className="chip" title="A key with no value">
            flag
          </span>
        ) : (
          <ul className="chips">
            {entry.values.map((value, index) => (
              <li key={`${value}-${index}`} className="chip boot__value">
                {value}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function SectionCard({ section }: { section: Section }) {
  return (
    <section className="boot__section">
      <h3>
        <code>{section.name}</code>
        <span className="chip chip--type" title="Where the kernel sends this section">
          {section.destination}
        </span>
        <span className="count">{section.entries.length}</span>
      </h3>

      <div className="card mounts">
        <table className="mounts__table boot__table" aria-label={`${section.name} keys`}>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {section.entries.map((entry) => (
              <EntryRow key={entry.key} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function BootConfigView({ content }: { content: string }) {
  const entries = useMemo(() => parseBootConfig(content), [content]);
  const summary = useMemo(() => summarize(entries), [entries]);
  const grouped = useMemo(() => sections(entries), [entries]);

  if (entries.length === 0) {
    return (
      <p className="notice notice--warn">
        This machine booted without a boot config, which is the usual case —{' '}
        <code>/proc/bootconfig</code> is empty unless the initrd carried one. Switch to the raw
        view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      <section className="summary">
        <Stat label="keys" value={String(summary.keys)} />
        <Stat label="values" value={String(summary.values)} />
        <Stat label="sections" value={String(summary.sections)} />
        <Stat label="deepest key" value={`${summary.depth} levels`} />
      </section>

      <p className="models">
        {summary.toKernel > 0 && (
          <span className="chip chip--model">
            to the kernel command line <span className="count">{summary.toKernel}</span>
          </span>
        )}
        {summary.toInit > 0 && (
          <span className="chip chip--model">
            to init <span className="count">{summary.toInit}</span>
          </span>
        )}
        {summary.flags > 0 && (
          <span className="chip chip--model">
            flags <span className="count">{summary.flags}</span>
          </span>
        )}
      </p>

      <div className="boot">
        {grouped.map((section) => (
          <SectionCard key={section.name} section={section} />
        ))}
      </div>

      <p className="disks__note muted">
        The dots are structure: this file is the flattened form of nested blocks written in the
        initrd, so <code>ftrace.instance.boot.events</code> is <code>events</code> inside{' '}
        <code>boot</code> inside <code>instance</code>. Two sections are special —{' '}
        <code>kernel.*</code> is appended to the kernel command line and <code>init.*</code> is
        handed to init; everything else waits for whichever subsystem reads it. A key may carry
        several values, and one with none is a flag.
      </p>
    </>
  );
}
