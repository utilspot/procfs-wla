import { useMemo, useState } from 'react';
import {
  flagsOf,
  formatFlags,
  isLunZeroOnly,
  isUnusedBit,
  matchesAnyModel,
  MODEL_WIDTH,
  parseDeviceInfo,
  summarize,
  unnamedBits,
  VENDOR_WIDTH,
  writeSpellingOf,
  type DeviceInfoEntry,
} from '../lib/scsi-device-info';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * A field as the file gives it, quoted **only where the quotes carry
 * something**: an empty field, or one whose spaces would otherwise be invisible.
 * The kernel quotes every field for that reason; a page can show the value
 * plainly where there is nothing to hide and keep the quotes where there is.
 */
function Field({ value, what }: { value: string; what: string }) {
  const hidden = value === '' || value !== value.trim();

  if (!hidden) return <>{value}</>;

  return (
    <span
      className="devinfo__quoted"
      title={
        value === ''
          ? `No ${what} at all, which the quotes in the file are what show`
          : `The spaces are part of the ${what}, which is why the file quotes it`
      }
    >
      &apos;{value}&apos;
    </span>
  );
}

function EntryRow({ entry }: { entry: DeviceInfoEntry }) {
  const flags = flagsOf(entry);
  const unnamed = unnamedBits(entry);
  const anyModel = matchesAnyModel(entry);

  return (
    <tr className={anyModel ? 'devinfo__row devinfo__row--any' : 'devinfo__row'}>
      <td className="devinfo__vendor">
        <span title={`Matched exactly against the ${VENDOR_WIDTH} bytes of the device's INQUIRY vendor`}>
          <Field value={entry.vendor} what="vendor" />
        </span>
      </td>

      <td className="devinfo__model">
        <span className="devinfo__cell">
          <span
            title={`Matched against the ${MODEL_WIDTH} bytes of the device's INQUIRY model — as a prefix, for an entry the kernel was built with`}
          >
            <Field value={entry.model} what="model" />
          </span>
          {anyModel && (
            <span
              className="chip chip--flag"
              title="No model at all, which is a prefix of every model: a compiled-in entry like this covers the whole vendor"
            >
              any model
            </span>
          )}
        </span>
      </td>

      <td className="devinfo__flags">
        <span className="devinfo__cell">
          {flags.map((flag) => (
            <span key={flag.bit} className="chip" title={`Bit ${flag.bit}. ${flag.what}`}>
              {flag.name}
            </span>
          ))}
          {unnamed.map((bit) => (
            <span
              key={`bit-${bit}`}
              className="chip chip--bug"
              title={
                isUnusedBit(bit)
                  ? `Bit ${bit}, which scsi_devinfo.h declares and then does not use — a flag this kernel has retired`
                  : `Bit ${bit}, which is past the last flag this app has a name for`
              }
            >
              bit {bit}
            </span>
          ))}
          {flags.length === 0 && unnamed.length === 0 && (
            <span className="muted" title="An entry that asks for no special treatment at all">
              none
            </span>
          )}
        </span>
      </td>

      <td className="devinfo__mask">
        <span title={`Written back as ${writeSpellingOf(entry)}`}>{formatFlags(entry.flags)}</span>
      </td>
    </tr>
  );
}

export function ScsiDeviceInfoView({ content }: { content: string }) {
  const list = useMemo(() => parseDeviceInfo(content), [content]);
  const summary = useMemo(() => summarize(list), [list]);
  const [hidePlain, setHidePlain] = useState(false);

  const visible = useMemo(
    () => (hidePlain ? list.entries.filter((entry) => !isLunZeroOnly(entry)) : list.entries),
    [list, hidePlain],
  );

  if (list.entries.length === 0) {
    return (
      <p className="notice notice--warn">
        No entries in this file. It is compiled into the kernel rather than gathered from the
        machine, so a stock kernel always has some — this is the read failing rather than a list
        with nothing in it. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.unread.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unread">
          {summary.unread.length === 1 ? 'A line here is' : `${summary.unread.length} lines here are`}{' '}
          not an entry: the printer writes <code>&apos;vendor&apos; &apos;model&apos; 0xflags</code>{' '}
          and nothing else, so this is something else the file said —{' '}
          <code>{summary.unread[0]}</code>
        </p>
      )}

      {summary.unnamed.length > 0 && (
        <p className="notice" role="status" data-testid="unnamed">
          {summary.unnamed.length === 1 ? 'An entry sets' : `${summary.unnamed.length} entries set`}{' '}
          a bit with <strong>no flag behind it</strong>. Five numbers in the range are declared{' '}
          <code>__BLIST_UNUSED_*</code> — retired rather than never assigned — and anything above
          the last flag is a kernel newer than this table. Either way the midlayer reads no meaning
          from it, and this page says which bit rather than guessing at one.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="entries" value={String(summary.entries)} />
        <Stat
          label="vendors"
          value={String(summary.vendors.length)}
          title="Distinct vendor strings, which are matched exactly rather than as a prefix"
        />
        <Stat
          label="flags used"
          value={String(summary.flags.length)}
          title={`Of the flags this app names: ${summary.flags.map((use) => use.flag.name).join(', ')}`}
        />
        <Stat
          label="whole vendors"
          value={String(summary.anyModel.length)}
          title={
            summary.anyModel.length === 0
              ? 'No entry here names an empty model'
              : `Entries with no model, which cover every device of their vendor: ${summary.anyModel
                  .map((entry) => entry.vendor)
                  .join(', ')}`
          }
        />
      </section>

      {summary.lunZeroOnly.length > 0 && (
        <label className="mounts__filter">
          <input
            type="checkbox"
            checked={hidePlain}
            onChange={(event) => setHidePlain(event.target.checked)}
          />
          Hide the plain <code>NOLUN</code> entries ({summary.lunZeroOnly.length} of{' '}
          {summary.entries} ask only that nothing scan past logical unit 0)
        </label>
      )}

      <div className="card mounts devinfo">
        <table className="mounts__table devinfo__table" aria-label="Device quirks">
          <thead>
            <tr>
              <th scope="col">Vendor</th>
              <th scope="col">Model</th>
              <th scope="col">Flags</th>
              <th scope="col">Mask</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <EntryRow key={entry.raw} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>

      {/* The flags this list actually uses, said once — the rows carry names,
          and what a name means belongs beside the set rather than in every row
          that has it. */}
      <section className="card devinfo-legend" aria-label="What these flags do">
        <h2 className="devinfo-legend__title">The flags in this list</h2>

        <table className="devinfo-legend__table">
          <tbody>
            {summary.flags.map(({ flag, count }) => (
              <tr key={flag.bit}>
                <th scope="row">
                  <span className="devinfo-legend__name">{flag.name}</span>
                  <span className="devinfo-legend__bit muted">bit {flag.bit}</span>
                </th>
                <td>
                  {flag.what}
                  <span className="muted">
                    {' '}
                    — {count === 1 ? 'one entry' : `${count} entries`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="disks__note muted">
        <strong>Nothing here is about this machine.</strong> The list is compiled into the kernel —{' '}
        <code>scsi_static_device_list[]</code> in{' '}
        <code>drivers/scsi/scsi_devinfo.c</code> — so two computers running the same kernel print
        the same file whether or not either has ever had one of these plugged in. It is the table of
        what the midlayer knows to <em>work around</em>, which is why it reads as a museum: Maxtor
        drives from the 1980s, scanners, a magneto-optical library or two. What is attached is{' '}
        <code>/proc/scsi/scsi</code> beside it. A line is{' '}
        <code>&apos;%.8s&apos; &apos;%.16s&apos; 0x%x</code> over the same INQUIRY fields that file
        prints, and <strong>the quotes are what make an empty field visible</strong> —{' '}
        <code>&apos;Promise&apos; &apos;&apos;</code> is an entry with no model, which matters
        because a compiled-in model is a <strong>prefix</strong>: the empty string is a prefix of
        everything, so that one line covers every Promise device there is. Two things the file does
        not say. <strong>How an entry matches</strong>: the ones the kernel was built with match a
        model prefix, while one added through this file is space-padded to the full 8 and 16 bytes
        by <code>scsi_dev_info_list_add</code> and compared whole — the same line, two meanings, and
        the file prints them identically. And <strong>which lines came from where</strong>: the list
        is writable — <code>echo &apos;vendor:model:0x40&apos; &gt; /proc/scsi/device_info</code>,
        the spelling <code>scsi_mod.dev_flags=</code> takes at boot — and a written entry looks
        exactly like a compiled-in one once it is in. It applies from the next scan rather than to
        what is already attached, since the flags are read when a device is found.
      </p>
    </>
  );
}
