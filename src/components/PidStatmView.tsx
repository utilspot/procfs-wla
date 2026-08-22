import { useMemo } from 'react';
import {
  formatBytes,
  formatPages,
  formatShare,
  hasNoMm,
  impossible,
  isEmpty,
  isUnreadable,
  PAGE_SIZE,
  parseStatm,
  residentShare,
  sharedShare,
  summarize,
  toBytes,
  unusedNotZero,
  type Statm,
  type StatmCount,
} from '../lib/pid-statm';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** What kind of measurement a column is, which is half of reading this file. */
const KIND: Record<string, string> = {
  virtual: 'address space',
  resident: 'in RAM',
  unused: 'not a measurement',
};

function CountRow({ count, statm }: { count: StatmCount; statm: Statm }) {
  const { field, pages } = count;
  const unused = field.kind === 'unused';
  // Every share is against field 1, which the column header says — it is the
  // only whole the other five are all a part of. A constant has no share.
  const share = unused || statm.size === 0 ? null : pages / statm.size;

  return (
    <tr className={unused ? 'statm__row statm__row--unused' : 'statm__row'}>
      <th scope="row" className="statm__name">
        <span className="statm__col">{field.column}</span>
        <span className="statm__key">{field.name}</span>
        <span className="statm__label muted">{field.label}</span>
      </th>
      <td className="statm__kind">
        <span className={unused ? 'chip muted' : `chip statm__chip--${field.kind}`}>
          {KIND[field.kind]}
        </span>
      </td>
      <td className="statm__value">
        {unused ? (
          <span className="muted">0</span>
        ) : (
          <>
            {formatBytes(toBytes(pages))}
            <span className="statm__pages muted">{formatPages(pages)} pages</span>
          </>
        )}
      </td>
      <td className="statm__share">
        {share === null ? <span className="muted">—</span> : formatShare(share)}
      </td>
      <td className="statm__what muted">
        {field.what}
        {field.status !== undefined && (
          <span className="statm__status">
            <code>{field.status}</code> in <code>status</code>
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Seven numbers, two of which are constants — which is the thing about this
 * file worth saying before anything else.
 */
export function PidStatmView({ content }: { content: string }) {
  const statm = useMemo(() => parseStatm(content), [content]);
  const summary = useMemo(() => summarize(statm), [statm]);
  const broken = useMemo(() => impossible(statm), [statm]);
  const shared = sharedShare(statm);

  const note = (
    <p className="disks__note muted">
      Seven counts on one line, written with <code>seq_put_decimal_ull</code> straight into the
      buffer rather than through <code>seq_printf</code> — the comment above it in{' '}
      <code>fs/proc/array.c</code> says <em>for quick read</em>, and that is what this file is for.{' '}
      <code>/proc/&lt;pid&gt;/smaps</code> walks every mapping and every page table entry to answer
      the same question; this reads seven counters already kept in <code>mm_struct</code>, which is
      why <code>ps</code> and <code>top</code> read it once per process per refresh. Four things
      read wrong. <strong>Fields 5 and 7 are hardcoded zeros</strong> — the kernel prints a constant
      for each and has since Linux 2.6, the counters behind them having been removed while the
      columns stayed so that anything parsing by position kept working, so a reader treating field 5
      as &ldquo;shared library pages&rdquo; is reading a number that is zero on every process on
      every machine. <strong>The units are pages, and the file does not say how big a page is</strong>
      : everything else under <code>/proc</code> reports memory in kB, so the same seven numbers
      mean sixteen times as much on a 64 KiB-page kernel as on a 4 KiB one —{' '}
      <code>AT_PAGESZ</code> in <code>/proc/&lt;pid&gt;/auxv</code> is where the real answer is, and
      this page has assumed <strong>{formatBytes(PAGE_SIZE)}</strong>.{' '}
      <strong>Three of them are address space and two are memory actually resident</strong>:{' '}
      <code>size</code>, <code>text</code> and <code>data</code> say how much is <em>mapped</em>,{' '}
      <code>resident</code> and <code>shared</code> how much is <em>in RAM</em> — so{' '}
      <code>text + data</code> is not part of <code>resident</code>, is not comparable with it, and
      does not add up to <code>size</code> either. And <strong>the number most readers want is not
      a field</strong>: <code>shared</code> is the file-backed and shmem part of the resident set,
      so the anonymous resident set — what this process would have to <em>swap</em> rather than drop
      — is <code>resident - shared</code>, which <code>status</code> calls <code>RssAnon</code> and
      this file leaves you to work out. The file is mode 0444 with no <code>ptrace</code> check,
      unlike <code>io</code> and <code>environ</code> beside it: how much memory a process uses is
      not treated as a secret, where what it read and what it was started with are.
    </p>
  );

  if (isEmpty(statm)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="empty">
          There is nothing in this file. Every process has seven counts here, a kernel thread
          included — it prints zeroes rather than nothing — so an empty file means the backend could
          not read it. Switch to the raw view to see what the server returned.
        </p>
        {note}
      </>
    );
  }

  if (isUnreadable(statm)) {
    return (
      <>
        <p className="notice notice--warn" role="status" data-testid="unreadable">
          This file does not hold a line of numbers. <code>proc_pid_statm</code> prints seven
          unsigned counts separated by spaces and nothing else, so whatever is here came from
          somewhere else — switch to the raw view to see it.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      {broken.length > 0 && (
        <p className="notice notice--error" role="alert" data-testid="impossible">
          <strong>These counts cannot all be true at once:</strong> {broken.join(', ')}. They are
          read off one <code>mm_struct</code>, where the resident set is part of the address space
          and its shared part is part of the resident set — so a file breaking that did not come
          from <code>proc_pid_statm</code>.
        </p>
      )}

      {hasNoMm(statm) && (
        <p className="notice" role="status" data-testid="no-mm">
          <strong>Seven zeroes, which is an answer rather than a gap.</strong>{' '}
          <code>proc_pid_statm</code> starts every count at zero and fills them in only where there
          is an <code>mm</code> — so this is a <strong>kernel thread</strong>, which never has one,
          or a process that has already exited. Note that this is the opposite of what{' '}
          <code>environ</code> and <code>coredump_filter</code> do for the same process: those print
          nothing at all, and this prints zeroes. Which of the two cases it is cannot be told from
          here; <code>/proc/&lt;pid&gt;/stat</code> says.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="mapped" value={formatBytes(summary.size)} />
        <Stat label="resident" value={formatBytes(summary.resident)} />
        <Stat label="anonymous — what would swap" value={formatBytes(summary.anonymous)} />
        <Stat
          label="of the address space resident"
          value={summary.residentShare === null ? '—' : formatShare(summary.residentShare)}
        />
      </section>

      {!hasNoMm(statm) && (
        <p className="notice" role="status" data-testid="anonymous">
          <strong>
            {formatBytes(summary.anonymous)} of this process&rsquo;s resident set is anonymous.
          </strong>{' '}
          That is <code>resident</code> less <code>shared</code>, and it is the figure this file is
          usually opened for: memory with no file behind it, so the kernel cannot drop it under
          pressure and has to <strong>swap</strong> it. The other{' '}
          {formatBytes(summary.shared)}
          {shared === null ? '' : ` — ${formatShare(shared)} of what is resident`} is file-backed or
          shmem and can simply be dropped and read back.
        </p>
      )}

      <div className="card mounts statm">
        <table className="mounts__table statm__table" aria-label="Memory counts">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Measures</th>
              <th scope="col">Value</th>
              <th scope="col" title="Against the mapped address space, which is field 1">
                Of mapped
              </th>
              <th scope="col">What it counts</th>
            </tr>
          </thead>
          <tbody>
            {statm.counts.map((count) => (
              <CountRow key={count.field.name} count={count} statm={statm} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="notice" role="status" data-testid="constants">
        <strong>
          Two of these seven are not measurements of this process at all — fields 5 and 7.
        </strong>{' '}
        The kernel prints a constant <code>0</code> for each, and has since Linux 2.6: the counters
        behind <code>lib</code> and <code>dt</code> were removed and the columns kept so that
        anything parsing this file by position would keep working. They are zero on every process on
        every machine, so a reader that finds meaning in them has found it in a placeholder.
      </p>

      {residentShare(statm) !== null && residentShare(statm)! < 0.1 && !hasNoMm(statm) && (
        <p className="notice" role="status" data-testid="sparse">
          <strong>
            Only {formatShare(residentShare(statm)!)} of what this process has mapped is in RAM.
          </strong>{' '}
          That is the ordinary state of a large address space rather than a problem: a mapping
          costs nothing until it is touched, and a program that reserves a great deal — a heap
          arena, a file mapped whole, thread stacks never grown into — carries the reservation in
          field 1 and nothing in field 2. It is what makes <code>size</code> the weakest measure of
          &ldquo;memory used&rdquo; there is.
        </p>
      )}

      {unusedNotZero(statm).length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unused-set">
          <strong>
            {unusedNotZero(statm)
              .map((count) => `Field ${count.field.column} (${count.field.name})`)
              .join(' and ')}{' '}
            {unusedNotZero(statm).length === 1 ? 'is' : 'are'} not zero, and the kernel always
            writes zero there.
          </strong>{' '}
          Whatever produced this file was not <code>proc_pid_statm</code> — the value is shown above
          as it stands, and it means nothing.
        </p>
      )}

      {!statm.complete && (
        <p className="notice notice--warn" role="status" data-testid="short">
          <strong>
            This line has {statm.counts.length} of the seven counts.
          </strong>{' '}
          The kernel writes all seven every time, two of them constants, so something between here
          and it truncated the line. Anything missing is counted as zero above.
        </p>
      )}

      {statm.extra.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="extra">
          <strong>
            This line has {statm.extra.length} more{' '}
            {statm.extra.length === 1 ? 'number' : 'numbers'} than the seven this file holds.
          </strong>{' '}
          Nothing has been added to <code>proc_pid_statm</code> since the two constants were frozen,
          so the extra is not a newer kernel&rsquo;s field. It is shown in the raw view and counted
          nowhere above.
        </p>
      )}

      {!statm.terminated && (
        <p className="notice notice--warn" role="status" data-testid="unterminated">
          This file does not end with a newline. <code>proc_pid_statm</code> writes one after the
          seventh count, so something in between has been trimming the answer.
        </p>
      )}

      {note}
    </>
  );
}
