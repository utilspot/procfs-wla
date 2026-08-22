import { useMemo } from 'react';
import {
  COMPONENT_DIGITS,
  IOCTL,
  parseSgVersion,
  SG_IO_NOTE,
  summarize,
} from '../lib/scsi-sg-version';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function ScsiSgVersionView({ content }: { content: string }) {
  const version = useMemo(() => parseSgVersion(content), [content]);
  const summary = useMemo(() => (version === null ? null : summarize(version)), [version]);

  if (version === null || summary === null) {
    return (
      <p className="notice notice--warn">
        No version line in this file. It is one line —{' '}
        <code>&quot;%d\t%s [%s]&quot;</code> over the driver&rsquo;s number, its version and its
        date — printed by <code>sg_proc_seq_show_version</code>, so anything else here came from
        somewhere other than the sg driver. Switch to the raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {!summary.agrees && summary.decoded !== null && (
        <p className="notice notice--warn" role="status" data-testid="disagrees">
          <strong>The number and the string disagree.</strong> <code>{summary.number}</code> is{' '}
          <code>{summary.decoded}</code> read {COMPONENT_DIGITS} digits to a component, and the
          string beside it says <code>{summary.version}</code>. A stock kernel declares the two
          together, so one of them has been patched — and <code>{summary.number}</code> is the one
          to believe, since <code>{IOCTL}</code> hands a program that and nothing else.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat
          label="version"
          value={summary.version ?? '—'}
          title="SG_VERSION_STR, the version as the driver writes it for a reader"
        />
        <Stat
          label="number"
          value={summary.number === null ? '—' : String(summary.number)}
          title={`sg_version_num — the same version packed ${COMPONENT_DIGITS} digits to a component, which is what ${IOCTL} returns`}
        />
        <Stat
          label="which reads"
          value={summary.decoded ?? '—'}
          title="The number unpacked, which in a stock kernel is the string beside it again"
        />
        <Stat
          label="driver dated"
          value={summary.dated ?? summary.date ?? '—'}
          title="sg_version_date — when the driver last changed its own version, hard-coded beside the string"
        />
      </section>

      <p className="notice" role="status" data-testid="two-forms">
        <strong>The first two fields are the same fact twice.</strong> The driver declares{' '}
        <code>sg_version_num</code> as {COMPONENT_DIGITS} digits for each component, so{' '}
        <code>{summary.number}</code> is{' '}
        {summary.components === null ? (
          summary.decoded
        ) : (
          <>
            <strong>{summary.components.major}</strong>
            {' · '}
            <strong>{String(summary.components.minor).padStart(COMPONENT_DIGITS, '0')}</strong>
            {' · '}
            <strong>{String(summary.components.patch).padStart(COMPONENT_DIGITS, '0')}</strong>
          </>
        )}{' '}
        — the version beside it, written as one integer. That is the field a{' '}
        <strong>program</strong> reads: <code>{IOCTL}</code> hands back the same number, so a tool
        needing something added in 3.5.30 compares against <code>30530</code> rather than picking a
        string apart. The string is for whoever reads this file.
      </p>

      <p className="notice" role="status" data-testid="driver-date">
        <strong>The date is the driver&rsquo;s, not the kernel&rsquo;s.</strong>{' '}
        <code>sg_version_date</code> is hard-coded in <code>drivers/scsi/sg.c</code> beside the
        version and says when <em>that file</em> last changed its own number — so a kernel released
        long afterwards still prints{' '}
        <strong>{summary.dated ?? summary.date ?? 'whatever is in the brackets'}</strong>, and this
        line dates the interface rather than the machine, the build or the running kernel.
      </p>

      <p className="disks__note muted">
        This is the <strong>generic SCSI driver</strong> saying what it is: the one that gives every
        device the midlayer attached a <code>/dev/sg*</code> node, so a program can send it a
        command directly rather than through a disk or a tape driver. The devices it does that for
        are the ones <code>/proc/scsi/scsi</code> lists, and{' '}
        <code>/proc/scsi/sg/devices</code> beside this file is the same list in the driver&rsquo;s
        own numbers. {SG_IO_NOTE} — which is why the number here has stood still for years and why
        a date from another decade is the ordinary answer rather than a sign of anything. The file
        exists wherever the driver does, <code>CONFIG_CHR_DEV_SG</code>, built in or loaded; a
        machine with the SCSI midlayer and no sg has a <code>/proc/scsi</code> with no{' '}
        <code>sg</code> in it, and this page 404s there.
      </p>
    </>
  );
}
