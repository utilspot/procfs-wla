import { useMemo } from 'react';
import { readDirectory, type Directory, type Entry, type Listing } from '../lib/directory';

/**
 * The listing of a directory under `/proc`, laid out the way a file manager
 * lays one out: a tile per entry, an icon saying what it is, and a click
 * going somewhere.
 *
 * **Every entry links at its own name**, the way the directory names it: a
 * file to `<base-url>/<name>`, a directory to `<base-url>/<name>/`. That is
 * the whole rule, and this module knows nothing else — not which files have a
 * page here, not which directories are processes. The URL is the path, so the
 * link to an entry is the entry's own name and the server decides what answers
 * there. A name with nothing behind it 404s, which is an honest answer: this
 * app has a page for three dozen of `/proc`'s files and a listing of `/proc`
 * itself, and nothing for the rest yet.
 *
 * A tile carries an icon and a name and nothing else — the icon is what says
 * whether a name is a file, a folder or a process, so a label repeating it
 * would only take the room. The full path is on the tile as a `title`.
 *
 * How many of each there are is said once, beside the heading of the section
 * holding them. A row of tiles counting the same things again would be a
 * summary of what is directly underneath it.
 *
 * **In the listing of `/proc` itself, the processes get a section to
 * themselves**, and not only for tidiness. On a real machine they are hundreds
 * of directories named with numbers, and the two dozen files anyone came to
 * read would be lost among them. They are also the one part of the listing that
 * is different every time it is read.
 *
 * **Every other directory has two sections, `Directories` and `Files`.** A
 * number below the top of `/proc` is not a process — `/proc/irq/7` is an
 * interrupt line, `/proc/12282/task/12283` is a thread — so there is nothing to
 * put in a third one. That is decided by the path being listed rather than by
 * which page is doing it: see `holdsProcesses` in `src/lib/directory.ts`.
 *
 * Their tiles are **compact rows** rather than squares, and they carry **no
 * icon**: every entry in that section is a process, so the heading above them
 * has already said what they are and an icon on each would repeat it hundreds
 * of times. A pid is four or five characters, so a square tile around one is
 * mostly empty space, and there are hundreds of them: laid out as bare rows,
 * more than twice as many fit in the same screen. All of them are laid out,
 * however many that is; the section they are in is what keeps them out of the
 * way of the files, and scrolling past them costs less than a click to see
 * them.
 */

/**
 * The icons, inline because there are two of them and a request each would
 * cost more than the markup does. `currentColor` throughout, so a tile's own
 * colour carries into its icon.
 */
function Icon({ kind }: { kind: 'directory' | 'file' }) {
  const shape =
    kind === 'directory' ? (
      <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3.4a1.5 1.5 0 0 1 1.06.44l1.1 1.1H20.5A1.5 1.5 0 0 1 22 7.04V18.5A1.5 1.5 0 0 1 20.5 20h-17A1.5 1.5 0 0 1 2 18.5Z" />
    ) : (
      <>
        <path d="M6 2.75h7.5L19 8.25V21.25H6Z" />
        <path d="M13.5 2.75V8.25H19" />
      </>
    );

  return (
    <svg
      className="tile__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}

/**
 * Where an entry leads: its own name, relative to the directory being listed.
 * A directory keeps its trailing slash, which is what makes the next listing's
 * links resolve inside it rather than beside it.
 */
export function linkFor(entry: Entry): string {
  const name = encodeURIComponent(entry.name);
  return entry.kind === 'directory' ? `${name}/` : name;
}

function Tile({ entry, icon = true }: { entry: Entry; icon?: boolean }) {
  // The icon carries what the entry is, so the name is only the name — no
  // trailing slash on a directory and no label under it. The path is on the
  // tile as a title for whoever wants it.
  const kind = entry.process ? 'process' : entry.kind;

  return (
    <li className={`tile tile--${kind}`}>
      <a className="tile__link" href={linkFor(entry)}>
        {icon && <Icon kind={entry.kind} />}
        <span className="tile__name" title={entry.path}>
          {entry.name}
        </span>
      </a>
    </li>
  );
}

function Section({
  title,
  entries,
  compact = false,
  icons = true,
}: {
  title: string;
  entries: Entry[];
  /** Lay the tiles out as rows rather than as squares. */
  compact?: boolean;
  /**
   * Whether a tile says what it is with an icon. A section whose entries are
   * all of one kind has said it in the heading already.
   */
  icons?: boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="explorer" aria-label={title}>
      <h2 className="explorer__title">
        {title}
        <span className="explorer__count muted">{entries.length.toLocaleString('en-US')}</span>
      </h2>

      <ul className={`explorer__grid${compact ? ' explorer__grid--compact' : ''}`}>
        {entries.map((entry) => (
          <Tile key={entry.name} entry={entry} icon={icons} />
        ))}
      </ul>
    </section>
  );
}

export function DirectoryView({
  listing,
  path,
  omit,
}: {
  listing: Listing;
  path?: string;
  /**
   * Entries the page is showing somewhere else, and so wants left out of the
   * sections here — the twelve `ucount` limits, which `sys/user/index.html`
   * gives a section of their own. Everything the page says nothing about goes
   * on being listed the usual way, which is the point of taking a predicate
   * rather than a page's own list of what it knows.
   *
   * Whether the *listing* was empty is decided before any of this: a directory
   * that holds nothing is worth saying so about, and one whose every entry the
   * page has already shown is not.
   */
  omit?: (entry: Entry) => boolean;
}) {
  const directory: Directory = useMemo(() => readDirectory(listing, path), [listing, path]);

  const shown = omit === undefined ? directory.entries : directory.entries.filter((entry) => !omit(entry));
  const own = shown.filter((entry) => entry.kind === 'directory' && !entry.process);
  const files = shown.filter((entry) => entry.kind === 'file');
  const processes = shown.filter((entry) => entry.process);

  if (directory.entries.length === 0) {
    return (
      <p className="notice notice--warn" data-testid="empty">
        Nothing was listed for <code>{directory.path}</code>. A directory that reads empty is not
        the same as one that is not there — the backend answered, and this is what it said.
      </p>
    );
  }

  return (
    <>
      {/*
        The same order the entries themselves sort in — see `rank` in
        `src/lib/directory.ts` — so the page reads the way the listing does.
      */}
      <Section title="Directories" entries={own} />
      <Section title="Files" entries={files} />
      {/* Empty for every directory but `/proc` itself, and a section with
          nothing in it draws nothing. */}
      <Section title="Processes" entries={processes} compact icons={false} />
    </>
  );
}
