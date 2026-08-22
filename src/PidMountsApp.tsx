import { MountsView } from './components/MountsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/mounts.html');

/**
 * `/proc/<pid>/mounts` — the same file `/proc/mounts` is, read for one process
 * rather than for the machine.
 *
 * It is the *same format*, so it is the same view: this page differs from
 * {@link MountsApp} only in which path it reads. `/proc/mounts` is a symbolic
 * link to `self/mounts`, so the machine's page is this one seen from whichever
 * process happens to be asking.
 *
 * What differs is the answer. A process in a mount namespace of its own sees
 * its own table — a container sees its overlay root and none of the host, and
 * an unshared sandbox may see six mounts where the machine has thirty. Reading
 * one process's file rather than the link is the only way to see that.
 *
 * For the mount ids, the tree and the propagation, `/proc/<pid>/mountinfo` has
 * a page of its own: this file is the fstab shape, and drops all of it.
 */
export function PidMountsApp() {
  return <ProcPage page={PAGE}>{(content) => <MountsView content={content} />}</ProcPage>;
}
