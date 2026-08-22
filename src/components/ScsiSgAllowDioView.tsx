import { useMemo } from 'react';
import {
  DEFAULT,
  INFO_MASK,
  INFO_VALUES,
  MODULE_PARAM,
  parseAllowDio,
  REQUEST_FLAG,
  summarize,
} from '../lib/scsi-sg-allow-dio';

export function ScsiSgAllowDioView({ content }: { content: string }) {
  const dio = useMemo(() => parseAllowDio(content), [content]);
  const summary = useMemo(() => (dio === null ? null : summarize(dio)), [dio]);

  if (dio === null || summary === null) {
    return (
      <p className="notice notice--warn">
        No number in this file. It holds <code>sg_allow_dio</code> and nothing else — one integer,
        and the write path stores anything not zero as <code>1</code>, so it can only ever print{' '}
        <code>0</code> or <code>1</code>. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.unexpected && (
        <p className="notice notice--warn" role="status" data-testid="unexpected">
          <strong>This is not a number the write path could have stored.</strong> A write here is
          normalised — anything not zero becomes <code>1</code> — so a{' '}
          <code>{summary.value}</code> came from somewhere else: the module parameter on a driver
          that did not normalise it, or a kernel other than the one this app knows. It reads as
          permitted, since the driver tests it for zero rather than for one.
        </p>
      )}

      <p
        className={summary.allowed ? 'notice' : 'notice notice--warn'}
        role="status"
        data-testid="state"
      >
        {summary.allowed ? (
          <>
            <strong>Direct I/O is permitted — and that is only half of it.</strong> A transfer goes
            into a program&rsquo;s own pages when the program asks, by setting{' '}
            <code>{REQUEST_FLAG}</code> on the request, <em>and</em> this file allows it. Permission
            alone moves nothing: a request that does not ask is copied through the
            descriptor&rsquo;s reserved buffer as usual.
          </>
        ) : (
          <>
            <strong>Direct I/O is refused, and nothing is told so.</strong> A request that sets{' '}
            <code>{REQUEST_FLAG}</code> still runs — it is copied through the descriptor&rsquo;s
            reserved buffer instead, and no error comes back for having asked. This is{' '}
            {summary.isDefault ? 'the default' : 'switched off'}, and it is the usual reason{' '}
            <code>/proc/scsi/sg/debug</code> never shows <code>dio&gt;&gt;</code> beside a request.
          </>
        )}
      </p>

      <div className="card sgdio">
        <table className="cpu-card__fields sgdio__fields" aria-label="The value and where it comes from">
          <tbody>
            <tr>
              <th scope="row" title="sg_allow_dio, as the file prints it">
                allow_dio
              </th>
              <td>
                <span className="sgdio__value">{summary.value}</span>
                <span className="muted">
                  {' '}
                  — {summary.allowed ? 'permitted' : 'refused'}
                  {summary.isDefault ? ', which is the value the driver starts with' : ''}
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="SG_ALLOW_DIO_DEF, the value a driver nothing has been said to uses">
                compiled default
              </th>
              <td>
                <span className="sgdio__value">{DEFAULT}</span>
                <span className="muted"> — off, on every kernel this app knows</span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="Taken when the driver is loaded">
                module parameter
              </th>
              <td>
                <span className="sgdio__value">
                  <code>{MODULE_PARAM}</code>
                </span>
                <span className="muted"> — set at load, and not normalised the way a write is</span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="This file, which is writable">
                this file
              </th>
              <td>
                <span className="sgdio__value">
                  <code>echo 1 &gt; /proc/scsi/sg/allow_dio</code>
                </span>
                <span className="muted">
                  {' '}
                  — taken from a process holding both <code>CAP_SYS_ADMIN</code> and{' '}
                  <code>CAP_SYS_RAWIO</code>, and stored as 0 or 1 whatever is written
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row" title="What a program sets on the request itself">
                per request
              </th>
              <td>
                <span className="sgdio__value">
                  <code>{REQUEST_FLAG}</code>
                </span>
                <span className="muted">
                  {' '}
                  — the other half: this file permits, the request asks, and both are needed
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* What came back afterwards is the only honest answer to "did it happen",
          and it is the same bit the debug page reads. */}
      <section className="card sgdio-answers" aria-label="What the info field says afterwards">
        <h2 className="sgdio-answers__title">
          And what actually happened comes back in <code>{INFO_MASK}</code>
        </h2>

        <table className="sgdio-answers__table">
          <tbody>
            {INFO_VALUES.map((info) => (
              <tr key={info.value}>
                <th scope="row">
                  <span className="sgdio__value">
                    0x{info.value.toString(16)}
                  </span>
                  <span className="sgdio-answers__name">{info.name}</span>
                </th>
                <td>{info.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="disks__note muted">
        One number, and it is a <strong>gate rather than a switch</strong>: direct I/O is asked for
        per request — a program sets <code>{REQUEST_FLAG}</code> on the command — and only if this
        file is 1 does the driver put the transfer into that program&rsquo;s own pages instead of
        copying it through the descriptor&rsquo;s reserved buffer. Neither half is enough alone, and{' '}
        <strong>neither half fails loudly</strong>: with this at 0 a request that asks still runs,
        the ordinary way, and nothing says no. That is why the answer is worth reading{' '}
        <em>afterwards</em>, out of the <code>info</code> field — which is the same bit{' '}
        <code>/proc/scsi/sg/debug</code> reads when it prints <code>dio&gt;&gt;</code> beside a
        request, so a machine where that prefix never appears is usually this file at its default.
        The default is {DEFAULT}, and the other ways to move it are the module parameter and a write
        here, which wants both <code>CAP_SYS_ADMIN</code> and <code>CAP_SYS_RAWIO</code> and stores
        0 or 1 whatever it is given. And it is a <em>driver-wide</em> setting where{' '}
        <code>def_reserved_size</code> beside it is a default taken at open: changing this one
        changes what every descriptor may do next, including those already open.
      </p>
    </>
  );
}
