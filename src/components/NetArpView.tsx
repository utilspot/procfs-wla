import { useMemo, useState } from 'react';
import {
  describeFlag,
  flagNames,
  hwTypeHex,
  hwTypeName,
  isCrowded,
  isIncomplete,
  isLocallyAdministered,
  isMulticastHw,
  isProxy,
  isUnresolved,
  parseNetArp,
  summarize,
  unexpectedFlags,
  GC_THRESH3,
  type ArpEntry,
} from '../lib/net-arp';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The `ATF_*` bits as chips, each saying what it is for. */
function Flags({ entry }: { entry: ArpEntry }) {
  const names = flagNames(entry.flags);

  return (
    <>
      <span
        className="arp__flagvalue"
        title={names.length === 0 ? 'no flags set' : names.join(' | ')}
      >
        {`0x${entry.flags.toString(16)}`}
      </span>
      {/* An entry with no bits set is the ordinary unresolved one, and an empty
          list is a list a screen reader still announces. */}
      {names.length > 0 && (
        <ul className="chips arp__flags">
          {names.map((name) => (
            <li
              key={name}
              className={
                name === 'ATF_PUBL'
                  ? 'chip chip--type'
                  : name === 'ATF_COM' || name === 'ATF_PERM'
                    ? 'chip'
                    : 'chip chip--bug'
              }
              title={describeFlag(name)}
            >
              {name.replace('ATF_', '').toLowerCase()}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function EntryRow({ entry, showMask }: { entry: ArpEntry; showMask: boolean }) {
  const type = hwTypeName(entry.hwType);

  return (
    <tr className={isIncomplete(entry) ? 'arp__row arp__row--incomplete' : 'arp__row'}>
      <td className="arp__ip">{entry.ip}</td>
      <td className="arp__hw">
        {isUnresolved(entry) ? (
          <span
            className="muted"
            title={
              isProxy(entry)
                ? 'A proxy entry has no hardware address of its own: this machine answers with its own'
                : 'Nothing answered for this address, so there is no hardware address to hold'
            }
          >
            {entry.hwAddress}
          </span>
        ) : (
          entry.hwAddress
        )}
        {isLocallyAdministered(entry) && (
          <span
            className="chip"
            title="The locally-administered bit is set: an address the machine made up rather than one a manufacturer assigned — a randomised wifi address, or a virtual interface"
          >
            local
          </span>
        )}
        {isMulticastHw(entry) && (
          <span
            className="chip chip--bug"
            title="The group bit is set, which a neighbour's own address cannot legitimately have"
          >
            multicast
          </span>
        )}
      </td>
      <td className="arp__flagcell">
        <Flags entry={entry} />
      </td>
      <td
        className="arp__type"
        title={type === null ? 'a hardware type this page has no name for' : type}
      >
        {type ?? hwTypeHex(entry.hwType)}
      </td>
      {showMask && <td className="arp__mask">{entry.mask}</td>}
      <td className="arp__device">
        {entry.device === '*' ? (
          <span className="muted" title="A proxy entry bound to no interface, so it answers on any">
            *
          </span>
        ) : (
          entry.device
        )}
      </td>
    </tr>
  );
}

/**
 * The neighbour table of one network namespace, as this file can tell it: which
 * addresses resolved, which did not, and which of them this machine is
 * answering for on somebody else's behalf.
 */
export function NetArpView({ content }: { content: string }) {
  const entries = useMemo(() => parseNetArp(content), [content]);
  const summary = useMemo(() => summarize(entries), [entries]);
  const [hideIncomplete, setHideIncomplete] = useState(false);

  const note = (
    <p className="disks__note muted">
      This file belongs to a <strong>network namespace</strong>, not to the process:{' '}
      <code>/proc/net</code> is a link to <code>self/net</code>, so naming a pid is how the table of
      the namespace <em>that</em> process is in gets read — a container&rsquo;s pid shows a table
      with none of the host&rsquo;s neighbours in it, and two processes sharing a namespace give
      byte-identical answers. What it says is less than the kernel knows.{' '}
      <strong>The flags are a lossy summary of the neighbour state</strong>:{' '}
      <code>arp_state_to_flags</code> prints <code>0x2</code> for <code>REACHABLE</code>,{' '}
      <code>STALE</code>, <code>DELAY</code> and <code>PROBE</code> alike, and <code>0x0</code> for
      both <code>INCOMPLETE</code> and <code>FAILED</code>, so an address that is answering and one
      that answered four minutes ago look the same here — <code>ip neigh</code> is where those
      survive. Entries on <code>NOARP</code> devices are left out on purpose (
      <code>arp_seq_start</code> passes <code>NEIGH_SEQ_SKIP_NOARP</code>, so as not to &ldquo;confuse{' '}
      <code>arp -a</code> w/ magic entries&rdquo;), and it is <strong>IPv4 only</strong>: the
      neighbours NDP found are in the same kernel table, reachable only through netlink. The{' '}
      <code>Mask</code> column is vestigial — a literal <code>*</code> on every kernel in service.
    </p>
  );

  if (entries.length === 0) {
    return (
      <>
        <p className="notice notice--warn" data-testid="empty">
          No neighbours in this table. A machine that has spoken to nothing on its network since
          boot has an empty one, and so does a namespace with no interface up in it — this is a
          normal answer rather than a fault. Switch to the raw view to see what the server returned.
        </p>
        {note}
      </>
    );
  }

  const showMask = summary.masked.length > 0;
  const visible = hideIncomplete ? entries.filter((entry) => !isIncomplete(entry)) : entries;
  // Bits `arp_state_to_flags` cannot produce, so an entry carrying one was put
  // there by hand or by a kernel far older than this page's usual reader.
  const unexpected = [...new Set(entries.flatMap(unexpectedFlags))];

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="neighbours" value={String(summary.total)} />
        <Stat label="resolved" value={String(summary.complete)} />
        <Stat label="unresolved" value={String(summary.incomplete)} />
        <Stat label="interfaces" value={String(summary.devices.length)} />
        {summary.permanent > 0 && <Stat label="permanent" value={String(summary.permanent)} />}
        {summary.proxy > 0 && <Stat label="published" value={String(summary.proxy)} />}
      </section>

      <p className="models">
        {summary.devices.map((device) => (
          <span key={device.device} className="chip chip--model">
            {device.device} <span className="count">{device.count}</span>
          </span>
        ))}
      </p>

      {summary.proxy > 0 && (
        <p className="notice" role="status" data-testid="proxy">
          {summary.proxy === 1 ? 'One entry is' : `${summary.proxy} entries are`}{' '}
          <strong>published</strong>: this machine answers ARP for an address that is not its own,
          so packets for it arrive here to be forwarded. They come from a different kernel table —
          <code>pneigh</code>, printed by the same loop — which is why they carry no hardware
          address and can be bound to no interface at all.
        </p>
      )}

      {summary.masked.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="masked">
          The <code>Mask</code> column holds a netmask rather than <code>*</code>. Only proxy
          entries ever had one, and Linux stopped honouring them long ago — a kernel still printing
          this is older than anything in service.
        </p>
      )}

      {unexpected.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unexpected">
          Flags the neighbour code never sets on its own:{' '}
          {unexpected.map((name, index) => (
            <span key={name}>
              {index > 0 && ', '}
              <code title={describeFlag(name)}>{name}</code>
            </span>
          ))}
          . <code>arp_state_to_flags</code> can only produce <code>ATF_COM</code> and{' '}
          <code>ATF_PERM</code>, and proxy entries add <code>ATF_PUBL</code> — anything else came
          from an <code>ioctl</code> setting it by hand, or from a kernel old enough to still mean
          it.
        </p>
      )}

      {summary.shared.length > 0 && (
        <p className="notice" role="status" data-testid="shared">
          {summary.shared.map((group) => (
            <span key={group.hwAddress} className="arp__shared">
              <code>{group.hwAddress}</code> answers for {group.ips.length} addresses (
              {group.ips.join(', ')}) on {group.devices.join(', ')}.
            </span>
          ))}{' '}
          One hardware address on several IPs is what a router doing proxy ARP looks like, and what
          a host with several addresses on one interface looks like. It is also what two machines
          fighting over an address looks like, so it is worth knowing which of the three this is.
        </p>
      )}

      {isCrowded(entries) && (
        <p className="notice notice--warn" role="status" data-testid="crowded">
          {summary.total} entries, against a default <code>gc_thresh3</code> of {GC_THRESH3} in{' '}
          <code>/proc/sys/net/ipv4/neigh/default/</code>. Past that cap the kernel refuses to add
          neighbours and logs &ldquo;neighbour table overflow&rdquo;, which on a machine talking to
          a large flat network is a real failure rather than a tuning nicety.
        </p>
      )}

      {summary.incomplete > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideIncomplete}
            onChange={(event) => setHideIncomplete(event.target.checked)}
          />
          Hide the addresses nothing answered for ({summary.incomplete} of {summary.total})
        </label>
      )}

      <div className="card mounts">
        <table className="mounts__table arp__table" aria-label="IPv4 neighbours">
          <thead>
            <tr>
              <th scope="col">IP address</th>
              <th scope="col">HW address</th>
              <th scope="col">Flags</th>
              <th scope="col">HW type</th>
              {showMask && <th scope="col">Mask</th>}
              <th scope="col">Device</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <EntryRow
                key={`${entry.ip} ${entry.device} ${entry.hwAddress}`}
                entry={entry}
                showMask={showMask}
              />
            ))}
          </tbody>
        </table>
      </div>

      {note}
    </>
  );
}
