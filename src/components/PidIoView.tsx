import { useMemo } from 'react';
import {
  averageRead,
  averageWrite,
  cancelledShare,
  formatBytes,
  formatCount,
  formatShare,
  inLayer,
  isEmpty,
  isUnaligned,
  overCancelled,
  parsePidIo,
  reallyWritten,
  summarize,
  withoutDisk,
  type IoCounter,
  type Layer,
  type ProcessIo,
} from '../lib/pid-io';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** A counter's value: bytes for five of them, a plain count for the two calls. */
function value(counter: IoCounter): string {
  return counter.field?.calls === true
    ? formatCount(counter.value)
    : `${formatBytes(counter.value)}`;
}

/**
 * One of the two measurements, as its own table — because the single thing this
 * file is misread for is the two being read as one.
 */
function LayerTable({
  io,
  layer,
  title,
  caption,
}: {
  io: ProcessIo;
  layer: Layer;
  title: string;
  caption: string;
}) {
  const counters = inLayer(io, layer);
  if (counters.length === 0) return null;

  return (
    <div className="card mounts io">
      <table className="mounts__table io__table" aria-label={title}>
        <caption className="io__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Counter</th>
            <th scope="col">Value</th>
            <th scope="col">What it counts</th>
          </tr>
        </thead>
        <tbody>
          {counters.map((counter) => (
            <tr className="io__row" key={counter.name}>
              <th scope="row" className="io__name">
                {counter.name}
                <span className="io__label muted">{counter.field!.label}</span>
              </th>
              <td className="io__value">
                {value(counter)}
                {counter.field!.calls !== true && counter.value > 0 && (
                  <span className="io__exact muted">{formatCount(counter.value)} B</span>
                )}
              </td>
              <td className="io__what muted">{counter.field!.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What a process has read and written, counted twice at two layers — and the
 * page exists to keep those two apart, since a gigabyte of `rchar` against zero
 * `read_bytes` is the ordinary case rather than a fault.
 */
export function PidIoView({ content }: { content: string }) {
  const io = useMemo(() => parsePidIo(content), [content]);
  const summary = useMemo(() => summarize(io), [io]);
  const cancelled = cancelledShare(io);

  const note = (
    <p className="disks__note muted">
      Seven counters, and the whole of reading them is knowing that the first four and the last
      three are <strong>not the same measurement of the same thing</strong>.{' '}
      <code>rchar</code> and <code>wchar</code> are bytes that went through <code>read()</code> and{' '}
      <code>write()</code> — all of them, from a disk, the page cache, a pipe, a socket, a tty or{' '}
      <code>/proc</code> itself, and none of them says a disk was involved. The block counters are
      the storage layer&rsquo;s, and <strong>they are not taken at the same layer as each
      other</strong> either. <code>read_bytes</code> is charged at <code>submit_bio</code>, so it is
      what a disk really was asked for — which is why it comes in whole sectors, and why{' '}
      <strong>readahead can push it above <code>rchar</code></strong>: the kernel fetched what the
      program never asked for. <code>write_bytes</code> is charged in{' '}
      <code>account_page_dirtied</code>, when a page is <em>dirtied</em> rather than when it is
      written, so it is a <strong>promise</strong> of I/O rather than a record of one — and that is
      why there is a <code>cancelled_write_bytes</code> and no cancelled read: dirty a megabyte,
      delete the file before writeback, and the truncate puts the megabyte back here rather than
      subtracting it, so both the promise and the withdrawal stay visible. The subtraction is left
      for you to do. <code>syscr</code> and <code>syscw</code> are the only two figures here that
      are <strong>not sizes</strong>: they count calls, and their ratio to the bytes is the useful
      thing about them. Every counter is cumulative from the process&rsquo;s first instruction and
      never goes down, and this is <strong>the whole thread group</strong> — every thread&rsquo;s
      counters plus the accumulated total of the ones that have already exited, where{' '}
      <code>/proc/&lt;pid&gt;/task/&lt;tid&gt;/io</code> is one thread. The file is mode{' '}
      <strong>0400</strong> with a <code>ptrace_may_access</code> check on top, like{' '}
      <code>environ</code> and unlike almost everything else about a process: byte counts leak, and
      the length of what somebody typed at a terminal is in here. Another user&rsquo;s reads{' '}
      <code>EACCES</code> — the 403 this page reports rather than a fault. It needs a{' '}
      <code>CONFIG_TASK_IO_ACCOUNTING</code> kernel, without which there is no file here at all
      rather than a file of zeroes.
    </p>
  );

  if (isEmpty(io)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="empty">
          There is nothing in this file. A process with I/O accounting compiled in always has seven
          counters here, even if every one of them is zero — so an empty one means the backend could
          not read it. Switch to the raw view to see what the server returned.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      {io.malformed.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="malformed">
          {io.malformed.length === 1 ? 'A line here is' : `${io.malformed.length} lines here are`} not{' '}
          <code>name: number</code>, which is the only shape this file has. Switch to the raw view
          to see what the server returned.
        </p>
      )}

      {summary.idle && (
        <p className="notice" role="status" data-testid="idle">
          <strong>Every counter is zero, which is an answer rather than a gap.</strong> This process
          has made no <code>read()</code> and no <code>write()</code> since it started — not even to
          a pipe or a terminal. A process that has only ever <code>mmap</code>ed its files looks
          like this too: mapped reads fault pages in without a syscall, so they are counted nowhere
          in this file.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="through read() and write()" value={formatBytes(summary.asked)} />
        <Stat label="fetched from storage" value={formatBytes(io.counts.read_bytes)} />
        <Stat label="really written to storage" value={formatBytes(summary.written)} />
        <Stat label="read and write calls" value={formatCount(summary.calls)} />
      </section>

      <LayerTable
        io={io}
        layer="syscall"
        title="Counters at the syscall layer"
        caption="What the program asked for — wherever it came from or went"
      />

      <LayerTable
        io={io}
        layer="block"
        title="Counters at the storage layer"
        caption="What the storage layer was told about — one of them before it happened"
      />

      {!summary.idle && !summary.overRead && withoutDisk(io) > 0 && (
        <p className="notice" role="status" data-testid="cached">
          <strong>
            {formatBytes(withoutDisk(io))} of what this process read never came off a disk.
          </strong>{' '}
          That is <code>rchar</code> less <code>read_bytes</code>: pages the cache already held, and
          everything read from something with no disk behind it at all — a pipe, a socket, a
          terminal, <code>/proc</code>.{' '}
          {io.counts.read_bytes === 0
            ? 'The block counter is zero, so not one byte of this was fetched from storage.'
            : `Only ${formatBytes(io.counts.read_bytes)} was actually fetched.`}
        </p>
      )}

      {summary.overRead && (
        <p className="notice" role="status" data-testid="over-read">
          <strong>
            The block layer fetched {formatBytes(io.counts.read_bytes)} for this process, which
            asked for {formatBytes(io.counts.rchar)}.
          </strong>{' '}
          Reading more than was wanted is readahead doing its job, not an error: the kernel fetches
          ahead of the program, and a process that opens many files and reads a little of each pays
          for the rest. This is the one direction of {formatBytes(Math.abs(withoutDisk(io)))} that{' '}
          <code>rchar</code> minus <code>read_bytes</code> cannot show as a positive number.
        </p>
      )}

      {summary.cancelled && !overCancelled(io) && (
        <p className="notice notice--warn" role="status" data-testid="cancelled">
          <strong>
            {formatBytes(io.counts.cancelled_write_bytes)} of the{' '}
            {formatBytes(io.counts.write_bytes)} this process promised the storage layer was
            withdrawn again{cancelled === null ? '' : ` — ${formatShare(cancelled)} of it`}.
          </strong>{' '}
          Those were dirty pages thrown away before writeback: a file written and then truncated or
          deleted, which is what a build, a test run or anything working through a scratch file
          does all day. The disk never saw them, so what this process really put on one is{' '}
          <code>write_bytes</code> less <code>cancelled_write_bytes</code> —{' '}
          <strong>{formatBytes(reallyWritten(io))}</strong>, not{' '}
          {formatBytes(io.counts.write_bytes)}.
        </p>
      )}

      {overCancelled(io) && (
        <p className="notice notice--error" role="alert" data-testid="over-cancelled">
          <strong>More was withdrawn than was ever promised.</strong>{' '}
          <code>cancelled_write_bytes</code> is above <code>write_bytes</code>, which the counters
          should not be able to say. The two are updated without a lock between them, so a small
          excess is a race caught mid-update; this much is a file that did not come from a running
          kernel.
        </p>
      )}

      {(summary.averageRead !== null || summary.averageWrite !== null) && (
        <p className="notice" role="status" data-testid="averages">
          <strong>
            {summary.averageRead === null
              ? ''
              : `Each read() moved ${formatBytes(averageRead(io)!)} on average`}
            {summary.averageRead !== null && summary.averageWrite !== null ? ', and each ' : ''}
            {summary.averageWrite === null
              ? ''
              : `${summary.averageRead === null ? 'Each ' : ''}write() ${formatBytes(averageWrite(io)!)}`}
            .
          </strong>{' '}
          That is the only thing <code>syscr</code> and <code>syscw</code> are good for on their
          own, and it is worth knowing: a program moving a few dozen bytes a call is paying for a
          trip into the kernel per line, where one moving tens of kilobytes is reading a buffer at a
          time.
        </p>
      )}

      {isUnaligned(io) && (
        <p className="notice notice--warn" role="status" data-testid="unaligned">
          A block counter here is not the round number its layer makes it.{' '}
          <code>read_bytes</code> is charged in whole sectors and <code>write_bytes</code> a whole
          page at a time, so a counter that is neither was reformatted between the kernel and here —
          the figures above are read as they stand.
        </p>
      )}

      {io.unknown.length > 0 && (
        <p className="notice" role="status" data-testid="unknown">
          <strong>
            {io.unknown.length === 1
              ? `This file has a counter this page does not know: ${io.unknown[0]}.`
              : `This file has ${io.unknown.length} counters this page does not know: ${io.unknown.join(', ')}.`}
          </strong>{' '}
          A newer kernel has added to <code>task_io_accounting</code> since this page was written.
          The value is shown in the raw view; nothing above accounts for it.
        </p>
      )}

      {io.missing.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="missing">
          <strong>
            {io.missing.length === 1
              ? `This file is missing ${io.missing[0]}.`
              : `This file is missing ${io.missing.length} of the seven counters: ${io.missing.join(', ')}.`}
          </strong>{' '}
          A kernel built without <code>CONFIG_TASK_XACCT</code> keeps the block counters and not the
          syscall ones — but it is likelier that something between here and the kernel dropped a
          line. Anything missing is counted as zero above.
        </p>
      )}

      {!io.ordered && (
        <p className="notice notice--warn" role="status" data-testid="unordered">
          These counters are not in the order the kernel prints them.{' '}
          <code>do_io_accounting</code> writes one <code>seq_printf</code> after another in a fixed
          order, so a file in another order was assembled by something other than the kernel.
        </p>
      )}

      {note}
    </>
  );
}
