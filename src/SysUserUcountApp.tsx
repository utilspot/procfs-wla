import { useMemo } from 'react';
import { ProcPage } from './components/ProcPage';
import { Refused } from './components/Refused';
import { SysUserUcountView } from './components/SysUserUcountView';
import { LIMITS, limitFor, type UcountLimit } from './lib/sys-user-ucount';
import { pageFor, resolvePath, valueInPath } from './pages';

const PAGE = pageFor('sys/user/limit.html');

/**
 * The limit this page is about, from the URL it was opened at, or undefined for
 * a URL naming no limit of the twelve.
 *
 * {@link resolvePath} is what reads the URL — the same call {@link ProcPage}
 * makes to decide where to read — so the name and the file always come out of
 * one reading of it. A URL this app will not read at all has no name in it
 * either, and is refused below rather than sent.
 */
function limitInUrl(pathname: string, base: string): UcountLimit | undefined {
  const { path } = resolvePath(PAGE, pathname, base);
  if (path === null) return undefined;

  const name = valueInPath(PAGE, path);
  return name === null ? undefined : limitFor(name);
}

/**
 * The app behind `/proc/sys/user`: twelve files, one mechanism, and **one page**
 * — one document as well as one component, since what differs between the
 * twelve is a row of facts and the name the URL already carries.
 *
 * **It reads the file its own URL names**, the rule every page here follows:
 * `<base-url>/sys/user/max_ipc_namespaces` reads
 * `/proc/sys/user/max_ipc_namespaces`, and the limit whose facts the view is
 * given is the one that URL named. The servers route any of the twelve names to
 * this document the way they route a process's file to `pid/smaps.html` — see
 * `documentForUrl` in `config/document.ts`.
 *
 * Nothing is taken from the query string and nothing is chosen at build time,
 * so where this page is served and which limit it explains are one fact rather
 * than two that have to agree.
 */
export function SysUserUcountApp() {
  const limit = useMemo(
    () => limitInUrl(window.location.pathname, import.meta.env.BASE_URL),
    [],
  );

  // A URL under `sys/user/` that names none of the twelve — `sys/user/limit`,
  // the document's own name among them. The servers hand such a path to the raw
  // page instead, so this is what a reader typing one directly gets, and it
  // says which names there are rather than reading somewhere else.
  if (limit === undefined) {
    return (
      <Refused path="/proc/sys/user">
        This page explains one of the twelve <code>ucount</code> limits, and it reads the one its
        own URL names — <code>/sys/user/max_ipc_namespaces</code> reads{' '}
        <code>/proc/sys/user/max_ipc_namespaces</code>. The URL has to name one of them:{' '}
        {LIMITS.map((one, index) => (
          <span key={one.name}>
            {index === 0 ? '' : ', '}
            <code>{one.name}</code>
          </span>
        ))}
        .
      </Refused>
    );
  }

  return (
    <ProcPage page={PAGE}>
      {(content) => <SysUserUcountView limit={limit} content={content} />}
    </ProcPage>
  );
}
