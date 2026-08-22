import { HOST_ROOT } from '../api/paths';
import { PID } from '../pages';

/**
 * Reader for a directory listing of `/proc`, as the backend serves one.
 *
 * `GET /0/api/dir/<path>` answers with a JSON **object**, not an array: each key
 * is an entry's name and each value the `d_type` `readdir` reported for it —
 * see `requestStatHandler` in `WebProcfsExecutor.c`. The two the backend emits
 * are the two below; it skips `.` and `..`, and skips anything that is neither
 * a regular file nor a directory, so a symbolic link like `self` may or may not
 * appear depending on what the filesystem reports for it.
 *
 * An object keyed by name is a good shape for the thing being described — a
 * directory cannot hold the same name twice — but it says nothing about order,
 * and `/proc` in readdir order is not an order anyone wants to read. Sorting is
 * this module's job, in {@link readDirectory}.
 */

/** The `d_type` values the backend emits, from `<dirent.h>`. */
export const DT_DIR = 4;
export const DT_REG = 8;

/** What the listing is a listing of, as far as the app is concerned. */
export type EntryKind = 'file' | 'directory';

export interface Entry {
  name: string;
  kind: EntryKind;
  /** The entry's path on the machine, e.g. `/proc/cpuinfo`. */
  path: string;
  /**
   * Whether this directory is a process. `/proc` holds one per running task,
   * named for its pid, among directories that are not — `sys`, `net`, `irq` —
   * and they are worth telling apart: a reader looking for a process is looking
   * at hundreds of numbers, and a reader looking for anything else is not.
   *
   * **Only ever true in a listing of `/proc` itself.** A number below it is
   * some other kind of number — see {@link holdsProcesses}.
   */
  process: boolean;
}

export interface Directory {
  /** The directory listed, e.g. `/proc`. */
  path: string;
  entries: Entry[];
}

/** The listing as it arrives: every value is a `d_type`. */
export type Listing = Record<string, number>;

/**
 * Whether this directory *name* is a process rather than one of `/proc`'s own.
 *
 * The same shape a URL is allowed to name — {@link PID} — so that what the
 * listing calls a process is what a process page will read. It answers for the
 * name alone; whether a name of that shape is a process at all depends on where
 * it is, which is {@link holdsProcesses}.
 */
export function isProcess(name: string): boolean {
  return PID.test(name);
}

/**
 * Whether the directory at this path is the one holding the processes, which is
 * **`/proc` itself and nowhere below it**.
 *
 * A number naming a directory means something different at every depth, and
 * only at the top does it mean a process: `/proc/irq/7` is an interrupt line,
 * `/proc/12282/task/12283` is a thread, `/proc/bus/pci/00` is a bus. Reading
 * any of them as a process would put the wrong icon on the tile, sort it into a
 * section it does not belong to, and offer a reader the idea that `/proc/irq`
 * has hundreds of processes in it.
 *
 * So this is a fact about the path being listed, not about the page doing the
 * listing — the same rule as everywhere else here: the path decides. The page
 * the base lands on lists `/proc` and shows the processes; the page every other
 * directory lands on lists something below it and never does.
 */
export function holdsProcesses(path: string): boolean {
  return path.replace(/\/+$/, '') === HOST_ROOT;
}

/**
 * Entries in the order they are worth reading rather than the order readdir
 * happened to return them: `/proc`'s own directories first, then its files,
 * then the processes — which on a real machine are most of the list and the
 * least likely thing to be scanning for by eye. Names sort naturally within
 * each group, so `10` follows `9` rather than `1`.
 *
 * The kernel's own names for the process doing the reading lead the processes
 * rather than sorting in with them. `self` is the only entry in that group
 * that is there on every machine and means the same thing on each, and it is
 * what every process page reads when its URL names nothing else — a pid, by
 * contrast, means nothing a minute later.
 */
const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function rank(entry: Entry): number {
  if (entry.process) return /^\d/.test(entry.name) ? 3 : 2;
  return entry.kind === 'directory' ? 0 : 1;
}

export function readDirectory(listing: Listing, path: string = HOST_ROOT): Directory {
  // Which is a question about this directory, asked once rather than per entry.
  const processes = holdsProcesses(path);

  const entries: Entry[] = Object.entries(listing)
    // A value the backend does not emit is a value this cannot place, and
    // guessing at it would put a wrong icon beside a real name.
    .filter(([, type]) => type === DT_DIR || type === DT_REG)
    .map(([name, type]) => {
      const directory = type === DT_DIR;
      return {
        name,
        kind: directory ? ('directory' as const) : ('file' as const),
        path: `${path.replace(/\/$/, '')}/${name}`,
        process: directory && processes && isProcess(name),
      };
    })
    .sort((a, b) => rank(a) - rank(b) || COLLATOR.compare(a.name, b.name));

  return { path, entries };
}
