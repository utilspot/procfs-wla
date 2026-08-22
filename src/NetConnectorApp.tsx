import { NetConnectorView } from './components/NetConnectorView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/net/connector.html');

/**
 * `/proc/<pid>/net/connector` — what is registered on the kernel's connector
 * bus, which is netlink family 11 with a name on each address.
 *
 * It sits beside {@link NetArpApp} under `/proc/<pid>/net/`, and the pid means
 * something sharper here. That file is per network namespace and reads
 * differently for a process in one of its own; this one **does not exist**
 * there at all: `cn_init` creates it under `init_net.proc_net` and puts the
 * socket on `&init_net`, so naming a process in a namespace of its own gets a
 * 404 rather than an empty table. The absence is the answer, and reading the
 * file per process is the only way to see it.
 *
 * The table itself is short — one line, `cn_proc 1:1`, on nearly every machine
 * — so most of what the page does is say what that line does not mean: a
 * registration is a kernel-side receiver, not a listener, and the address is
 * the `CN_IDX_*`/`CN_VAL_*` pair rather than a position in the list.
 */
export function NetConnectorApp() {
  return <ProcPage page={PAGE}>{(content) => <NetConnectorView content={content} />}</ProcPage>;
}
