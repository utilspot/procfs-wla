import { useMemo, useState, type ReactNode } from 'react';
import { useFsFile } from '../hooks/useFsFile';
import { useFsBytes } from '../hooks/useFsBytes';
import { ProcPath } from './ProcPath';
import { Refused } from './Refused';
import { SiteFooter } from './SiteFooter';
import { isParameterized, pageUrl, resolvePath, type Page } from '../pages';

type ViewMode = 'parsed' | 'raw';

interface ProcPageProps {
  /** The page this is, which is what says where to read and what to fall back to. */
  page: Page;
  /** Renders the parsed view for the file's contents. */
  children: (content: string) => ReactNode;
}

/**
 * Shell shared by every `/proc/<file>` page: reads the file this page's own URL
 * names, from the backend that serves it under `/0/api/file`, and offers a parsed
 * and a raw view.
 *
 * The URL is read once, when the page loads. Nothing here navigates, so it
 * cannot change underneath — and a page that has to read another file is
 * another URL, which is a load of its own.
 *
 * {@link ProcBinaryPage} is the same page for an entry that is not text.
 */
export function ProcPage({ page, children }: ProcPageProps) {
  const { path, refused } = usePath(page);

  if (path === null) return <RefusedPath page={page} refused={refused} />;

  return <ProcFile path={path}>{children}</ProcFile>;
}

interface ProcBinaryPageProps {
  page: Page;
  /** Renders the parsed view for the file's bytes. */
  children: (bytes: Uint8Array) => ReactNode;
}

/**
 * The same page for an entry that is **not text**, which in `/proc` means
 * `/proc/<pid>/auxv`: an array of native words, where a pointer holds bytes no
 * UTF-8 decoder can carry.
 *
 * It differs from {@link ProcPage} in exactly one place: it reads through
 * {@link useFsBytes} rather than `useFsFile`, so the parsed view is handed the
 * bytes whole. The raw view is the same one every page has — the file as text,
 * which for this one is what `cat` would put on a terminal.
 */
export function ProcBinaryPage({ page, children }: ProcBinaryPageProps) {
  const { path, refused } = usePath(page);

  if (path === null) return <RefusedPath page={page} refused={refused} />;

  return <ProcBytes path={path}>{children}</ProcBytes>;
}

/** Where this page reads, from the URL it was opened at. */
function usePath(page: Page) {
  return useMemo(
    () => resolvePath(page, window.location.pathname, import.meta.env.BASE_URL),
    [page],
  );
}

/**
 * The URL is read as the path it spells, so one that spells a path this app
 * will not ask for is refused rather than sent — and refused rather than
 * quietly answered with a different file, which would be worse than saying no.
 */
function RefusedPath({ page, refused }: { page: Page; refused: string | null }) {
  return (
    <Refused path={page.path}>
      <code>{refused}</code> is not a path this app will read. A page reads the file its own URL
      names, so this one is served at <code>{`/${pageUrl(page)}`}</code>
      {isParameterized(page) && (
        <>
          {' '}
          and at <code>{`/${pageUrl(page, '1234')}`}</code> for one process
        </>
      )}
      — a path under <code>/proc</code>, with no <code>.</code> or <code>..</code> in it.
    </Refused>
  );
}

/** The page proper, once there is a path to read. */
function ProcFile({ path, children }: { path: string; children: (content: string) => ReactNode }) {
  const { content, error, loading, loadedAt } = useFsFile(path);

  return (
    <PageShell
      path={path}
      error={error}
      loading={loading}
      loadedAt={loadedAt}
      loaded={content !== null}
      parsed={() => children(content!)}
      raw={() => <RawFile content={content!} />}
    />
  );
}

/** The raw view, which is the same on every page: the file as it came. */
function RawFile({ content }: { content: string }) {
  return (
    <pre className="card raw" data-testid="raw-file">
      {content}
    </pre>
  );
}

/** And the same, for a file read as the bytes it is. */
function ProcBytes({
  path,
  children,
}: {
  path: string;
  children: (bytes: Uint8Array) => ReactNode;
}) {
  const { bytes, error, loading, loadedAt } = useFsBytes(path);

  /*
   * The raw view is the same as every other page's — the file as text — so the
   * bytes are decoded back into exactly what `readFile` would have returned had
   * this page used it: UTF-8, replacement characters and all, which is what
   * `cat` puts on a terminal for this file.
   *
   * Only the *raw* view. The parsed view is given the bytes, which is the whole
   * reason this page reads them: a pointer does not survive the trip through
   * characters, and the decoding below is one-way.
   */
  const text = useMemo(
    () => (bytes === null ? '' : new TextDecoder().decode(bytes)),
    [bytes],
  );

  return (
    <PageShell
      path={path}
      error={error}
      loading={loading}
      loadedAt={loadedAt}
      loaded={bytes !== null}
      parsed={() => children(bytes!)}
      raw={() => <RawFile content={text} />}
    />
  );
}

interface ShellProps {
  path: string;
  error: string | null;
  loading: boolean;
  loadedAt: Date | null;
  /** Whether the read has produced something to show. */
  loaded: boolean;
  /**
   * The two views, as functions: only the one being shown is built, so a page
   * never pays for the parse of a view nobody asked for.
   */
  parsed: () => ReactNode;
  raw: () => ReactNode;
}

/** The heading, the view toggle and the read's own state, which every page has. */
function PageShell({ path, error, loading, loadedAt, loaded, parsed, raw }: ShellProps) {
  const [view, setView] = useState<ViewMode>('parsed');

  return (
    <div className="app">
      <header className="app__header">
        <ProcPath path={path} />

        <div className="segmented" role="group" aria-label="View mode">
          <button type="button" aria-pressed={view === 'parsed'} onClick={() => setView('parsed')}>
            Parsed
          </button>
          <button type="button" aria-pressed={view === 'raw'} onClick={() => setView('raw')}>
            Raw
          </button>
        </div>
      </header>

      <main>
        {error !== null && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        {loading && !loaded && error === null && (
          <p className="notice" role="status">
            Reading {path}…
          </p>
        )}

        {loaded && (view === 'parsed' ? parsed() : raw())}
      </main>

      <SiteFooter>
        {loadedAt !== null && `Last read at ${loadedAt.toLocaleTimeString()}`}
      </SiteFooter>
    </div>
  );
}
