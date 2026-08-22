import { useMemo, useState } from 'react';
import {
  BUCKETS,
  errorRate,
  errorsOf,
  formatBytes,
  hasCollisions,
  isCompressing,
  isIdle,
  isLoopback,
  NAME_WIDTH,
  parseNetDev,
  summarize,
  type Interface,
} from '../lib/net-dev';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** A counter that is only worth reading when it is not zero. */
function Count({ value, title }: { value: number; title: string }) {
  return value === 0 ? (
    <span className="muted" title={title}>
      0
    </span>
  ) : (
    <span className="netdev__hit" title={title}>
      {value.toLocaleString()}
    </span>
  );
}

function InterfaceRow({ iface }: { iface: Interface }) {
  const rate = errorRate(iface);

  return (
    <tr
      className={
        isIdle(iface)
          ? 'netdev__row netdev__row--idle'
          : isLoopback(iface)
            ? 'netdev__row netdev__row--loopback'
            : 'netdev__row'
      }
    >
      <td className="netdev__name">
        {iface.name}
        {isLoopback(iface) && (
          <span className="chip" title="Loopback: what is sent is what is received, so the two sides count the same traffic">
            loopback
          </span>
        )}
      </td>

      <td className="netdev__bytes" title={`${iface.rx.bytes.toLocaleString()} bytes`}>
        {formatBytes(iface.rx.bytes)}
      </td>
      <td className="netdev__packets">{iface.rx.packets.toLocaleString()}</td>
      <td className="netdev__count">
        <Count value={iface.rx.errs} title="rx_errors" />
      </td>
      <td className="netdev__count">
        <Count value={iface.rx.drop} title={BUCKETS['rx drop']!.join(' + ')} />
      </td>
      <td className="netdev__count">
        <Count value={iface.rx.frame} title={BUCKETS['rx frame']!.join(' + ')} />
      </td>

      <td className="netdev__bytes" title={`${iface.tx.bytes.toLocaleString()} bytes`}>
        {formatBytes(iface.tx.bytes)}
      </td>
      <td className="netdev__packets">{iface.tx.packets.toLocaleString()}</td>
      <td className="netdev__count">
        <Count value={iface.tx.errs} title="tx_errors" />
      </td>
      <td className="netdev__count">
        <Count value={iface.tx.drop} title="tx_dropped" />
      </td>
      <td className="netdev__count">
        <Count value={iface.tx.carrier} title={BUCKETS['tx carrier']!.join(' + ')} />
      </td>

      <td className="netdev__rate">
        {rate === 0 ? (
          <span className="muted">—</span>
        ) : (
          <span className="netdev__hit" title={`${errorsOf(iface).toLocaleString()} in the error columns`}>
            {(rate * 100).toFixed(rate < 0.001 ? 4 : 2)}%
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Every interface in one network namespace, and what the sixteen counters do
 * and do not say about it.
 */
export function NetDevView({ content }: { content: string }) {
  const interfaces = useMemo(() => parseNetDev(content), [content]);
  const summary = useMemo(() => summarize(interfaces), [interfaces]);
  const [hideIdle, setHideIdle] = useState(false);

  const note = (
    <p className="disks__note muted">
      This file belongs to a <strong>network namespace</strong>, not to the process:{' '}
      <code>/proc/net</code> is a link to <code>self/net</code>, so naming a pid reads the table of
      the namespace that process is in — a container&rsquo;s pid shows its <code>lo</code> and one
      end of a veth pair and nothing of the host&rsquo;s. Every <em>registered</em> interface is
      listed, up or down, so a row of zeroes is a device the kernel has rather than one carrying
      nothing. Two of the sixteen counters are <strong>not errors</strong>:{' '}
      <code>multicast</code> counts multicast packets received, which any machine hearing mDNS or
      router advertisements does, and <code>compressed</code> counts frames a header-compressing
      link handled, which stays zero on anything that is not PPP or SLIP. Four more are{' '}
      <strong>several kernel counters added together</strong> — <code>frame</code> is{' '}
      <code>{BUCKETS['rx frame']!.join(' + ')}</code>, so a number there could be a bad cable, a
      duplex mismatch or a runt, and this file cannot say which. <code>ip -s link</code>, or the
      driver&rsquo;s own <code>ethtool -S</code>, is where they come apart again. The counters are
      64-bit (<code>rtnl_link_stats64</code>), so the wrapping that made this file useless on a busy
      32-bit machine is history.
    </p>
  );

  if (interfaces.length === 0) {
    return (
      <>
        <p className="notice notice--warn" data-testid="empty">
          No interfaces in this table — not even <code>lo</code>, which a namespace has from the
          moment it exists even when it is down. Switch to the raw view to see what the server
          returned.
        </p>
        {note}
      </>
    );
  }

  const visible = hideIdle ? interfaces.filter((iface) => !isIdle(iface)) : interfaces;
  const collisions = interfaces.filter(hasCollisions);
  const compressing = interfaces.filter(isCompressing);
  const multicast = interfaces.filter((iface) => iface.rx.multicast > 0);

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat label="interfaces" value={String(summary.total)} />
        <Stat label="received" value={formatBytes(summary.rxBytes)} />
        <Stat label="transmitted" value={formatBytes(summary.txBytes)} />
        {summary.busiest !== undefined && (
          <Stat label="busiest" value={summary.busiest.name} />
        )}
        {summary.faulty.length > 0 && (
          <Stat label="with errors" value={String(summary.faulty.length)} />
        )}
      </section>

      {summary.faulty.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="faulty">
          {summary.faulty.map((iface) => iface.name).join(', ')}{' '}
          {summary.faulty.length === 1 ? 'has' : 'have'} something in the error columns.{' '}
          <strong>Read the rate rather than the count</strong>: a thousand bad frames in a billion
          is a link doing its job, and a thousand in ten thousand is a cable to go and look at. And
          the two widest columns are buckets — <code>frame</code> and <code>carrier</code> are four
          kernel counters each — so this says something is wrong, not what.
        </p>
      )}

      {collisions.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="collisions">
          {collisions.map((iface) => iface.name).join(', ')} {collisions.length === 1 ? 'has' : 'have'}{' '}
          <strong>collisions</strong>, which only a half-duplex link can have. Every switched link
          since about 2000 is full duplex, so this is a hub, a duplex mismatch with whatever is on
          the other end, or a driver counting something else in the field — and a mismatch is worth
          finding, since it costs far more throughput than the number here suggests.
        </p>
      )}

      {compressing.length > 0 && (
        <p className="notice" role="status" data-testid="compressed">
          {compressing.map((iface) => iface.name).join(', ')} has a non-zero{' '}
          <code>compressed</code> count. That column is <strong>not an error</strong>: it counts
          frames a header-compressing link handled — Van Jacobson compression on PPP or SLIP — and
          it is zero on every other kind of interface ever made.
        </p>
      )}

      {summary.idle.length > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hideIdle}
            onChange={(event) => setHideIdle(event.target.checked)}
          />
          Hide the interfaces nothing has gone through ({summary.idle.length} of {summary.total})
        </label>
      )}

      <div className="card mounts">
        <table className="mounts__table netdev__table" aria-label="Network interfaces">
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                Interface
              </th>
              <th scope="colgroup" colSpan={5} className="netdev__group">
                Receive
              </th>
              <th scope="colgroup" colSpan={5} className="netdev__group">
                Transmit
              </th>
              <th scope="col" rowSpan={2} title="Bad frames as a share of everything that arrived">
                Bad in
              </th>
            </tr>
            <tr>
              <th scope="col">bytes</th>
              <th scope="col">packets</th>
              <th scope="col">errs</th>
              <th scope="col">drop</th>
              <th scope="col" title={BUCKETS['rx frame']!.join(' + ')}>
                frame
              </th>
              <th scope="col">bytes</th>
              <th scope="col">packets</th>
              <th scope="col">errs</th>
              <th scope="col">drop</th>
              <th scope="col" title={BUCKETS['tx carrier']!.join(' + ')}>
                carrier
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((iface) => (
              <InterfaceRow key={iface.name} iface={iface} />
            ))}
          </tbody>
        </table>
      </div>

      {summary.glued.length > 0 && (
        <p className="disks__note muted" data-testid="glued">
          {summary.glued.length === summary.total ? 'Every name here' : `${summary.glued.length} of these names`}{' '}
          {summary.glued.length === 1 ? 'is' : 'are'} {NAME_WIDTH} characters or longer, so the
          kernel — which prints the name as <code>%6s:</code> and truncates nothing — left no space
          in front of the colon and pushed the rest of the line right.{' '}
          {summary.widest !== undefined && (
            <>
              <code>{summary.widest.name}:</code> is the longest of them.{' '}
            </>
          )}
          The columns stop lining up, but nothing is lost: a space follows the colon and separates
          every counter, so the sixteen numbers are all still there. It is reading this file by
          fixed columns that breaks.
        </p>
      )}

      {multicast.length > 0 && (
        <p className="models" data-testid="multicast">
          {multicast.map((iface) => (
            <span key={iface.name} className="chip chip--model" title="Multicast packets received — a count, not an error">
              {iface.name} multicast <span className="count">{iface.rx.multicast.toLocaleString()}</span>
            </span>
          ))}
        </p>
      )}

      {note}
    </>
  );
}
