import { useMemo } from 'react';
import { ProcPath } from './components/ProcPath';
import { Refused } from './components/Refused';
import { SiteFooter } from './components/SiteFooter';
import { useFsFile } from './hooks/useFsFile';
import { HOST_ROOT } from './api/paths';
import { resolveEntry } from './pages';

/**
 * The page for a file this app has no parser for — `/proc/kmsg`,
 * `/proc/sys/kernel/osrelease`, and everything else under `/proc` that three
 * dozen pages do not already explain.
 *
 * It is the other half of what {@link DirApp} does for a directory: the listing
 * links at each entry's own name, so a file with no page of its own leads to a
 * URL that had nothing behind it. This is what is behind those, and it shows
 * the bytes as they came.
 *
 * **It reads the file its own URL names**, the same rule every page here
 * follows: `<base-url>/kmsg` reads `/proc/kmsg` from
 * `<base-url>/0/api/file/kmsg`. One document answers for every such file, so the
 * servers route a URL naming one to it — see `documentForPath` in
 * `config/document.ts`, which looks the path up on the machine and hands a file
 * to this page and a directory to {@link DirApp}.
 *
 * There is no parsed view to switch to and so **no view toggle**: a control
 * with one setting is a control that does nothing. A file that has a parsed
 * view has a page of its own, and that page is what its URL serves.
 *
 * Nothing is counted or measured here either — the bytes are the whole of what
 * this page has to say, and a size beside them is one more number for a reader
 * to place. A file that is worth counting is worth parsing, which is what the
 * other pages are for.
 */

/** The page proper, once there is a path to read. */
function RawFile({ path }: { path: string }) {
  const { content, error, loading, loadedAt } = useFsFile(path);

  return (
    <div className="app">
      <header className="app__header">
        <ProcPath path={path} />
      </header>

      <main>
        {error !== null && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        {loading && content === null && error === null && (
          <p className="notice" role="status">
            Reading {path}…
          </p>
        )}

        {content !== null &&
          (content === '' ? (
            <p className="notice notice--warn" data-testid="empty">
              That file is there and holds nothing at all. Under <code>/proc</code> that is often
              the answer rather than a failure — an empty <code>/proc/&lt;pid&gt;/cmdline</code>{' '}
              means a kernel thread, and a file the current configuration disabled reads empty too.
            </p>
          ) : (
            <pre className="card raw" data-testid="raw-file">
              {content}
            </pre>
          ))}
      </main>

      <SiteFooter>
        {loadedAt !== null && `Last read at ${loadedAt.toLocaleTimeString()}`}
      </SiteFooter>
    </div>
  );
}

export function RawApp() {
  const { path, refused } = useMemo(
    () => resolveEntry(window.location.pathname, import.meta.env.BASE_URL),
    [],
  );

  // The URL is the path, so one spelling a path this app will not ask for is
  // refused rather than sent — and rather than quietly reading somewhere else.
  if (path === null) {
    return (
      <Refused path={HOST_ROOT}>
        <code>{refused}</code> is not a path this app will read. This page shows the file its own
        URL names — <code>/kmsg</code> reads <code>/proc/kmsg</code> — so the URL has to be a path
        under <code>/proc</code>, with no <code>.</code> or <code>..</code> in it.
      </Refused>
    );
  }

  return <RawFile path={path} />;
}
