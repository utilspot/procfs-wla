import { NetArpView } from './components/NetArpView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/net/arp.html');

/**
 * `/proc/<pid>/net/arp` — the IPv4 neighbours of the network namespace this
 * process is in.
 *
 * The first page here for a file below a process's own directory, and the pid
 * in the URL means something different from the way it does on the other pages:
 * this file belongs to a **namespace** rather than to the process. `/proc/net`
 * is a link to `self/net`, so the familiar `/proc/net/arp` is this file read
 * for whoever is asking; naming another pid is how the table of the namespace
 * *that* process is in gets read. Two processes sharing a namespace give
 * byte-identical answers, and a container's pid gives a table with none of the
 * host's neighbours in it — which is the only reason to read it per process.
 */
export function NetArpApp() {
  return <ProcPage page={PAGE}>{(content) => <NetArpView content={content} />}</ProcPage>;
}
