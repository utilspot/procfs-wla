import { useMemo } from 'react';
import {
  batteryDead,
  describeField,
  describeSpan,
  driftSeconds,
  fieldsIn,
  hasWildcards,
  isUnknown,
  isYes,
  parseRtc,
  reading,
  valueOf,
  withoutAlarm,
  type Group,
  type Rtc,
  type RtcField,
} from '../lib/driver-rtc';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The heading each group of fields is shown under, and what it is a group of. */
const GROUPS: { group: Group; title: string; blurb: string }[] = [
  {
    group: 'clock',
    title: 'The clock',
    blurb: 'What the chip is showing, read off it as this file was opened.',
  },
  {
    group: 'alarm',
    title: 'The alarm',
    blurb: 'When the clock will raise an interrupt, and whether anything armed it.',
  },
  {
    group: 'irq',
    title: 'Interrupts',
    blurb:
      'What the clock can interrupt on. The underscored keys are the driver reading those bits straight off the chip rather than the RTC layer printing them.',
  },
  {
    group: 'driver',
    title: 'What the driver adds',
    blurb:
      'Printed by the driver behind this clock through ops->proc, so which of these appear depends on the hardware.',
  },
  {
    group: 'other',
    title: 'Not known here',
    blurb: 'Keys this page has no entry for: an out-of-tree driver, or one newer than this table.',
  },
];

function FieldRow({ field }: { field: RtcField }) {
  const description = describeField(field.key);

  return (
    <tr className="rtc__row">
      <td className="rtc__key">{field.key}</td>
      <td className="rtc__value">
        {field.value === '' ? <span className="muted">—</span> : field.value}
        {hasWildcards(field.value) && (
          <span
            className="chip"
            title="The kernel prints * for a field this clock does not compare on"
          >
            any
          </span>
        )}
        {isUnknown(field) && (
          <span className="chip chip--bug" title="No entry for this key on this page">
            not known here
          </span>
        )}
      </td>
      <td className="rtc__what">
        {description ?? <span className="muted">Nothing here knows this key.</span>}
      </td>
    </tr>
  );
}

function FieldGroup({ rtc, group, title, blurb }: { rtc: Rtc } & (typeof GROUPS)[number]) {
  const fields = fieldsIn(rtc, group);
  if (fields.length === 0) return null;

  return (
    <section className="card rtc__group" data-testid={`group-${group}`}>
      <h2 className="rtc__title">{title}</h2>
      <p className="rtc__blurb muted">{blurb}</p>
      <table className="mounts__table rtc__table" aria-label={title}>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Value</th>
            <th scope="col">What it is</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <FieldRow field={field} key={field.key} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The hardware clock, and the comparison the file exists to let you make: this
 * is the clock that runs while the machine is off, so how far it is from now is
 * the drift the next boot would hand the system.
 */
export function DriverRtcView({ content }: { content: string }) {
  const rtc = useMemo(() => parseRtc(content), [content]);
  const clock = useMemo(() => reading(rtc), [rtc]);
  // Read once, as the file was: nothing here ticks, and a page that re-read the
  // browser's clock would drift away from the reading it is being compared to.
  const drift = useMemo(() => driftSeconds(rtc, new Date()), [rtc]);
  const armed = isYes(rtc, 'alarm_IRQ');

  const note = (
    <p className="disks__note muted">
      This is <strong>one</strong> real-time clock, not the machine&rsquo;s clocks:{' '}
      <code>rtc_proc_add_device</code> creates this file for the device named by{' '}
      <code>CONFIG_RTC_HCTOSYS_DEVICE</code> — the clock the kernel set the system time from at
      boot, normally <code>rtc0</code> — so a board with two of them shows one here and a kernel
      built without that option has no file at all. <code>/sys/class/rtc/</code> is where they all
      are. The first block is the RTC layer&rsquo;s, printed by <code>rtc_proc_show</code>; the
      tail is whatever the driver adds through <code>ops-&gt;proc</code>, which on a PC is{' '}
      <code>cmos_procfs</code> — so a key this page has never seen is an ordinary thing to meet.
      Three things read wrong at first glance. The <strong>key can hold spaces</strong>, so the
      separator is the tab and not the blank, and the value holds colons, so splitting on the first
      one turns <code>14:32:07</code> into <code>14</code>. <strong>
        <code>****-**-**</code> is a real value
      </strong>{' '}
      — an RTC that matches only the time of day prints stars for the fields it does not compare,
      one field at a time, so the alarm comes round daily rather than anything having failed. And{' '}
      <strong>
        <code>24hr</code> is printed by the kernel rather than read from the clock
      </strong>
      : the modern core writes <code>yes</code> unconditionally, so <code>no</code> dates the kernel
      to the 2.6-era <code>drivers/char/rtc.c</code> instead of describing the hardware. Reading
      this file talks to the chip over its bus, which is why the value is a snapshot rather than
      something that ticks.
    </p>
  );

  if (rtc.fields.length === 0) {
    return (
      <>
        <p className="notice notice--warn" data-testid="empty">
          No clock fields found in this file. Switch to the raw view to see what the server
          returned.
        </p>
        {note}
      </>
    );
  }

  return (
    <>
      <section className="summary" data-testid="summary">
        <Stat
          label={clock === null ? 'hardware clock' : `hardware clock, ${clock.date}`}
          value={clock?.time ?? '—'}
        />
        <Stat
          label="alarm"
          value={armed === null ? 'none' : armed ? 'armed' : 'off'}
        />
        <Stat label="battery" value={valueOf(rtc, 'batt_status') ?? '—'} />
        <Stat label="fields" value={String(rtc.fields.length)} />
      </section>

      {batteryDead(rtc) && (
        <p className="notice notice--warn" role="status" data-testid="battery">
          <strong>
            <code>batt_status: dead</code> — the chip&rsquo;s validity bit is clear, which means the
            backup battery has failed.
          </strong>{' '}
          The clock does not keep time while the machine is off, so every boot starts from whatever
          the chip powers on to until something sets it. NTP will fix the running system and the
          next cold boot will be wrong again; the battery is a coin cell on the board.
        </p>
      )}

      {drift !== null && (
        <p className="notice" role="status" data-testid="drift">
          <strong>
            {Math.abs(drift) < 60
              ? 'This clock agrees with the one in this browser'
              : `This clock is ${describeSpan(drift)} ${drift > 0 ? 'ahead of' : 'behind'} the one in this browser`}
            , reading it as UTC.
          </strong>{' '}
          Whether the chip holds UTC or the machine&rsquo;s local time is a convention the kernel
          knows nothing about — <code>/etc/adjtime</code> records which, and a machine that also
          boots Windows usually keeps local time here. So a gap of whole hours is more likely to be
          that assumption being wrong than a clock that is wrong, and a gap of seconds is the drift
          the next boot would hand the system.
        </p>
      )}

      {withoutAlarm(rtc) && (
        <p className="notice" role="status" data-testid="no-alarm">
          <strong>This clock has no alarm to read.</strong> The alarm, both its interrupt flags and
          all four interrupt fields come from one <code>rtc_read_alarm</code> in{' '}
          <code>rtc_proc_show</code>, so a device that cannot answer it drops the whole block at
          once rather than showing it empty. Nothing is missing from the file — there is nothing
          there to print.
        </p>
      )}

      {armed === true && (
        <p className="notice" role="status" data-testid="armed">
          <strong>The alarm is armed.</strong> Something set this clock to raise an interrupt at{' '}
          <code>{valueOf(rtc, 'alrm_time')}</code>
          {hasWildcards(valueOf(rtc, 'alrm_date') ?? '') ? (
            <> every day</>
          ) : (
            <>
              {' '}
              on <code>{valueOf(rtc, 'alrm_date')}</code>
            </>
          )}
          , which is how a suspended machine wakes itself — <code>rtcwake</code> and a timer unit
          asking to run while the machine is asleep both end up here.
        </p>
      )}

      {GROUPS.map((group) => (
        <FieldGroup rtc={rtc} key={group.group} {...group} />
      ))}

      {rtc.unread.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unread">
          {rtc.unread.length} line{rtc.unread.length === 1 ? '' : 's'} here{' '}
          {rtc.unread.length === 1 ? 'is' : 'are'} not <code>key</code>, a tab and a value. No
          in-tree driver writes one, so switch to the raw view to see what did.
        </p>
      )}

      {note}
    </>
  );
}
