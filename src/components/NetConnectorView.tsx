import { useMemo } from 'react';
import {
  ALLOCATED,
  constantFor,
  describeConnector,
  idOf,
  isOverlong,
  isProcEvents,
  NAME_WIDTH,
  parseConnectors,
  removedIn,
  summarize,
  type Connector,
} from '../lib/net-connector';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function ConnectorRow({ connector }: { connector: Connector }) {
  const constant = constantFor(connector);
  const gone = removedIn(connector);

  return (
    <tr className={isProcEvents(connector) ? 'conn__row conn__row--proc' : 'conn__row'}>
      <td className="conn__name">
        {connector.name}
        {isOverlong(connector) && (
          <span
            className="chip chip--bug"
            title={`Longer than the ${NAME_WIDTH} characters cn_proc_show pads the column to, so the ID on this line sits further right than the rest`}
          >
            past the column
          </span>
        )}
      </td>
      <td className="conn__id">{idOf(connector)}</td>
      <td className="conn__constant">
        {constant ?? <span className="muted">not allocated</span>}
      </td>
      <td className="conn__what">
        {describeConnector(connector)}
        {gone !== null && (
          <span className="chip conn__gone" title={`Deleted from Linux in ${gone}`}>
            gone in {gone}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * What is registered on the connector bus, which on most machines is one line —
 * so the page is mostly about what that line does and does not mean.
 */
export function NetConnectorView({ content }: { content: string }) {
  const connectors = useMemo(() => parseConnectors(content), [content]);
  const summary = useMemo(() => summarize(connectors), [connectors]);

  const note = (
    <p className="disks__note muted">
      These are <strong>kernel-side receivers</strong>, not connections and not listeners. The
      connector is a thin layer over netlink family 11, <code>NETLINK_CONNECTOR</code>: a subsystem
      calls <code>cn_add_callback</code> to be handed messages sent to its address, and that
      registration is what appears here — nothing about the userspace programs on the other end
      does. A <code>cn_proc</code> line says the process-events connector is compiled in and
      registered, <em>not</em> that anything is listening, and it reads the same on a machine where
      nothing has ever opened the socket. <strong>The ID is a bus address</strong>, the{' '}
      <code>CN_IDX_*</code> and <code>CN_VAL_*</code> pair from{' '}
      <code>include/uapi/linux/connector.h</code> — a listener joins multicast group{' '}
      <code>idx</code> and filters on <code>val</code> — so it means the same thing on every kernel
      and is never handed out twice, which is why an address outlives the driver behind it. And{' '}
      <strong>this file belongs to the initial network namespace alone</strong>:{' '}
      <code>cn_init</code> creates it under <code>init_net.proc_net</code> and puts the netlink
      socket on <code>&amp;init_net</code>, so a process in a namespace of its own has no such file.
      Reading it for that process is a <strong>404, not an empty table</strong> — the bus is not
      there to have one. Anything written since about 2012 uses generic netlink instead, so this
      list is close to a record of what the connector was used for before that.
    </p>
  );

  if (connectors.length === 0) {
    return (
      <>
        <p className="notice" role="status" data-testid="empty">
          <strong>Nothing is registered on the bus.</strong> The file is here, so the connector is
          compiled in and the initial network namespace is the one being read — but no subsystem has
          called <code>cn_add_callback</code>. A kernel built without <code>CONFIG_PROC_EVENTS</code>{' '}
          looks exactly like this, since the process-events connector is what registers the one line
          nearly every machine has.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="registered" value={String(summary.total)} />
        <Stat
          label="process events"
          value={summary.procEvents === undefined ? 'no' : 'yes'}
        />
        {summary.outOfTree.length > 0 && (
          <Stat label="out of tree" value={String(summary.outOfTree.length)} />
        )}
        {summary.removed.length > 0 && (
          <Stat label="driver gone" value={String(summary.removed.length)} />
        )}
      </section>

      {summary.procEvents === undefined && (
        <p className="notice notice--warn" role="status" data-testid="no-proc-events">
          <strong>
            No <code>cn_proc</code> at <code>1:1</code>.
          </strong>{' '}
          The process-events connector is the one registration nearly every machine has — it is what
          reports fork, exec, exit and credential changes as they happen, and what tools like{' '}
          <code>forkstat</code> read. A kernel built without <code>CONFIG_PROC_EVENTS</code> has
          everything else here and not that.
        </p>
      )}

      {summary.removed.length > 0 && (
        <p className="notice" role="status" data-testid="removed">
          {summary.removed.map((connector) => (
            <span key={idOf(connector)} className="conn__note">
              <code>{connector.name}</code> at <code>{idOf(connector)}</code> — Linux deleted the
              driver behind this address in {removedIn(connector)}.
            </span>
          ))}{' '}
          The address stays allocated regardless, since nothing on this bus is ever handed out
          twice. A registration here dates the kernel rather than faulting it.
        </p>
      )}

      {summary.outOfTree.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="out-of-tree">
          {summary.outOfTree.map((connector) => (
            <span key={idOf(connector)} className="conn__note">
              <code>{connector.name}</code> holds index {connector.idx}, past the{' '}
              {ALLOCATED} <code>connector.h</code> allocates.
            </span>
          ))}{' '}
          A module that picked its own index is out of tree, and nothing stops a second one picking
          the same: the bus has no registry beyond that header.
        </p>
      )}

      <div className="card mounts">
        <table className="mounts__table conn__table" aria-label="Connector registrations">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">ID</th>
              <th scope="col">Constant</th>
              <th scope="col">What registered it</th>
            </tr>
          </thead>
          <tbody>
            {connectors.map((connector) => (
              <ConnectorRow key={`${connector.name} ${idOf(connector)}`} connector={connector} />
            ))}
          </tbody>
        </table>
      </div>

      {summary.known.length < connectors.length && summary.outOfTree.length === 0 && (
        <p className="notice" role="status" data-testid="unknown">
          An address inside the allocated range that <code>connector.h</code> gives no name to. The
          index is the ABI&rsquo;s; the value under it is the subsystem&rsquo;s own business, and
          this page has no entry for this one.
        </p>
      )}

      {note}
    </>
  );
}
