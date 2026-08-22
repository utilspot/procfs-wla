import { useMemo } from 'react';
import {
  activeRequests,
  CLOSED_IS_CONSTANT,
  DETACHING,
  formatOpcode,
  inheritedReserve,
  LOW_DMA_IS_CONSTANT,
  opcodeName,
  parseSgDebug,
  summarize,
  timeoutUse,
  type SgDebugDevice,
  type SgDebugHeader,
  type SgFileDescriptor,
  type SgRequest,
} from '../lib/scsi-sg-debug';

/** What each state tag means, said where it is shown rather than in a legend. */
const STATE_TITLES: Record<SgRequest['state'], string> = {
  active: 'act: in flight — the command has been sent and nothing has come back yet',
  received: 'rcv: done, and waiting for the program to collect it',
  finished: 'fin: done and collected, still on the list until the descriptor is done with it',
};

const BUFFER_TITLES: Record<SgRequest['buffer'], string> = {
  reserved: 'rb>> — using the descriptor’s reserved buffer, the one it took at open',
  mmap: 'mmap>> — using that same reserve, mapped into the program rather than copied',
  direct: 'dio>> — direct I/O: the transfer goes to the program’s own pages, no reserve involved',
  ordinary: 'No prefix: neither the reserve nor direct I/O, so the memory was found for this command',
};

function RequestRow({ request }: { request: SgRequest }) {
  const name = opcodeName(request.opcode);
  const use = timeoutUse(request);

  return (
    <tr className={`sgdbg__request sgdbg__request--${request.state}`}>
      <td className="sgdbg__state">
        <span title={STATE_TITLES[request.state]}>{request.state}</span>
      </td>

      <td className="sgdbg__packid">
        <span title="pack_id — the tag a program finds its own request by">{request.packId}</span>
      </td>

      <td className="sgdbg__op">
        <span className="sgdbg__code">{formatOpcode(request.opcode)}</span>
        <span className="muted">{name ?? 'a command this app does not name'}</span>
      </td>

      <td className="sgdbg__bytes">
        <span title="blen — the bytes of data this command carries">{request.bytes}</span>
        <span className="muted" title="sgat — scatter-gather entries the transfer needed">
          {' '}
          sgat {request.sgat}
        </span>
      </td>

      <td className="sgdbg__timing">
        {request.durationMs !== null ? (
          <span title="dur — how long it took, which the driver keeps once it is done">
            {request.durationMs} ms
          </span>
        ) : (
          <>
            <span title="t_o/elap — what it was given against what has gone of it">
              {request.elapsedMs} / {request.timeoutMs} ms
            </span>
            {use !== null && (
              <span className="sgdbg__bar" aria-hidden="true">
                <span
                  className={use > 0.75 ? 'sgdbg__fill sgdbg__fill--late' : 'sgdbg__fill'}
                  style={{ width: `${Math.min(100, use * 100)}%` }}
                />
              </span>
            )}
          </>
        )}
      </td>

      <td className="sgdbg__buffer">
        <span className="chip" title={BUFFER_TITLES[request.buffer]}>
          {request.buffer}
        </span>
      </td>
    </tr>
  );
}

function FdBlock({ fd, header }: { fd: SgFileDescriptor; header: SgDebugHeader | null }) {
  const old = !inheritedReserve(fd, header);

  return (
    <section className="sgdbg__fd" aria-label={`Descriptor ${fd.index}`}>
      <h4 className="sgdbg__fd-name">
        <span title="The driver counts the open files of this device from 1 as it walks them">
          FD({fd.index})
        </span>
      </h4>

      <table className="cpu-card__fields sgdbg__facts" aria-label={`Descriptor ${fd.index} fields`}>
        <tbody>
          <tr>
            <th scope="row" title="The timeout commands on this descriptor are given">
              timeout
            </th>
            <td>
              <span className="sgdbg__value">{fd.timeoutMs}</span>
              <span className="muted"> ms</span>
            </td>
          </tr>
          <tr>
            <th scope="row" title="The reserved buffer this descriptor took from def_reserved_size when it opened">
              bufflen
            </th>
            <td>
              <span className={old ? 'sgdbg__value sgdbg__old' : 'sgdbg__value'}>{fd.bufflen}</span>
              <span className="muted">
                {' '}
                bytes{' '}
                {old
                  ? '— taken at open, and the default has moved since; it keeps what it was given'
                  : '— its own reserve, taken from the default at open'}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row" title="Scatter-gather entries that reserve took">
              (res)sgat
            </th>
            <td>
              <span className="sgdbg__value">{fd.reserveSgat}</span>
            </td>
          </tr>
          <tr>
            <th scope="row" title="Whether more than one command at a time is allowed on this descriptor">
              cmd_q
            </th>
            <td>
              <span className="sgdbg__value">{fd.cmdQ ? 1 : 0}</span>
              <span className="muted">
                {' '}
                — {fd.cmdQ ? 'queueing: several commands at once' : 'one command at a time'}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row" title="Whether reads must name the pack id they are collecting">
              f_packid
            </th>
            <td>
              <span className="sgdbg__value">{fd.forcePackId ? 1 : 0}</span>
              <span className="muted">
                {' '}
                — {fd.forcePackId ? 'a read must name the id it wants' : 'a read takes whatever is ready'}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row" title="Whether a request whose owner has gone is kept rather than dropped">
              k_orphan
            </th>
            <td>
              <span className="sgdbg__value">{fd.keepOrphan ? 1 : 0}</span>
              <span className="muted">
                {' '}
                — {fd.keepOrphan ? 'an orphaned request is kept' : 'an orphaned request is dropped'}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row" title={LOW_DMA_IS_CONSTANT}>
              low_dma
            </th>
            <td>
              <span className="sgdbg__value">{fd.lowDma}</span>
              <span className="muted"> — a literal, not a measurement</span>
            </td>
          </tr>
          <tr>
            <th scope="row" title={CLOSED_IS_CONSTANT}>
              closed
            </th>
            <td>
              <span className="sgdbg__value">{fd.closed}</span>
              <span className="muted"> — text in the format string, so never anything else</span>
            </td>
          </tr>
        </tbody>
      </table>

      {fd.requests.length === 0 ? (
        <p className="muted sgdbg__idle">
          {fd.idle ? (
            <>
              <code>No requests active</code> — the driver&rsquo;s own words for a descriptor with
              nothing in flight
            </>
          ) : (
            'No requests were printed for this descriptor'
          )}
        </p>
      ) : (
        <table className="sgdbg__requests" aria-label={`Requests on descriptor ${fd.index}`}>
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">Id</th>
              <th scope="col">Command</th>
              <th scope="col">Bytes</th>
              <th scope="col">Timing</th>
              <th scope="col">Buffer</th>
            </tr>
          </thead>
          <tbody>
            {fd.requests.map((request) => (
              <RequestRow key={`${request.packId}:${request.raw}`} request={request} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DeviceCard({
  device,
  header,
}: {
  device: SgDebugDevice;
  header: SgDebugHeader | null;
}) {
  const active = device.fds.reduce((total, fd) => total + activeRequests(fd).length, 0);

  return (
    <article className="card sgdbg__device" aria-label={`Device ${device.name}`}>
      <header className="sgdbg__device-header">
        <h3 className="sgdbg__device-name">/dev/{device.name}</h3>

        {device.detaching && (
          <span
            className="chip chip--bug"
            title="The device is going away and a descriptor is still open on it. /proc/scsi/sg/devices says the same thing in nine -1s, and device_strs in the words <no active device>"
          >
            {DETACHING}
          </span>
        )}

        {active > 0 && (
          <span className="chip chip--flag" title="Requests in flight across this device's descriptors">
            {active} in flight
          </span>
        )}
      </header>

      {!device.detaching && (
        <table className="cpu-card__fields sgdbg__facts" aria-label={`Device ${device.name} fields`}>
          <tbody>
            <tr>
              <th scope="row" title="The four numbers /proc/scsi/scsi prints in words">
                address
              </th>
              <td>
                <span className="sgdbg__value sgdbg__device-address">{device.address}</span>
              </td>
            </tr>
            <tr>
              <th
                scope="row"
                title="The host template's emulated flag, which is about the host rather than the device: 1 for the hosts libata puts under an ATAPI drive"
              >
                em
              </th>
              <td>
                <span className="sgdbg__value">{device.emulated === true ? 1 : 0}</span>
                <span className="muted">
                  {' '}
                  — {device.emulated === true ? 'an emulated host' : 'a host that is not emulated'},
                  which is the host and not this device
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="Scatter-gather entries this host will take in one command">
                sg_tablesize
              </th>
              <td>
                <span className="sgdbg__value">{device.tablesize}</span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="Whether a descriptor holds this device exclusively">
                excl
              </th>
              <td>
                <span className="sgdbg__value">{device.exclusive === true ? 1 : 0}</span>
                <span className="muted">
                  {' '}
                  — {device.exclusive === true ? 'held exclusively' : 'shared'}
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="Descriptors open on this device right now">
                open_cnt
              </th>
              <td>
                <span className="sgdbg__value">{device.openCount}</span>
                <span className="muted">
                  {' '}
                  — {device.fds.length === device.openCount
                    ? 'each with a block below'
                    : `${device.fds.length} of them printed below`}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {device.fds.map((fd) => (
        <FdBlock key={fd.index} fd={fd} header={header} />
      ))}
    </article>
  );
}

export function ScsiSgDebugView({ content }: { content: string }) {
  const debug = useMemo(() => parseSgDebug(content), [content]);
  const summary = useMemo(() => summarize(debug), [debug]);

  if (debug.header === null && debug.devices.length === 0) {
    return (
      <p className="notice notice--warn">
        Nothing in this file. It opens with{' '}
        <code>max_active_device=… def_reserved_size=…</code> whatever the machine is doing, so this
        is the read failing rather than a driver with nothing to say. Switch to the raw view to see
        what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.unread.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unread">
          {summary.unread.length === 1 ? 'A line here' : `${summary.unread.length} lines here`} did
          not fit any of the shapes this file prints — <code>{summary.unread[0]}</code>
        </p>
      )}

      {summary.detaching.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="detaching">
          {summary.detaching.length === 1 ? 'A device is' : `${summary.detaching.length} devices are`}{' '}
          <strong>{DETACHING}</strong> — going away with a descriptor still open on it, which is why
          it is still here at all. Its neighbours spell the same absence differently:{' '}
          <code>devices</code> prints nine <code>-1</code>s for that line and{' '}
          <code>device_strs</code> the words <code>&lt;no active device&gt;</code>.
        </p>
      )}

      {summary.oldReserve.length > 0 && (
        <p className="notice" role="status" data-testid="old-reserve">
          {summary.oldReserve.length === 1 ? 'A descriptor holds' : `${summary.oldReserve.length} descriptors hold`}{' '}
          a reserved buffer that is <strong>not the default this file names</strong> —{' '}
          {summary.oldReserve.map((fd) => `${fd.bufflen} B`).join(', ')} against{' '}
          {debug.header?.defReservedSize} B. That is not a disagreement: a descriptor takes its
          reserve when it is <em>opened</em> and keeps it, so this is a file opened before{' '}
          <code>def_reserved_size</code> was last changed.
        </p>
      )}

      {summary.headerOnly && (
        <p className="notice" role="status" data-testid="header-only">
          The header and nothing else, which is <strong>the ordinary state</strong>: this file
          prints a block only for a device that has a descriptor <em>open</em>, so a machine where
          nothing is talking to <code>/dev/sg*</code> right now has nothing to print. What exists
          rather than what is in use is <code>devices</code> beside it — which here counts{' '}
          <strong>{debug.header?.maxActiveDevice}</strong>.
        </p>
      )}

      {debug.header !== null && (
        <div className="card sgdbg__header" data-testid="header">
          <table className="cpu-card__fields">
            <tbody>
              <tr>
                <th scope="row" title="How many sg indices exist, which is the number of lines /proc/scsi/sg/devices prints">
                  max_active_device
                </th>
                <td>
                  <span className="sgdbg__value">{debug.header.maxActiveDevice}</span>
                  <span className="muted"> — sg numbers handed out, in use or not</span>
                </td>
              </tr>
              <tr>
                <th scope="row" title="sg_big_buff, which is the whole of /proc/scsi/sg/def_reserved_size">
                  def_reserved_size
                </th>
                <td>
                  <span className="sgdbg__value">{debug.header.defReservedSize}</span>
                  <span className="muted">
                    {' '}
                    — the same number <code>def_reserved_size</code> holds, and what the{' '}
                    <em>next</em> open will take as its reserve
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {debug.devices.map((device) => (
        <DeviceCard key={device.name} device={device} header={debug.header} />
      ))}

      <p className="disks__note muted">
        The one file in <code>/proc/scsi/sg</code> that is <strong>nested</strong>, and the only one
        about <strong>users rather than devices</strong>: the driver prints a block for a device{' '}
        <em>that has a descriptor open</em> and nothing at all for the rest, so an idle machine
        holds its header line and no more. That is not a fault — <code>devices</code> beside it is
        where what exists is counted. Under each device comes a block per open file, and under that
        the requests on it: <code>act:</code> in flight, <code>rcv:</code> done and waiting to be
        collected, <code>fin:</code> collected. The prefix says where the data is going —{' '}
        <code>rb&gt;&gt;</code> the descriptor&rsquo;s reserved buffer,{' '}
        <code>mmap&gt;&gt;</code> that same reserve mapped rather than copied,{' '}
        <code>dio&gt;&gt;</code> direct I/O into the program&rsquo;s own pages, and no prefix for
        memory found per command. <strong>Two of the fields cannot say anything</strong>:{' '}
        <code>low_dma</code> is passed a literal 0, and <code>closed=0</code> is not passed at all —
        it is text in the format string. And <code>bufflen</code> on a descriptor is the reserve it
        took <em>at open</em>, so one that differs from the header&rsquo;s{' '}
        <code>def_reserved_size</code> is older than the last change to it rather than wrong. Two
        more that mislead: <code>em</code> is the <em>host template&rsquo;s</em> emulated flag
        rather than anything about the device, and a device{' '}
        <code>{DETACHING}</code> is here only because a descriptor is keeping it.
      </p>
    </>
  );
}
