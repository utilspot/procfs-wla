import { NetDevView } from './components/NetDevView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/net/dev.html');

/**
 * `/proc/<pid>/net/dev` — every network interface in this process's network
 * namespace, and what has gone through it.
 *
 * The third of the `/proc/<pid>/net/` pages, and the plainest use of the pid:
 * this file is created per namespace, so every process has one and a
 * container's holds a different table — its own `lo` and one end of a veth
 * pair, with none of the host's interfaces in it. Beside it, `net/arp` reads
 * the same way and `net/connector` does not exist outside the initial
 * namespace at all.
 *
 * The sixteen counters per line are the reason for a page rather than a `cat`:
 * two of them are not errors, four are several kernel counters added together,
 * and the name is printed `%6s:` so `docker0` already runs into the colon.
 */
export function NetDevApp() {
  return <ProcPage page={PAGE}>{(content) => <NetDevView content={content} />}</ProcPage>;
}
