import { useMemo, type ReactNode } from 'react';
import {
  addressOf,
  ATA_VENDOR,
  devicesOfHost,
  HEADER,
  isAtaBridge,
  isModelCut,
  isVendorCut,
  missingLines,
  MODEL_WIDTH,
  parseScsi,
  REV_WIDTH,
  sharesTarget,
  standardOf,
  summarize,
  sysfsPathOf,
  typeOf,
  VENDOR_WIDTH,
  type ScsiDevice,
  type ScsiTable,
} from '../lib/scsi';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * One labelled fact about a device. The label is the row's own, so a fact the
 * file did not print says that rather than leaving a cell to be read as blank.
 */
function Field({
  label,
  title,
  children,
  note,
}: {
  label: string;
  title?: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <tr>
      <th scope="row" title={title}>
        {label}
      </th>
      <td>
        <span className="scsi-card__value">{children}</span>
        {note !== undefined && <span className="scsi-card__note muted">{note}</span>}
      </td>
    </tr>
  );
}

/** A value the file did not print, said in words rather than left empty. */
function Unprinted({ what }: { what: string }) {
  return (
    <span className="muted" title={`This record carried no ${what}`}>
      not printed
    </span>
  );
}

function DeviceCard({ device, table }: { device: ScsiDevice; table: ScsiTable }) {
  const type = typeOf(device);
  const standard = standardOf(device.revision);
  const ata = isAtaBridge(device);
  const missing = missingLines(device);
  const address = addressOf(device);

  return (
    <article className="card scsi-card" aria-label={`SCSI device ${address}`}>
      <header className="scsi-card__header">
        <span
          className="scsi-card__address"
          title={`Host ${device.host}, channel ${device.channel}, target ${device.id}, logical unit ${device.lun} — the name of this device in sysfs, and what lsscsi prints in brackets`}
        >
          {address}
        </span>
        <h3 className="scsi-card__title">
          {device.model === '' ? <span className="muted">no model printed</span> : device.model}
        </h3>
        <span className="scsi-card__chips">
          {ata && (
            <span
              className="chip chip--flag"
              title="Behind libata's SCSI translation: a SATA disk, which the midlayer attached as if it answered SCSI"
            >
              ATA
            </span>
          )}
          {isModelCut(device) && (
            <span className="chip" title={`${MODEL_WIDTH} bytes, which is the whole field`}>
              cut
            </span>
          )}
          {device.lun !== 0 && (
            <span
              className="chip"
              title={
                sharesTarget(table, device)
                  ? 'Another logical unit of the same target is here too — one device answering as several, which is what a card reader or a virtual-media BMC does'
                  : 'A logical unit other than 0, with nothing else of its target attached'
              }
            >
              lun {device.lun}
            </span>
          )}
          {device.ccs && (
            <span
              className="chip chip--flag"
              title="The Common Command Set: a SCSI-1 device that answers in the CCS format, which the midlayer counts a level above plain SCSI-1 — the only suffix this file ever prints"
            >
              CCS
            </span>
          )}
        </span>
      </header>

      <table className="cpu-card__fields scsi-card__fields">
        <tbody>
          <Field
            label="Vendor"
            title={`sdev->vendor — ${VENDOR_WIDTH} bytes of the INQUIRY response`}
            note={
              ata
                ? `not the drive's: libata answers ATA for every disk it translates for`
                : isVendorCut(device)
                  ? `fills the ${VENDOR_WIDTH} bytes, so a longer name would have been cut`
                  : undefined
            }
          >
            {device.vendor === '' ? <Unprinted what="vendor" /> : device.vendor}
          </Field>

          <Field
            label="Model"
            title={`sdev->model — ${MODEL_WIDTH} bytes of the INQUIRY response`}
            note={
              isModelCut(device)
                ? `fills the ${MODEL_WIDTH} bytes, so this may be the front of a longer name`
                : undefined
            }
          >
            {device.model === '' ? <Unprinted what="model" /> : device.model}
          </Field>

          <Field
            label="Firmware"
            title={`sdev->rev — the firmware revision, ${REV_WIDTH} bytes of it, which is a string rather than a number`}
          >
            {device.rev === '' ? <Unprinted what="revision string" /> : device.rev}
          </Field>

          <Field
            label="Type"
            title={
              type === null
                ? 'The peripheral device type, which the file prints as a name and never as the number it stands for'
                : `${type.what} — peripheral device type 0x${type.code === null ? '??' : type.code.toString(16).padStart(2, '0')}, which the file does not print`
            }
          >
            {device.type === '' ? <Unprinted what="type" /> : device.type}
            {type !== null && type.code !== null && (
              <span
                className="scsi-card__code muted"
                title="The number the name stands for, which is what SPC and every datasheet talk in"
              >
                0x{type.code.toString(16).padStart(2, '0')}
              </span>
            )}
          </Field>

          <Field
            label="ANSI"
            title={`The version the device itself answered with: the kernel prints scsi_level - (scsi_level > 1), undoing the +1 it added at scan time${
              standard === null ? '' : `. ${standard.note}`
            }`}
          >
            {device.revision === null ? (
              <Unprinted what="ANSI revision" />
            ) : (
              <>
                <span className="scsi-card__revision">
                  {String(device.revision).padStart(2, '0')}
                </span>
                {standard !== null && <span className="muted">{standard.name}</span>}
              </>
            )}
          </Field>

          <Field
            label="Driver"
            title="Which upper-level driver takes a device of this type, and so what it becomes in /dev"
          >
            {type === null || type.driver === null ? (
              <span
                className="muted"
                title="No upper-level driver binds this type, so it is reachable through the generic driver and nothing else"
              >
                sg only
              </span>
            ) : (
              <>
                {type.driver}
                {type.node !== null && (
                  <span
                    className="scsi-card__node muted"
                    title="Which of these it became is not in this file: the address is the handle, and sysfs is where the name is"
                  >
                    {type.node}
                  </span>
                )}
              </>
            )}
          </Field>

          <Field
            label="In sysfs"
            title="Where the rest of this device is: the vendor, model and type again, plus the queue settings, the state and the delete file this page cannot show"
          >
            <span className="scsi-card__sysfs">{sysfsPathOf(device)}</span>
          </Field>
        </tbody>
      </table>

      {missing.length > 0 && (
        <div className="scsi-card__unread" data-testid={`unread-${address}`}>
          <p className="muted">
            {missing.length === 2
              ? 'Neither line under the address could be read'
              : missing[0] === 'inquiry'
                ? 'The INQUIRY line under the address could not be read'
                : 'The type line under the address could not be read'}
            , so the record is here as it came:
          </p>
          <pre>{device.raw}</pre>
        </div>
      )}
    </article>
  );
}

/**
 * What the names and numbers on the cards mean, said **once** for the page
 * rather than once per card.
 *
 * Four identical disks would otherwise carry four copies of what
 * `Direct-Access` is and four of what `06` claims, which is the same three
 * lines of prose four times over. The card keeps what is true of that device —
 * the name, the code, the standard it claims — and the meanings live here,
 * against the set the machine actually has.
 */
function Legend({ table }: { table: ScsiTable }) {
  const types = useMemo(() => {
    const seen: { name: string; type: ReturnType<typeof typeOf> }[] = [];

    for (const device of table.devices) {
      if (device.type === '' || seen.some((entry) => entry.name === device.type)) continue;
      seen.push({ name: device.type, type: typeOf(device) });
    }

    return seen;
  }, [table]);

  const standards = useMemo(() => {
    const seen: number[] = [];

    for (const device of table.devices) {
      if (device.revision === null || seen.includes(device.revision)) continue;
      seen.push(device.revision);
    }

    return seen.sort((a, b) => a - b);
  }, [table]);

  return (
    <section className="card scsi-legend" aria-label="What the types and revisions here mean">
      <h2 className="scsi-legend__title">On this machine</h2>

      <table className="scsi-legend__table" aria-label="The types attached here">
        <tbody>
          {types.map(({ name, type }) => (
            <tr key={name}>
              <th scope="row">
                <span className="scsi-legend__term">{name}</span>
                {type !== null && type.code !== null && (
                  <span className="scsi-legend__code muted">
                    0x{type.code.toString(16).padStart(2, '0')}
                  </span>
                )}
              </th>
              <td>
                {type === null ? (
                  <span className="muted">
                    A type name this app has no facts for, so the name is all there is
                  </span>
                ) : (
                  <>
                    {type.what}
                    {type.driver === null ? (
                      <span className="muted"> — no upper-level driver binds it</span>
                    ) : (
                      <span className="muted">
                        {' '}
                        — the <code>{type.driver}</code> driver takes it
                        {type.node !== null && <> and gives it {type.node}</>}
                      </span>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}

          {standards.map((revision) => {
            const standard = standardOf(revision);

            return (
              <tr key={`ansi-${revision}`}>
                <th scope="row">
                  <span className="scsi-legend__term">
                    ANSI {String(revision).padStart(2, '0')}
                  </span>
                  {standard !== null && (
                    <span className="scsi-legend__code muted">{standard.name}</span>
                  )}
                </th>
                <td>
                  {standard === null ? (
                    <span className="muted">
                      Outside the three bits the field has, which nothing should print
                    </span>
                  ) : (
                    standard.note
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function ScsiView({ content }: { content: string }) {
  const table = useMemo(() => parseScsi(content), [content]);
  const summary = useMemo(() => summarize(table), [table]);

  /** The header with nothing under it, which is an answer rather than silence. */
  if (summary.header && summary.devices === 0) {
    return (
      <p className="notice" role="status" data-testid="nothing-attached">
        <code>{HEADER}</code> — and nothing under it. The header is printed whether or not there is
        anything to list, so this is a machine whose <strong>SCSI midlayer is loaded and has
        nothing attached to it</strong>, said plainly. That is the ordinary state of a modern
        machine rather than a fault: <strong>NVMe is not SCSI</strong>, and neither is virtio-blk
        or an SD card, so a computer whose only disk is one of those has disks and an empty list
        here.
      </p>
    );
  }

  if (table.devices.length === 0) {
    return (
      <p className="notice notice--warn">
        Nothing in this file, and not even the <code>{HEADER}</code> line the kernel prints before
        the devices — so this is the read failing rather than the machine having nothing attached.
        Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.ata.length > 0 && (
        <p className="notice" role="status" data-testid="ata">
          {summary.ata.length === 1 ? 'One device answers' : `${summary.ata.length} devices answer`}{' '}
          with the vendor <code>{ATA_VENDOR}</code>, which is no vendor at all:{' '}
          <strong>these are SATA disks</strong>, and libata is making the INQUIRY response up on
          their behalf — <code>{ATA_VENDOR}</code> for the vendor, the first {MODEL_WIDTH}{' '}
          characters of the drive&rsquo;s ATA model string for the model, the first {REV_WIDTH} of
          its firmware revision for the rev. So the name in the model field is the whole of what
          the disk is called here, and the maker&rsquo;s own name is not in the file.
        </p>
      )}

      {summary.luns.length > 0 && (
        <p className="notice" role="status" data-testid="luns">
          {summary.luns.length === 1 ? 'A device sits' : `${summary.luns.length} devices sit`} at a
          logical unit other than <code>0</code> — <strong>one target answering as several</strong>,
          which is what a card reader&rsquo;s slots are, and what a BMC&rsquo;s virtual media is.
          They share the first three numbers of their address and differ in the fourth, which is the
          whole reason the address has four.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="devices" value={String(summary.devices)} />
        <Stat
          label="hosts"
          value={String(summary.hosts.length)}
          title={`One host is one controller port rather than one card: ${summary.hosts
            .map((host) => `scsi${host}`)
            .join(', ')}`}
        />
        <Stat
          label="types"
          value={String(summary.types.length)}
          title={`Distinct peripheral device types: ${summary.types.join(', ')}`}
        />
        <Stat
          label="oldest standard"
          value={summary.oldest === null ? '—' : summary.oldest.name}
          title={
            summary.oldest === null
              ? 'No ANSI revision was printed for anything here'
              : `The oldest anything here claims. ${summary.oldest.note}`
          }
        />
      </section>

      {/* A host is the grouping the file itself has: it prints the devices of
          one controller port together, and the address is counted from it. */}
      {summary.hosts.map((host) => {
        const devices = devicesOfHost(table, host);

        return (
          <section className="scsi-host" key={host} aria-label={`Host scsi${host}`}>
            <h2 className="scsi-host__name">
              <span
                title="One host is one controller port rather than one card, and the first number of every address under it"
              >
                scsi{host}
              </span>
              <span className="count">{devices.length}</span>
            </h2>

            <div className="scsi-grid">
              {devices.map((device) => (
                <DeviceCard key={addressOf(device)} device={device} table={table} />
              ))}
            </div>
          </section>
        );
      })}

      <Legend table={table} />

      <p className="disks__note muted">
        A device here is <strong>three lines</strong>: the address, the INQUIRY response and the
        type — which is why it reads as a card rather than a row, since only the first of the three
        is short. The address is the useful one —{' '}
        <code>Host: scsi0 Channel: 00 Id: 00 Lun: 00</code> is the <code>0:0:0:0</code> that names
        the device&rsquo;s directory in sysfs and that <code>lsscsi</code> prints in brackets, and{' '}
        <strong>it is the only handle this file gives</strong>: nothing in here says which{' '}
        <code>/dev/sd*</code> a disk became, which is the first thing anybody wants and the reason{' '}
        <code>lsscsi</code> exists. The <em>host</em> is one controller port rather than one card,
        the <em>channel</em> is a real bus only where a controller has several, the <em>id</em> is
        the target — a SCSI id once, and whatever the transport made up since — and the{' '}
        <em>lun</em> is where one target becomes several devices.{' '}
        <strong>The middle line is columns, not words</strong>: the kernel writes{' '}
        {VENDOR_WIDTH}, {MODEL_WIDTH} and {REV_WIDTH} bytes of the INQUIRY response one byte at a
        time, putting a space in for anything unprintable, so the padding is the device&rsquo;s own
        and a longer name arrives cut rather than wrapped — and a name cut at a space cannot be told
        from one that fits. <strong>The type is a name, not the number it stands for</strong>: this
        page carries the code back beside it, along with which driver takes such a device, since an{' '}
        <code>Enclosure</code> or a <code>RAID</code> line is a real device the midlayer attached
        that no block driver claims. And the revision is the ANSI version the device itself answered
        with: the kernel prints <code>scsi_level - (scsi_level &gt; 1)</code>, undoing the{' '}
        <code>+1</code> it added at scan time, in a field three bits wide — so <code>07</code> is the
        ceiling and anything newer than SPC-5 says it too, and <code>CCS</code> after a{' '}
        <code>01</code> is the one suffix, marking a SCSI-1 device that answers in the Common
        Command Set format. A fact the file did not print says so in its own row, and a record whose
        lines could not be read at all is shown as it came. Finally, this file is{' '}
        <strong>legacy and it is writable</strong>: it exists only with{' '}
        <code>CONFIG_SCSI_PROC_FS</code>, and writing{' '}
        <code>scsi add-single-device H C I L</code> or <code>scsi remove-single-device H C I L</code>{' '}
        into it is the old way of doing what{' '}
        <code>/sys/class/scsi_host/hostH/scan</code> and a device&rsquo;s own{' '}
        <code>delete</code> do now.
      </p>
    </>
  );
}
