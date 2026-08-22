/**
 * Parser for `/proc/<pid>/net/connector` — what is registered on the kernel's
 * connector bus.
 *
 * A header line, then one line per registration, two columns wide:
 *
 *   Name            ID
 *   cn_proc         1:1
 *
 * `cn_proc_show` in `drivers/connector/connector.c` prints it with
 * `"%-15s %u:%u"`, and that is the whole file. Most machines have exactly the
 * one line above.
 *
 * **These are kernel-side receivers, not connections and not listeners.** The
 * connector is a thin layer over netlink family 11, `NETLINK_CONNECTOR`: a
 * subsystem calls `cn_add_callback` to be handed messages sent to its address,
 * and that registration is what appears here. Nothing about the userspace
 * programs on the other end shows up — a `cn_proc` line says the process-events
 * connector is compiled in and registered, not that anything is listening to
 * it, and the line reads exactly the same on a machine where nothing has ever
 * opened the socket.
 *
 * **The ID is a bus address, not a position in this list.** It is the
 * `CN_IDX_*` and `CN_VAL_*` pair from `include/uapi/linux/connector.h` — a
 * userspace program joins multicast group `idx` on `NETLINK_CONNECTOR` and
 * filters on `val` — so it means the same thing on every kernel, and an index
 * stays allocated long after the driver behind it is deleted. {@link ALLOCATED}
 * is how many the ABI has handed out; past that is out of tree.
 *
 * **The file belongs to the initial network namespace and nowhere else.**
 * `cn_init` creates it with `proc_create_single("connector", S_IRUGO,
 * init_net.proc_net, cn_proc_show)`, and the netlink socket underneath it is
 * created on `&init_net` too. So a process in a network namespace of its own
 * has no such file — reading `/proc/<pid>/net/connector` for it is a 404, not
 * an empty table and not a permissions failure. The bus is not there to have a
 * table. That is the sharpest thing a page for this file can say, and it is
 * only visible by reading it *per process*.
 *
 * An empty table — the header and nothing under it — is a different answer
 * again: the connector is compiled in and no subsystem has registered on it,
 * which is what a kernel built without `CONFIG_PROC_EVENTS` looks like.
 */

export interface Connector {
  /** The registering subsystem's name, e.g. `cn_proc`. */
  name: string;
  /** `CN_IDX_*` — the multicast group a listener joins. */
  idx: number;
  /** `CN_VAL_*` — which user of that group this is. */
  val: number;
}

/** `cn_proc         1:1` */
const LINE = /^(\S+)\s+(\d+):(\d+)$/;

/**
 * The registrations in the file.
 *
 * The header is skipped by not matching: a line has to end in `idx:val` to be a
 * registration, which the header's bare `ID` cannot do.
 */
export function parseConnectors(text: string): Connector[] {
  const connectors: Connector[] = [];

  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match === null) continue;

    const [, name, idx, val] = match;
    connectors.push({ name: name!, idx: Number(idx), val: Number(val) });
  }

  return connectors;
}

/** The address as the file writes it, which is how it is spoken of. */
export function idOf(connector: Connector): string {
  return `${connector.idx}:${connector.val}`;
}

/** `CN_NETLINK_USERS`: the highest index the ABI has allocated, plus one. */
export const ALLOCATED = 11;

/** The width `cn_proc_show` pads the name to, with `%-15s`. */
export const NAME_WIDTH = 15;

interface Allocation {
  /** The `CN_IDX_*`/`CN_VAL_*` constants the pair is. */
  constant: string;
  what: string;
  /**
   * The release that deleted the driver behind it, where Linux has. The index
   * stays allocated either way — nothing is ever handed out twice — so a
   * registration here dates the kernel rather than faulting it.
   */
  removedIn?: string;
}

/**
 * Every address `include/uapi/linux/connector.h` allocates, keyed `idx:val`.
 *
 * Most of them are old. Anything written since has used generic netlink
 * instead, so this list is close to a record of what the connector was used for
 * between 2005 and about 2012 — which is why an ordinary machine has one line.
 */
const ALLOCATIONS: Record<string, Allocation> = {
  '1:1': {
    constant: 'CN_IDX_PROC / CN_VAL_PROC',
    what: 'process events — fork, exec, exit, and uid, gid, sid and ptrace changes, as they happen',
  },
  '2:1': {
    constant: 'CN_IDX_CIFS / CN_VAL_CIFS',
    what: 'oplock breaks from the CIFS client to a userspace helper',
    removedIn: '2.6.28',
  },
  '3:1': {
    constant: 'CN_W1_IDX / CN_W1_VAL',
    what: 'the 1-wire bus — searches, and reads of the sensors on it, from userspace',
  },
  '4:1': {
    constant: 'CN_IDX_V86D / CN_VAL_V86D_UVESAFB',
    what: 'uvesafb asking v86d to run the card’s x86 BIOS for it, in userspace',
  },
  '5:1': {
    constant: 'CN_IDX_BB',
    what: 'BlackBoard, the sampling framework from the TSP project',
  },
  '6:1': {
    constant: 'CN_DST_IDX / CN_DST_VAL',
    what: 'DST, a distributed storage target that never reached mainline',
  },
  '7:1': {
    constant: 'CN_IDX_DM / CN_VAL_DM_USERSPACE_LOG',
    what: 'device-mapper handing its dirty-region log to a userspace daemon',
  },
  '8:1': {
    constant: 'CN_IDX_DRBD / CN_VAL_DRBD',
    what: 'DRBD replication events, before 8.4 moved them to generic netlink',
    removedIn: '3.2',
  },
  '9:1': {
    constant: 'CN_KVP_IDX / CN_KVP_VAL',
    what: 'Hyper-V key-value pair exchange, so the host can ask the guest about itself',
  },
  '10:1': {
    constant: 'CN_VSS_IDX / CN_VSS_VAL',
    what: 'Hyper-V volume shadow copy, freezing the guest’s filesystems for a host snapshot',
  },
};

/** What this address is allocated for, or null for one that is not. */
export function allocationOf(connector: Connector): Allocation | null {
  return ALLOCATIONS[idOf(connector)] ?? null;
}

/** The `CN_*` constants an address is, where it is one the ABI hands out. */
export function constantFor(connector: Connector): string | null {
  return allocationOf(connector)?.constant ?? null;
}

/** What the subsystem behind an address does, in a sentence. */
export function describeConnector(connector: Connector): string {
  const allocation = allocationOf(connector);
  if (allocation !== null) return allocation.what;

  // An index past the allocated range is somebody's own; one inside it with a
  // value nothing claims is the same story a step further in.
  return isAllocatedIndex(connector)
    ? 'an index the ABI allocates, under a value nothing in Linux claims'
    : 'an address no CN_IDX_* is allocated for, so the module registering it is out of tree';
}

/** Whether the index is one `connector.h` hands out at all. */
export function isAllocatedIndex(connector: Connector): boolean {
  return connector.idx < ALLOCATED;
}

/** Whether this page recognises the address as a whole. */
export function isKnown(connector: Connector): boolean {
  return allocationOf(connector) !== null;
}

/** The release that deleted the driver behind an address, where one did. */
export function removedIn(connector: Connector): string | null {
  return allocationOf(connector)?.removedIn ?? null;
}

/** Registrations whose driver Linux no longer has. */
export function removed(connectors: readonly Connector[]): Connector[] {
  return connectors.filter((connector) => removedIn(connector) !== null);
}

/** The process-events connector, which is the one line most machines have. */
export const PROC_EVENTS = '1:1';

export function isProcEvents(connector: Connector): boolean {
  return idOf(connector) === PROC_EVENTS;
}

/**
 * Whether the name ran past the column `cn_proc_show` pads it to. Nothing
 * truncates it — `CN_CBQ_NAMELEN` is 32 — so the ID moves right on that line
 * alone and the file stops lining up.
 */
export function isOverlong(connector: Connector): boolean {
  return connector.name.length > NAME_WIDTH;
}

export interface ConnectorSummary {
  total: number;
  /** The process-events registration, where the kernel has one. */
  procEvents: Connector | undefined;
  /** Registrations at an address this page knows. */
  known: Connector[];
  /** Registrations at an index the ABI has not allocated. */
  outOfTree: Connector[];
  /** Registrations whose driver Linux has since deleted. */
  removed: Connector[];
  /** Names too long for the column, which shift the ID on their own line. */
  overlong: Connector[];
}

export function summarize(connectors: readonly Connector[]): ConnectorSummary {
  return {
    total: connectors.length,
    procEvents: connectors.find(isProcEvents),
    known: connectors.filter(isKnown),
    outOfTree: connectors.filter((connector) => !isAllocatedIndex(connector)),
    removed: removed(connectors),
    overlong: connectors.filter(isOverlong),
  };
}
