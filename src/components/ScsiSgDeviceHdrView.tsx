import { useMemo } from 'react';
import {
  compareToExpected,
  factFor,
  HEADER_LINE,
  isStockHeader,
  parseDeviceHdr,
} from '../lib/scsi-sg-device-hdr';

export function ScsiSgDeviceHdrView({ content }: { content: string }) {
  const header = useMemo(() => parseDeviceHdr(content), [content]);
  const comparison = useMemo(
    () => (header === null ? null : compareToExpected(header)),
    [header],
  );

  if (header === null || comparison === null) {
    return (
      <p className="notice notice--warn">
        Nothing in this file. It is a <code>seq_puts</code> of a string literal — the nine names the
        columns of <code>/proc/scsi/sg/devices</code> go by — so a driver that is there at all
        prints them. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {!comparison.agrees && (
        <p className="notice notice--warn" role="status" data-testid="disagrees">
          <strong>These are not the columns this app reads that file in.</strong>{' '}
          {comparison.unknown.length > 0 && (
            <>
              It names {comparison.unknown.map((name) => <code key={name}>{name}</code>)}, which
              this app has no meaning for.{' '}
            </>
          )}
          {comparison.missing.length > 0 && (
            <>
              It does not name{' '}
              {comparison.missing.map((name) => (
                <code key={name}>{name}</code>
              ))}
              , which it expects.{' '}
            </>
          )}
          {comparison.reordered && <>The names it shares are in another order. </>}
          So <code>/proc/scsi/sg/devices</code> is being read into columns that are not where this
          header says they are, and the page for it should be trusted only as far as the numbers
          themselves.
        </p>
      )}

      {header.extra.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="extra">
          Something is printed after the header, which no kernel does: this file is one line —{' '}
          <code>{header.extra[0]}</code>
        </p>
      )}

      <p className="notice" role="status" data-testid="what-it-is">
        <strong>This file is the header of another one.</strong>{' '}
        <code>/proc/scsi/sg/devices</code> prints nine tab-separated numbers per device and{' '}
        <strong>no header of its own</strong>, so these are the names those columns go by — kept in
        a file apart so that a program reading the numbers never has to skip a line it did not want.
        The driver prints it with a single <code>seq_puts</code> of a string literal: no device is
        looked at and no lock taken, so <strong>it says nothing about this machine</strong>, and two
        computers running two kernels print the same nine words.
      </p>

      <div className="card sghdr">
        <p className="sghdr__line">
          <code>{header.raw}</code>
        </p>

        <table className="sghdr__table" aria-label="What the names mean">
          <tbody>
            {header.names.map((name, index) => {
              const fact = factFor(name);

              return (
                <tr key={`${index}:${name}`} className={fact === null ? 'sghdr__row--unknown' : ''}>
                  <th scope="row">
                    <span
                      className="sghdr__position"
                      title={`Column ${index + 1} of ${header.names.length} in /proc/scsi/sg/devices`}
                    >
                      {index + 1}
                    </span>
                    <span className="sghdr__name">{name}</span>
                  </th>
                  <td>
                    {fact === null ? (
                      <span className="muted">
                        A name this app has no meaning for, so the column under it is a number and
                        nothing more
                      </span>
                    ) : (
                      <>
                        {fact.what}
                        {fact.caveat !== null && (
                          <span className="sghdr__caveat muted"> — {fact.caveat}</span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        Nine words, and the least eventful file in <code>/proc</code>:{' '}
        <code>sg_proc_seq_show_devhdr</code> is one <code>seq_puts</code> of{' '}
        <code>&quot;{HEADER_LINE.replace(/\t/g, '\\t')}&quot;</code>, which is why{' '}
        {isStockHeader(header) ? 'this is exactly what it says here' : 'a file differing from it is worth noticing'}
        . Being a literal is what makes it worth <em>checking</em> rather than reading: if a kernel
        ever changed the columns of <code>/proc/scsi/sg/devices</code>, this file is where it would
        say so first — so this page reads the names against the order the app parses that file in
        and says plainly when they disagree, instead of assuming they never will. The names
        themselves are terse, and three of them are read wrongly often enough to be worth the note
        beside them: <code>opens</code> is a promise the driver does not keep, <code>busy</code> is
        the one number over there that changes between two reads, and <code>online</code> is a
        different state from the nine <code>-1</code>s a device that has gone leaves behind. The
        names for what the devices are, rather than what they are doing, are in{' '}
        <code>device_strs</code> beside it — which has no header file of its own, and needs none:
        three fields in fixed columns are their own labels.
      </p>
    </>
  );
}
