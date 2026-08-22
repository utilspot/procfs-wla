import { useMemo } from 'react';
import {
  addressOf,
  COLUMNS,
  isOffline,
  isPlaceholder,
  nodeOf,
  OPENS_IS_CONSTANT,
  parseSgDevices,
  queueUse,
  summarize,
  typeOf,
  type SgDevice,
} from '../lib/scsi-sg-devices';

/** The line that says a device is gone, which is nine of the same number. */
function PlaceholderRow({ device }: { device: SgDevice }) {
  return (
    <tr className="sgdev__row sgdev__row--gone">
      <td className="sgdev__node">
        <span title="This sg number is taken by a device that is no longer there — the line stays so that nothing under it is renumbered">
          {nodeOf(device)}
        </span>
      </td>
      <td className="sgdev__gone" colSpan={5}>
        <span className="chip chip--bug" title="The driver prints -1 in all nine columns for a device that is detaching, or already unhooked from the sg device it leaves behind">
          gone
        </span>
        <span className="muted">
          nine <code>-1</code>s, which is how the driver holds a number open
        </span>
      </td>
    </tr>
  );
}

function DeviceRow({ device }: { device: SgDevice }) {
  if (isPlaceholder(device)) return <PlaceholderRow device={device} />;

  const type = typeOf(device);
  const use = queueUse(device);
  const offline = isOffline(device);

  return (
    <tr className={offline ? 'sgdev__row sgdev__row--offline' : 'sgdev__row'}>
      <td className="sgdev__node">
        <span title="Nothing in the file names this: the driver walks its devices in index order, so the line's position is the node">
          {nodeOf(device)}
        </span>
      </td>

      <td className="sgdev__address">
        <span title={`Host ${device.host}, channel ${device.channel}, target ${device.id}, logical unit ${device.lun} — the address /proc/scsi/scsi prints in words`}>
          {addressOf(device)}
        </span>
      </td>

      <td className="sgdev__type">
        <span className="sgdev__code">{device.type}</span>
        <span
          className="muted"
          title={
            type === null
              ? 'A peripheral device type this app has no name for'
              : `${type.what} — the name /proc/scsi/scsi prints for this number`
          }
        >
          {type === null ? 'no name for this code' : type.name}
        </span>
      </td>

      <td className="sgdev__queue">
        <span title="How many commands the midlayer will keep in flight for this device">
          {device.busy} / {device.qdepth}
        </span>
        {use !== null && use > 0 && (
          <span className="sgdev__bar" aria-hidden="true">
            <span className="sgdev__fill" style={{ width: `${Math.min(100, use * 100)}%` }} />
          </span>
        )}
      </td>

      <td className="sgdev__opens">
        <span className="muted" title={OPENS_IS_CONSTANT}>
          {device.opens}
        </span>
      </td>

      <td className="sgdev__online">
        {offline ? (
          <span
            className="chip chip--bug"
            title="scsi_device_online is 0: the midlayer has stopped talking to this device, though it has not forgotten it"
          >
            offline
          </span>
        ) : (
          <span className="muted" title="scsi_device_online, which is 1 for a device the midlayer is still talking to">
            online
          </span>
        )}
      </td>
    </tr>
  );
}

export function ScsiSgDevicesView({ content }: { content: string }) {
  const table = useMemo(() => parseSgDevices(content), [content]);
  const summary = useMemo(() => summarize(table), [table]);

  /**
   * A line per device and nothing else — no header, no total — so a file with
   * nothing in it is a driver with no device rather than a read that failed.
   */
  if (summary.lines === 0 && summary.unread.length === 0) {
    return (
      <p className="notice" role="status" data-testid="no-devices">
        Nothing in this file, which here is <strong>an answer</strong>: the driver prints a line per
        device it has a node for and nothing else — no header, no count — so a machine with nothing
        attached has nothing to print. The sg driver is loaded, since this file is its own and it is
        here to be read; what it has no devices for is what <code>/proc/scsi/scsi</code> beside it
        also shows empty.
      </p>
    );
  }

  return (
    <>
      {summary.unread.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unread">
          {summary.unread.length === 1 ? 'A line here is' : `${summary.unread.length} lines here are`}{' '}
          not nine numbers, which is all this file holds —{' '}
          <code>{summary.unread[0]}</code>
        </p>
      )}

      {summary.placeholders.length > 0 && (
        <p className="notice" role="status" data-testid="gone">
          {summary.placeholders.length === 1 ? 'A line reads' : `${summary.placeholders.length} lines read`}{' '}
          <code>-1</code> in all nine columns, which is <strong>a device that has gone</strong>{' '}
          rather than a device with nothing to say. The line stays where it is on purpose: the sg
          number is the line&rsquo;s <em>position</em>, so dropping it would renumber every device
          under it — <code>{nodeOf(summary.placeholders[0]!)}</code> is held open here.
        </p>
      )}

      {summary.offline.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="offline">
          {summary.offline.length === 1 ? 'A device is' : `${summary.offline.length} devices are`}{' '}
          <strong>offline</strong> — <code>scsi_device_online</code> is 0, which is the midlayer
          having stopped talking to it without forgetting it. That is not the same as the{' '}
          <code>-1</code> line above: the device is still here, still numbered, and still has its
          node.
        </p>
      )}

      <div className="card mounts sgdev">
        <table className="mounts__table sgdev__table" aria-label="Generic SCSI devices">
          <thead>
            <tr>
              <th scope="col">Node</th>
              <th scope="col">H:C:I:L</th>
              <th scope="col">Type</th>
              <th scope="col">Busy / queue</th>
              <th scope="col">Opens</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {table.devices.map((device) => (
              <DeviceRow key={device.index} device={device} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        Nine numbers a line, and <strong>this file has no header of its own</strong>: the names are
        in <code>device_hdr</code> beside it, which prints{' '}
        <code>{COLUMNS.join(' ')}</code> and nothing else, so a reader who has not opened that one
        is looking at bare numbers. What is <em>not</em> a column matters as much.{' '}
        <strong>Nothing here names the sg device</strong> — the driver walks its devices in index
        order, so the first line is <code>/dev/sg0</code> and the position is the name, which is
        also why a device that has gone leaves nine <code>-1</code>s behind rather than a line
        removed: taking the line out would renumber everything under it. And{' '}
        <strong>one column says nothing at all</strong>: <code>opens</code> promises a count and the
        driver passes a literal <code>1</code>, so every device reads 1 whether or not anything has
        its node open. The rest are real. The first four are the address{' '}
        <code>/proc/scsi/scsi</code> prints in words, <code>type</code> is the peripheral device
        type as a <strong>number</strong> where that file gives the name — the same table read from
        the two ends — <code>qdepth</code> is how many commands the midlayer will keep in flight
        here, and <code>busy</code> is how many are in flight now, which is the one thing in this
        file that differs between two reads a second apart. <code>online</code> is{' '}
        <code>scsi_device_online</code>: 0 for a device the midlayer has stopped talking to and not
        yet forgotten, which is a different state from the <code>-1</code> line.
      </p>
    </>
  );
}
