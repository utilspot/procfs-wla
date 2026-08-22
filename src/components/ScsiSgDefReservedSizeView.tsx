import { useMemo } from 'react';
import {
  DEFAULT,
  DEFAULT_SPELLING,
  formatBytes,
  GET_IOCTL,
  MAX_WRITABLE,
  parseDefReservedSize,
  SET_IOCTL,
  summarize,
} from '../lib/scsi-sg-def-reserved-size';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function ScsiSgDefReservedSizeView({ content }: { content: string }) {
  const size = useMemo(() => parseDefReservedSize(content), [content]);
  const summary = useMemo(() => (size === null ? null : summarize(size)), [size]);

  if (size === null || summary === null) {
    return (
      <p className="notice notice--warn">
        No number in this file. It holds <code>sg_big_buff</code> and nothing else — one integer,
        printed as <code>&quot;%d\n&quot;</code> — so anything else here came from somewhere other
        than <code>sg_proc_seq_show_dressz</code>. Switch to the raw view to see what the server
        returned.
      </p>
    );
  }

  return (
    <>
      {summary.aboveCeiling && (
        <p className="notice" role="status" data-testid="above-ceiling">
          <strong>This did not come from this file.</strong> The write path refuses anything above{' '}
          <code>{MAX_WRITABLE}</code> — one megabyte — and this is{' '}
          <strong>{summary.readable}</strong>. The megabyte is a limit on the <em>write</em> rather
          than on the value, and the module parameter is not clamped, so this was set with{' '}
          <code>sg.def_reserved_size=</code> at load, or by a driver older than that check.
        </p>
      )}

      {summary.isZero && (
        <p className="notice" role="status" data-testid="zero">
          <strong>No reserve at all.</strong> A descriptor opened now gets no buffer held for it, so
          every transfer finds its memory when the command is made rather than when the file is
          opened. That is allowed and is not a fault — it trades a reservation that may go unused
          for an allocation that may fail under pressure.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat
          label="reserved size"
          value={summary.readable}
          title={`sg_big_buff — ${summary.bytes} bytes, which is what a newly opened /dev/sg* gets`}
        />
        <Stat
          label="bytes"
          value={String(summary.bytes)}
          title="The number as the file prints it, which is what has to be written back"
        />
        <Stat
          label="against the default"
          value={
            summary.isDefault
              ? 'unchanged'
              : summary.timesDefault >= 1
                ? `${summary.timesDefault}×`
                : `${Math.round(summary.timesDefault * 100)}%`
          }
          title={`The compiled default is ${DEFAULT} bytes — SG_DEF_RESERVED_SIZE, spelled ${DEFAULT_SPELLING}`}
        />
        {summary.pages !== null && (
          <Stat
            label="pages"
            value={String(summary.pages)}
            title="At 4 KiB a page, which is the size the header assumes because it cannot see PAGE_SIZE"
          />
        )}
      </section>

      <p className="notice" role="status" data-testid="a-default">
        <strong>This is a default, not a state.</strong> It is the size of the reserved buffer a{' '}
        <em>newly opened</em> <code>/dev/sg*</code> gets — memory the driver holds for that
        descriptor so a transfer has somewhere to land without an allocation at command time.
        Writing here changes what the <strong>next</strong> open gets and nothing about a descriptor
        already open: a program moves its own with <code>{SET_IOCTL}</code> and reads back what it
        actually got with <code>{GET_IOCTL}</code>, which need not be what it asked for.
      </p>

      <div className="card sgsize">
        <table className="cpu-card__fields sgsize__fields">
          <tbody>
            <tr>
              <th scope="row" title="include/scsi/sg.h, where SG_DEF_RESERVED_SIZE is SG_SCATTER_SZ">
                Compiled default
              </th>
              <td>
                <span className="sgsize__value">{formatBytes(DEFAULT)}</span>
                <span className="muted">
                  {' '}
                  — <code>SG_DEF_RESERVED_SIZE</code>, spelled <code>{DEFAULT_SPELLING}</code>:
                  eight pages, as pages were when it was written. The header notes that{' '}
                  <code>PAGE_SIZE</code> is not available to it, so the number is{' '}
                  {DEFAULT} whatever this machine&rsquo;s pages are
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="Taken when the driver is loaded">
                Module parameter
              </th>
              <td>
                <span className="sgsize__value">
                  <code>sg.def_reserved_size=</code>
                </span>
                <span className="muted"> — set at load, and not clamped the way a write here is</span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="This file, which is writable">
                This file
              </th>
              <td>
                <span className="sgsize__value">
                  <code>echo {DEFAULT} &gt; /proc/scsi/sg/def_reserved_size</code>
                </span>
                <span className="muted">
                  {' '}
                  — taken from a process holding both <code>CAP_SYS_ADMIN</code> and{' '}
                  <code>CAP_SYS_RAWIO</code>, and only up to {formatBytes(MAX_WRITABLE)}
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="Which changes one descriptor rather than the default">
                One descriptor
              </th>
              <td>
                <span className="sgsize__value">
                  <code>{SET_IOCTL}</code>
                </span>
                <span className="muted">
                  {' '}
                  — the only way to change a reserve already handed out, and it changes that one
                  alone
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        One number, and the thing worth knowing about it is <strong>when it applies</strong>: at
        open. The reserved buffer is what lets the generic driver take a command without going
        looking for memory first, which is why raising it is the usual answer for a program doing
        large transfers through <code>/dev/sg*</code> and why lowering it costs nothing on a machine
        that does none. The default is <code>{DEFAULT_SPELLING}</code> — eight pages — and the
        ceiling on a write here is one megabyte, hard-coded beside the check for{' '}
        <code>CAP_SYS_ADMIN</code> and <code>CAP_SYS_RAWIO</code>; the file itself is{' '}
        <code>rw-r--r--</code> and owned by root, so those capabilities sit on top of the permission
        rather than instead of it. A value above the megabyte is therefore not impossible, only
        impossible to have written <em>here</em>: the module parameter takes what it is given. And
        none of this says what any open descriptor is actually holding — the sg files beside this
        one count devices and name them, and what one program reserved is between it and its own{' '}
        <code>{GET_IOCTL}</code>.
      </p>
    </>
  );
}
