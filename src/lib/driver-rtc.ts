/**
 * Parser for `/proc/driver/rtc` — the hardware clock, read from the device as
 * the file is opened.
 *
 * A flat list of `key`, a run of tabs, `: `, and a value:
 *
 *   rtc_time	: 14:32:07
 *   rtc_date	: 2026-03-15
 *   alrm_time	: 06:30:00
 *   alrm_date	: ****-**-**
 *   alarm_IRQ	: no
 *   24hr		: yes
 *
 * `rtc_proc_show` in `drivers/rtc/proc.c` prints the first block; a driver may
 * then add lines of its own through `ops->proc`, which on a PC is
 * `cmos_procfs` in `drivers/rtc/rtc-cmos.c` printing `BCD`, `batt_status` and
 * the rest. So the *shape* is the kernel's and the tail is the driver's, and a
 * key this file has never seen before is an ordinary thing to meet.
 *
 * Four things read wrong at first glance.
 *
 * **It is one RTC, not the RTCs.** `rtc_proc_add_device` creates this file for
 * a single device: the one named by `CONFIG_RTC_HCTOSYS_DEVICE`, which is the
 * clock the kernel set the system time from at boot, normally `rtc0`. A
 * machine with two of them shows one here, and a kernel built without that
 * option has no file at all. `/sys/class/rtc/` is where they all are.
 *
 * **The key can hold spaces**, so the separator is the tab run and not the
 * blank: `update IRQ enabled`, `periodic IRQ frequency` and `max user IRQ
 * frequency` are three keys, not eleven words. And the *value* can hold
 * colons — `rtc_time` is `14:32:07` — so splitting on the first colon gets
 * `14`. Only {@link SEPARATOR} reads this file correctly.
 *
 * **`****-**-**` is a real value.** An RTC that can only match an alarm on the
 * time of day prints wildcards for the fields it does not compare, one field at
 * a time, so a date can come back `2026-**-**` as easily as all stars. It means
 * the alarm fires every day at that time, not that anything failed.
 *
 * **`24hr` is printed by the kernel and not by the clock.** The modern core
 * writes `yes` unconditionally; only the 2.6-era `drivers/char/rtc.c` read it
 * off the control register, so `no` here dates the kernel rather than
 * describing the hardware.
 *
 * What the file is really for is the **difference between this clock and the
 * system one**: this is the clock that runs while the machine is off, and it is
 * the one that will be wrong after a flat battery. Whether it holds UTC or
 * local time is a userspace convention the kernel knows nothing about — see
 * {@link readAsUtc}.
 */

/** `key`, a run of tabs, then `: ` — the value taking the rest of the line. */
export const SEPARATOR = /^(.+?)\t+:[ \t]?(.*)$/;

export interface RtcField {
  /** The key exactly as the kernel prints it, spaces and all. */
  key: string;
  /** Everything after the tabs and the colon, which may hold colons itself. */
  value: string;
}

export interface Rtc {
  /** Every field, in the order the file gives them. */
  fields: RtcField[];
  /**
   * Lines that are not `key<tabs>: value`. No in-tree driver writes one, so
   * this is where an out-of-tree `ops->proc` would show up rather than being
   * quietly dropped.
   */
  unread: string[];
}

export function parseRtc(text: string): Rtc {
  const fields: RtcField[] = [];
  const unread: string[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    const match = SEPARATOR.exec(line);
    if (match === null) {
      unread.push(line);
      continue;
    }

    const [, key, value] = match;
    fields.push({ key: key!.trim(), value: value!.trim() });
  }

  return { fields, unread };
}

/** The value under this key, or null where the file has no such line. */
export function valueOf(rtc: Rtc, key: string): string | null {
  return rtc.fields.find((field) => field.key === key)?.value ?? null;
}

/** Whether a `yes`/`no` field is on. Null for a key the file does not hold. */
export function isYes(rtc: Rtc, key: string): boolean | null {
  const value = valueOf(rtc, key);
  return value === null ? null : value === 'yes';
}

/** The groups this page lays the fields out in, in the order it shows them. */
export type Group = 'clock' | 'alarm' | 'irq' | 'driver' | 'other';

interface KnownField {
  group: Group;
  description: string;
}

/**
 * What each key means, keyed by the exact spelling the kernel prints.
 *
 * Both spellings of the interrupt fields are in here on purpose. The core
 * prints `periodic IRQ enabled`; `cmos_procfs` then prints `periodic_IRQ` for
 * the same bit, so a PC shows the pair — one from the RTC layer and one read
 * straight back off the chip. Neither is a duplicate of the other's key.
 */
const KNOWN: Record<string, KnownField> = {
  rtc_time: {
    group: 'clock',
    description:
      'the time of day the hardware clock is showing, read off the device as this file was opened rather than taken from the system clock',
  },
  rtc_date: {
    group: 'clock',
    description: 'the date it is showing, on the same reading',
  },
  rtc_epoch: {
    group: 'clock',
    description:
      'the year the clock counts its two-digit year from, printed by 2.6-era kernels only — 1900 everywhere except a few Alpha machines',
  },
  '24hr': {
    group: 'clock',
    description:
      'printed by the kernel rather than read from the clock: the modern core writes yes unconditionally, so no here means a 2.6-era driver reading the control register',
  },
  alrm_time: {
    group: 'alarm',
    description: 'the time of day the alarm is set for, with ** for a field the clock cannot match on',
  },
  alrm_date: {
    group: 'alarm',
    description:
      'the date it is set for — ****-**-** meaning an RTC that matches only the time of day, so the alarm comes round every day',
  },
  alarm: {
    group: 'alarm',
    description: 'the 2.6-era spelling of the two fields above, as one time of day',
  },
  alarm_IRQ: {
    group: 'alarm',
    description: 'whether the alarm is armed — what a suspend-to-wake tool sets to bring the machine back up',
  },
  alrm_pending: {
    group: 'alarm',
    description: 'whether it has already fired and nothing has read the event yet',
  },
  'update IRQ enabled': {
    group: 'irq',
    description: 'the once-a-second interrupt the clock can raise as its seconds tick over',
  },
  'periodic IRQ enabled': {
    group: 'irq',
    description:
      'the free-running interrupt at the frequency below, which is what /dev/rtc was used for before hrtimers and timerfd',
  },
  'periodic IRQ frequency': {
    group: 'irq',
    description: 'how often that interrupt would fire, in Hz — a power of two, 1024 by default',
  },
  'max user IRQ frequency': {
    group: 'irq',
    description:
      'the ceiling above which asking for that interrupt needs CAP_SYS_RESOURCE, 64 Hz by default, because a fast periodic interrupt is a way to load the machine',
  },
  periodic_IRQ: {
    group: 'irq',
    description:
      'the periodic interrupt bit, read off the chip by the driver rather than from the RTC layer — which is why a modern kernel shows it twice under two spellings',
  },
  update_IRQ: {
    group: 'irq',
    description: 'the update interrupt bit, read off the chip the same way',
  },
  periodic_freq: {
    group: 'irq',
    description: 'the frequency, read off the chip the same way',
  },
  BCD: {
    group: 'driver',
    description:
      'whether the chip keeps its digits in binary-coded decimal, which the PC clock has done since 1984 — the driver converts either way',
  },
  DST_enable: {
    group: 'driver',
    description:
      'the chip’s own daylight-saving adjustment, which Linux never uses: no is the answer on a machine that is behaving',
  },
  square_wave: {
    group: 'driver',
    description: 'the square-wave output pin, ignored by most current hardware',
  },
  HPET_emulated: {
    group: 'driver',
    description:
      'whether the high precision event timer is standing in for the clock’s interrupts, which is how a modern PC serves them',
  },
  batt_status: {
    group: 'driver',
    description:
      'the chip’s validity bit: dead means the backup battery has failed and the clock lost the time while the machine was off',
  },
};

/** Which part of the page a key belongs under, `other` for one not known here. */
export function groupOf(key: string): Group {
  return KNOWN[key]?.group ?? 'other';
}

/** What this key means, or null for one this page has no entry for. */
export function describeField(key: string): string | null {
  return KNOWN[key]?.description ?? null;
}

/** A field under a key this page does not know: an out-of-tree driver, or a newer one. */
export function isUnknown(field: RtcField): boolean {
  return KNOWN[field.key] === undefined;
}

/** The fields of one group, in file order. */
export function fieldsIn(rtc: Rtc, group: Group): RtcField[] {
  return rtc.fields.filter((field) => groupOf(field.key) === group);
}

/** Whether a value holds the `*` the kernel prints for a field it cannot fill. */
export function hasWildcards(value: string): boolean {
  return value.includes('*');
}

/** Whether the chip says its backup battery has failed. */
export function batteryDead(rtc: Rtc): boolean {
  return valueOf(rtc, 'batt_status') === 'dead';
}

/**
 * Whether the alarm read failed, i.e. the file holds a clock and nothing else.
 *
 * `rtc_proc_show` prints the alarm and every interrupt field from one
 * `rtc_read_alarm`, so a device with no alarm to read drops all six at once
 * rather than showing them empty.
 */
export function withoutAlarm(rtc: Rtc): boolean {
  return rtc.fields.length > 0 && fieldsIn(rtc, 'alarm').length === 0;
}

/** `2026-03-15` and `14:32:07`, where the file gave both and neither is starred. */
export function reading(rtc: Rtc): { date: string; time: string } | null {
  const date = valueOf(rtc, 'rtc_date');
  const time = valueOf(rtc, 'rtc_time');
  if (date === null || time === null || hasWildcards(date) || hasWildcards(time)) return null;

  return { date, time };
}

/**
 * The reading as an instant, **taken to be UTC** — which is a guess this file
 * cannot settle.
 *
 * The kernel reads the chip's digits and prints them. Whether they mean UTC or
 * the machine's local time is a userspace convention: `/etc/adjtime` records
 * which, `hwclock` obeys it, and a machine that dual-boots Windows usually
 * keeps local time here. So UTC is the assumption Linux itself ships with
 * rather than a fact about the clock, and anything derived from it is off by
 * the machine's offset where the assumption is wrong.
 */
export function readAsUtc(rtc: Rtc): Date | null {
  const parts = reading(rtc);
  if (parts === null) return null;

  const stamp = Date.parse(`${parts.date}T${parts.time}Z`);
  return Number.isNaN(stamp) ? null : new Date(stamp);
}

/**
 * How far the clock is from `now`, in seconds, positive meaning the hardware
 * clock is ahead. Null where there is no reading to compare.
 *
 * The comparison is the reason to open this file: this clock is what runs while
 * the machine is off, so a gap is the drift a boot would hand the system — or,
 * where the gap is hours, the sign that {@link readAsUtc}'s assumption is wrong
 * and the chip is keeping local time.
 */
export function driftSeconds(rtc: Rtc, now: Date): number | null {
  const clock = readAsUtc(rtc);
  return clock === null ? null : Math.round((clock.getTime() - now.getTime()) / 1000);
}

/** A span of seconds as the largest unit that says something: `4 minutes`, `3 days`. */
export function describeSpan(seconds: number): string {
  const size = Math.abs(seconds);
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];

  for (const [span, name] of units) {
    if (size >= span) {
      const count = Math.floor(size / span);
      return `${count} ${name}${count === 1 ? '' : 's'}`;
    }
  }

  return 'less than a second';
}
