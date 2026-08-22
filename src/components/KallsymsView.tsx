import { useMemo } from 'react';
import {
  parseKallsyms,
  scopeOf,
  summarize,
  typeName,
  type KernelSymbol,
} from '../lib/kallsyms';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** What each scope means, since the same letter case says two things. */
const SCOPES = {
  global: { label: 'global', title: 'Visible across the kernel' },
  local: { label: 'static', title: 'Static to the file it was compiled from' },
  exported: {
    label: 'exported',
    title: 'Exported with EXPORT_SYMBOL, so another module can link against it',
  },
  internal: { label: 'internal', title: 'Not exported: nothing outside this module can use it' },
} as const;

function SymbolRow({ symbol }: { symbol: KernelSymbol }) {
  const scope = scopeOf(symbol);
  const described = typeName(symbol.type);

  return (
    <tr className="ksym__row">
      <td className="ksym__address">{symbol.address}</td>
      <td className="ksym__type">
        <span
          className="chip"
          title={described ?? 'A type letter no tool names'}
        >
          {symbol.type}
        </span>
      </td>
      <td className="ksym__name">{symbol.name}</td>
      <td className="ksym__scope">
        {scope === null ? (
          <span className="muted" title="This letter has no case to read a scope from">
            —
          </span>
        ) : (
          <span className="chip" title={SCOPES[scope].title}>
            {SCOPES[scope].label}
          </span>
        )}
      </td>
      <td className="ksym__module">
        {symbol.module === null ? (
          <span className="muted" title="Built into the kernel">
            —
          </span>
        ) : (
          symbol.module
        )}
      </td>
    </tr>
  );
}

export function KallsymsView({ content }: { content: string }) {
  const info = useMemo(() => parseKallsyms(content), [content]);
  const summary = useMemo(() => summarize(info), [info]);

  if (info.symbols.length === 0) {
    return (
      <p className="notice notice--warn">
        No symbols found in this file. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {/*
       * Zeroed addresses are kptr_restrict, not a kernel whose symbols all sit
       * at zero — and every one of them being zero is the only way to tell.
       */}
      {summary.hidden && (
        <p className="notice notice--warn" role="status">
          Every address here is zero, which is <code>kptr_restrict</code> hiding kernel pointers
          from a reader without <code>CAP_SYSLOG</code>: the names, the types and the modules all
          arrive, and only the addresses are replaced. Read it as root, with{' '}
          <code>kptr_restrict</code> at 0, to see them.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="symbols" value={summary.total.toLocaleString()} />
        <Stat label="from modules" value={summary.fromModules.toLocaleString()} />
        <Stat label="modules" value={String(summary.modules.length)} />
        {summary.fromModules > 0 && (
          <Stat label="exported" value={String(summary.exported)} />
        )}
      </section>

      <p className="models" data-testid="types">
        {summary.types.map(({ type, count }) => (
          <span
            key={type}
            className="chip chip--model"
            title={typeName(type) ?? 'A type letter no tool names'}
          >
            {type} <span className="count">{count.toLocaleString()}</span>
          </span>
        ))}
      </p>

      <div className="card mounts">
        <table className="mounts__table ksym__table" aria-label="Kernel symbols">
          <thead>
            <tr>
              <th scope="col">Address</th>
              <th scope="col">Type</th>
              <th scope="col">Symbol</th>
              <th scope="col">Scope</th>
              <th scope="col">Module</th>
            </tr>
          </thead>
          <tbody>
            {info.symbols.map((symbol) => (
              <SymbolRow key={`${symbol.address}-${symbol.name}`} symbol={symbol} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        The symbols come in <strong>address order</strong>, which is how the kernel turns an
        address back into a name for a stack trace. The type is an <code>nm</code> letter — the
        chips above count them — and its <strong>case means two different things</strong>: for the
        kernel&rsquo;s own symbols upper case is global and lower case is static to one file, while
        for a module&rsquo;s the kernel upper-cases the letter when the symbol is exported with{' '}
        <code>EXPORT_SYMBOL</code>, so there it says whether another module can link against it.
        A real machine&rsquo;s file runs to hundreds of thousands of lines; this is a small one.
      </p>
    </>
  );
}
