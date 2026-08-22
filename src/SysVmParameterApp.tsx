import { useMemo } from 'react';
import { ProcPage } from './components/ProcPage';
import { Refused } from './components/Refused';
import { SysVmParameterView } from './components/SysVmParameterView';
import { tunableFor, type VmTunable } from './lib/sys-vm';
import { pageFor, resolvePath, valueInPath } from './pages';

const PAGE = pageFor('sys/vm/parameter.html');

/**
 * The tunable this page is about, from the URL it was opened at, or undefined
 * for a URL naming no file this app has facts for.
 *
 * {@link resolvePath} is what reads the URL — the same call {@link ProcPage}
 * makes to decide where to read — so the name and the file always come out of
 * one reading of it.
 */
function tunableInUrl(pathname: string, base: string): VmTunable | undefined {
  const { path } = resolvePath(PAGE, pathname, base);
  if (path === null) return undefined;

  const name = valueInPath(PAGE, path);
  return name === null ? undefined : tunableFor(name);
}

/**
 * The app behind `/proc/sys/vm`: fifty files, one page — one document as well
 * as one component, the way `sys/user/limit.html` is one for the twelve `ucount`
 * limits.
 *
 * **It reads the file its own URL names**: `<base-url>/sys/vm/swappiness` reads
 * `/proc/sys/vm/swappiness`, and the facts the view is given are that file's.
 * The servers route any name the table carries to this document — see
 * `documentForUrl` in `config/document.ts` — and a name it does not carry is
 * not this page's: it goes to the raw page like any other unparsed file, since
 * without facts this page would have nothing to add to the bytes.
 *
 * These fifty are not one mechanism the way the `ucount` limits are, but they
 * are read one way — a line of one or a few fields, a setting rather than a
 * report — and that is what a page can be built on. What differs is carried by
 * `TUNABLES`: which mechanism, what it sets, what it is counted in, and what
 * its values mean where they are a set rather than a scale.
 */
export function SysVmParameterApp() {
  const tunable = useMemo(
    () => tunableInUrl(window.location.pathname, import.meta.env.BASE_URL),
    [],
  );

  // A URL under `sys/vm/` naming a file this app has no facts for —
  // `sys/vm/parameter`, the document's own name, among them. The servers hand
  // such a path to the raw page instead, so this is what a reader typing one
  // directly gets.
  if (tunable === undefined) {
    return (
      <Refused path="/proc/sys/vm">
        This page explains one setting of the memory manager, and it reads the one its own URL
        names — <code>/sys/vm/swappiness</code> reads <code>/proc/sys/vm/swappiness</code>. The URL
        has to name a file this app carries facts for; <code>/sys/vm/</code> lists the ones it does,
        and anything else under there is shown as the bytes it holds.
      </Refused>
    );
  }

  return (
    <ProcPage page={PAGE}>
      {(content) => <SysVmParameterView tunable={tunable} content={content} />}
    </ProcPage>
  );
}
