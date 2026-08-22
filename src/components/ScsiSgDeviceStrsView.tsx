import { useMemo } from 'react';
import {
  isAtaBridge,
  isModelCut,
  isUnscanned,
  isVendorCut,
  MODEL_WIDTH,
  nodeOf,
  NULL_STRS,
  parseDeviceStrs,
  PLACEHOLDER,
  REV_WIDTH,
  summarize,
  VENDOR_WIDTH,
  type DeviceStrings,
} from '../lib/scsi-sg-device-strs';
import { ATA_VENDOR } from '../lib/scsi';

function DeviceRow({ device }: { device: DeviceStrings }) {
  if (!device.present) {
    return (
      <tr className="sgstr__row sgstr__row--absent">
        <td className="sgstr__node">
          <span title="The sg number is held open here: the line stays so that nothing under it is renumbered">
            {nodeOf(device)}
          </span>
        </td>
        <td className="sgstr__absent" colSpan={3}>
          <span
            className="chip chip--bug"
            title="What this file prints where a device has gone. The devices file beside it prints nine -1s for the same line — same absence, two spellings"
          >
            {PLACEHOLDER}
          </span>
        </td>
      </tr>
    );
  }

  const unscanned = isUnscanned(device);
  const ata = isAtaBridge(device);

  return (
    <tr className={unscanned ? 'sgstr__row sgstr__row--unscanned' : 'sgstr__row'}>
      <td className="sgstr__node">
        <span title="Nothing in the file names this: the line's position is the node, and the same line of the devices file is the same device">
          {nodeOf(device)}
        </span>
      </td>

      <td className="sgstr__vendor">
        <span
          title={
            ata
              ? `Not the drive's vendor but libata's: a SATA disk has no INQUIRY of its own, so the translation answers ${ATA_VENDOR} and puts the real name in the model`
              : `scsidp->vendor — ${VENDOR_WIDTH} bytes of the INQUIRY response${isVendorCut(device) ? ', which this one fills, so a longer name would have been cut' : ''}`
          }
        >
          {device.vendor === '' ? '—' : device.vendor}
        </span>
        {ata && (
          <span className="chip chip--flag" title="Behind libata's SCSI translation">
            ATA
          </span>
        )}
      </td>

      <td className="sgstr__model">
        <span
          title={`scsidp->model — ${MODEL_WIDTH} bytes${isModelCut(device) ? ', which this one fills, so this may be the front of a longer name' : ''}`}
        >
          {device.model === '' ? '—' : device.model}
        </span>
        {isModelCut(device) && !unscanned && (
          <span className="chip" title={`${MODEL_WIDTH} bytes, which is the whole field`}>
            cut
          </span>
        )}
        {unscanned && (
          <span
            className="chip chip--bug"
            title={`All three fields are ${NULL_STRS}, the static string the midlayer points them at before the INQUIRY is read — one word cut to ${VENDOR_WIDTH}, ${MODEL_WIDTH} and ${REV_WIDTH}`}
          >
            not scanned
          </span>
        )}
      </td>

      <td className="sgstr__rev">
        <span title={`scsidp->rev — the firmware revision, ${REV_WIDTH} bytes of it`}>
          {device.rev === '' ? '—' : device.rev}
        </span>
      </td>
    </tr>
  );
}

export function ScsiSgDeviceStrsView({ content }: { content: string }) {
  const table = useMemo(() => parseDeviceStrs(content), [content]);
  const summary = useMemo(() => summarize(table), [table]);

  /** A line per device and nothing else, so none is an answer rather than a failure. */
  if (summary.lines === 0 && summary.unread.length === 0) {
    return (
      <p className="notice" role="status" data-testid="no-devices">
        Nothing in this file, which here is <strong>an answer</strong>: the driver prints a line per
        device it has a node for and nothing else, so a machine with nothing attached has no names
        to print. <code>/proc/scsi/sg/devices</code> beside it is empty for the same reason, and so
        is the list in <code>/proc/scsi/scsi</code>.
      </p>
    );
  }

  return (
    <>
      {summary.unread.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unread">
          {summary.unread.length === 1 ? 'A line here is' : `${summary.unread.length} lines here are`}{' '}
          neither three fields nor <code>{PLACEHOLDER}</code>, which is all this file prints —{' '}
          <code>{summary.unread[0]}</code>
        </p>
      )}

      {summary.absent.length > 0 && (
        <p className="notice" role="status" data-testid="absent">
          {summary.absent.length === 1 ? 'A line reads' : `${summary.absent.length} lines read`}{' '}
          <code>{PLACEHOLDER}</code> — a device that has <strong>gone</strong>, with its sg number
          held open so that nothing under it is renumbered.{' '}
          <code>/proc/scsi/sg/devices</code> says the same thing about the same line in nine{' '}
          <code>-1</code>s: the two files are printed by different functions, and each spells the
          absence its own way.
        </p>
      )}

      {summary.unscanned.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unscanned">
          {summary.unscanned.length === 1 ? 'A device reads' : `${summary.unscanned.length} devices read`}{' '}
          <code>{NULL_STRS}</code>, cut to each field&rsquo;s width. That is not a name: the three
          fields of <code>struct scsi_device</code> are <strong>pointers</strong>, and before a
          device is scanned all three point at one static string. The device is here and its INQUIRY
          has not been read — which this file can show and the numbers beside it cannot.
        </p>
      )}

      <div className="card mounts sgstr">
        <table className="mounts__table sgstr__table" aria-label="Generic SCSI device names">
          <thead>
            <tr>
              <th scope="col">Node</th>
              <th scope="col">Vendor</th>
              <th scope="col">Model</th>
              <th scope="col">Rev</th>
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
        The names of the devices <code>/proc/scsi/sg/devices</code> counts, printed as{' '}
        <code>&quot;%{VENDOR_WIDTH}.{VENDOR_WIDTH}s\t%{MODEL_WIDTH}.{MODEL_WIDTH}s\t%
        {REV_WIDTH}.{REV_WIDTH}s&quot;</code> — and <strong>the precision is doing real work</strong>
        . <code>struct scsi_device</code> declares <code>vendor</code>, <code>model</code> and{' '}
        <code>rev</code> as three <em>pointers into one INQUIRY buffer</em> rather than three
        strings, and nothing terminates them, so <code>%{VENDOR_WIDTH}.{VENDOR_WIDTH}s</code> is
        what stops the vendor running on into the model. The same declaration is why an unscanned
        device prints <code>{NULL_STRS}</code>: before the INQUIRY is read all three point at one
        static string, and each field shows as much of it as it has room for.{' '}
        <strong>Nothing here names the device</strong> — the position does, exactly as next door, so
        line <em>n</em> of this file and line <em>n</em> of that one are the same{' '}
        <code>/dev/sg*</code>, and reading them side by side is the whole trick: this file is the
        names and that one is the numbers. A device that has gone keeps its line in both, spelled{' '}
        <code>{PLACEHOLDER}</code> here and nine <code>-1</code>s there. These same three fields are
        printed by three files in three ways —{' '}
        <strong>fixed columns here, labelled and byte by byte in <code>/proc/scsi/scsi</code>,
        quoted in <code>/proc/scsi/device_info</code></strong> — and each spelling shows something
        the others hide: the quotes make an empty field visible, and the columns here never move.
      </p>
    </>
  );
}
