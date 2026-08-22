import { useMemo, useState } from 'react';
import {
  callerSymbol,
  describeFlag,
  formatAddress,
  formatBytes,
  guardBytes,
  hasGuardPage,
  parseVmallocInfo,
  summarize,
  type VmallocEntry,
} from '../lib/vmallocinfo';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** How many callers to list before the table below says the rest. */
const TOP_CALLERS = 8;

function EntryRow({ entry, zeroed }: { entry: VmallocEntry; zeroed: boolean }) {
  const guard = guardBytes(entry);

  return (
    <tr className="vm__row">
      <td className="vm__addr">
        {zeroed ? (
          <span className="muted" title="Zeroed by kptr_restrict">
            {formatAddress(entry.start)}
          </span>
        ) : (
          formatAddress(entry.start)
        )}
      </td>
      <td
        className="vm__number"
        title={
          guard === null
            ? `${entry.sizeBytes.toLocaleString()} bytes`
            : `${entry.sizeBytes.toLocaleString()} bytes, ${
                hasGuardPage(entry) ? 'one page of it the guard' : 'no guard page'
              }`
        }
      >
        {formatBytes(entry.sizeBytes)}
      </td>
      <td className="vm__caller">
        {entry.caller === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            {entry.caller}
            {entry.module !== null && (
              <span className="chip chip--type" title="The module this caller lives in">
                {entry.module}
              </span>
            )}
          </>
        )}
      </td>
      <td className="vm__number">
        {entry.pages === null ? (
          <span className="muted" title="No pages behind it — a device mapping has none">
            —
          </span>
        ) : (
          entry.pages.toLocaleString()
        )}
      </td>
      <td className="vm__number vm__phys">
        {entry.phys === null ? <span className="muted">—</span> : entry.phys}
      </td>
      <td className="vm__flags">
        {entry.flags.map((flag) => (
          <span key={flag} className="chip" title={describeFlag(flag) ?? undefined}>
            {flag}
          </span>
        ))}
        {entry.numa.map((node) => (
          <span
            key={node.node}
            className="chip chip--model"
            title={`${node.pages} of its pages came from node ${node.node}`}
          >
            N{node.node} <span className="count">{node.pages}</span>
          </span>
        ))}
      </td>
    </tr>
  );
}

export function VmallocInfoView({ content }: { content: string }) {
  const entries = useMemo(() => parseVmallocInfo(content), [content]);
  const summary = useMemo(() => summarize(entries), [entries]);
  const [hideIoremap, setHideIoremap] = useState(false);

  if (entries.length === 0) {
    return (
      <p className="notice notice--warn">
        No mappings found in this file. It is readable by root only, so an unprivileged backend
        sees it empty — switch to the raw view to see what the server returned.
      </p>
    );
  }

  const ioremap = entries.filter((entry) => entry.flags.includes('ioremap'));
  const visible = hideIoremap ? entries.filter((entry) => !entry.flags.includes('ioremap')) : entries;

  return (
    <>
      {summary.addressesZeroed && (
        <p className="notice" role="status" data-testid="zeroed">
          Every address in this file came back as zeroes, which is what{' '}
          <code>kptr_restrict</code> does to a file that prints kernel pointers. The sizes, the
          callers and the flags are all still here and are what this page reads — but the layout
          is not, so there is nothing to say about where the mappings sit or what space is left
          between them.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="mapped" value={formatBytes(summary.mappedBytes)} />
        <Stat label="mappings" value={String(summary.entries)} />
        <Stat
          label="largest"
          value={summary.largest === null ? '—' : formatBytes(summary.largest.sizeBytes)}
        />
        <Stat label="in guard pages" value={formatBytes(summary.guardBytes)} />
      </section>

      <p className="models" data-testid="flags">
        {summary.flags.map(({ flag, bytes }) => (
          <span key={flag} className="chip chip--model" title={describeFlag(flag) ?? undefined}>
            {flag} <span className="count">{formatBytes(bytes)}</span>
          </span>
        ))}
        {summary.nodes.length > 0 && (
          <span className="chip chip--flag" title="Nodes these mappings drew their pages from">
            nodes <span className="count">{summary.nodes.join(', ')}</span>
          </span>
        )}
      </p>

      {summary.spanBytes !== null && (
        <p className="disks__note muted" data-testid="layout">
          These mappings run from {formatAddress(entries[0]!.start)} to{' '}
          {formatAddress(entries.at(-1)!.end)} — {formatBytes(summary.spanBytes)} of address space
          with {formatBytes(summary.freeInSpanBytes ?? 0)} of it unmapped
          {summary.largestGap !== null && (
            <>
              , the biggest single hole being {formatBytes(summary.largestGap.bytes)} after{' '}
              <code>{callerSymbol(summary.largestGap.after.caller) ?? 'vm_map_ram'}</code>
            </>
          )}
          . The region itself carries on past the last mapping, and this file does not say how far,
          so this is what the mappings span rather than how full anything is.
        </p>
      )}

      <div className="card mounts vm">
        <table className="mounts__table vm__callers" aria-label="Mappings by caller">
          <thead>
            <tr>
              <th scope="col">Caller</th>
              <th scope="col">Mappings</th>
              <th scope="col">Pages</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {summary.callers.slice(0, TOP_CALLERS).map((caller) => (
              <tr key={`${caller.symbol}-${caller.module ?? ''}`} className="vm__row">
                <td className="vm__caller">
                  {caller.symbol}
                  {caller.module !== null && (
                    <span className="chip chip--type" title="The module this caller lives in">
                      {caller.module}
                    </span>
                  )}
                </td>
                <td className="vm__number">{caller.entries}</td>
                <td className="vm__number">
                  {caller.pages === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    caller.pages.toLocaleString()
                  )}
                </td>
                <td className="vm__number">{formatBytes(caller.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ioremap.length > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideIoremap}
            onChange={(event) => setHideIoremap(event.target.checked)}
          />
          Hide device mappings ({ioremap.length} of {entries.length} are <code>ioremap</code>)
        </label>
      )}

      <div className="card mounts vm">
        <table className="mounts__table vm__table" aria-label="Mappings by address">
          <thead>
            <tr>
              <th scope="col">Address</th>
              <th scope="col">Size</th>
              <th scope="col">Caller</th>
              <th scope="col">Pages</th>
              <th scope="col">Physical</th>
              <th scope="col">Flags</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <EntryRow
                key={`${entry.start}-${entry.end}-${entry.caller ?? ''}-${entry.sizeBytes}`}
                entry={entry}
                zeroed={summary.addressesZeroed}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>The size is a page larger than the allocation.</strong> Unless a caller asks for{' '}
        <code>VM_NO_GUARD</code>, the kernel reserves an unmapped guard page past the end, so an
        entry with <code>pages=1</code> measures 8 KiB and the two figures disagree by exactly one
        page — {formatBytes(summary.guardBytes)} of this file is guard pages rather than anyone&rsquo;s
        data. An <code>ioremap</code> line has no page count at all, because there is no RAM behind
        it: that is a device&rsquo;s registers mapped where the kernel can reach them, and the{' '}
        <code>phys=</code> beside it is the address to look up in <code>/proc/iomem</code>. The
        caller is where the mapping was <em>asked for</em>, printed as a symbol plus offset and,
        for a module&rsquo;s code, the module in brackets — which is what makes this the file to
        read when kernel virtual space is leaking, since the table above adds each caller up.{' '}
        <code>vpages</code> marks an allocation so large that its own array of page pointers had to
        be vmalloc&rsquo;d. The file is root-only and prints its addresses with <code>%pK</code>, so
        under <code>kptr_restrict</code> the ranges come back zeroed and only the accounting
        survives.
      </p>
    </>
  );
}
