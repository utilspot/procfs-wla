import { describe, expect, it } from 'vitest';
import { readDriverRtcFixture as fixture } from '../test/fixtures';
import {
  batteryDead,
  describeField,
  describeSpan,
  driftSeconds,
  fieldsIn,
  groupOf,
  hasWildcards,
  isUnknown,
  isYes,
  parseRtc,
  readAsUtc,
  reading,
  valueOf,
  withoutAlarm,
} from './driver-rtc';

describe('parseRtc — an ordinary PC', () => {
  const rtc = parseRtc(fixture('desktop'));

  it('reads the clock', () => {
    expect(valueOf(rtc, 'rtc_time')).toBe('14:32:07');
    expect(valueOf(rtc, 'rtc_date')).toBe('2026-03-15');
    expect(reading(rtc)).toEqual({ date: '2026-03-15', time: '14:32:07' });
  });

  /**
   * The separator is the tab run, not the blank: three of these keys hold
   * spaces, and the values hold colons.
   */
  it('reads a key with spaces in it', () => {
    expect(valueOf(rtc, 'periodic IRQ frequency')).toBe('1024');
    expect(valueOf(rtc, 'max user IRQ frequency')).toBe('64');
    expect(valueOf(rtc, 'update IRQ enabled')).toBe('no');
  });

  it('keeps a value that holds colons whole', () => {
    // Splitting on the first colon would leave `14` here.
    expect(valueOf(rtc, 'rtc_time')).toBe('14:32:07');
    expect(valueOf(rtc, 'alrm_time')).toBe('00:00:00');
  });

  it('reads a key written with two tabs', () => {
    expect(valueOf(rtc, '24hr')).toBe('yes');
    expect(valueOf(rtc, 'BCD')).toBe('yes');
  });

  it('reads every field and nothing it could not', () => {
    expect(rtc.fields).toHaveLength(18);
    expect(rtc.unread).toEqual([]);
  });

  it('puts each field under the part of the clock it belongs to', () => {
    expect(fieldsIn(rtc, 'clock').map((field) => field.key)).toEqual([
      'rtc_time',
      'rtc_date',
      '24hr',
    ]);
    expect(fieldsIn(rtc, 'alarm').map((field) => field.key)).toEqual([
      'alrm_time',
      'alrm_date',
      'alarm_IRQ',
      'alrm_pending',
    ]);
    expect(fieldsIn(rtc, 'driver').map((field) => field.key)).toEqual([
      'HPET_emulated',
      'BCD',
      'DST_enable',
      'batt_status',
    ]);
    expect(fieldsIn(rtc, 'other')).toEqual([]);
  });

  /** One from the RTC layer, one read back off the chip — not a duplicate key. */
  it('keeps both spellings of the interrupt fields', () => {
    expect(valueOf(rtc, 'periodic IRQ enabled')).toBe('no');
    expect(valueOf(rtc, 'periodic_IRQ')).toBe('no');
    expect(groupOf('periodic IRQ enabled')).toBe('irq');
    expect(groupOf('periodic_IRQ')).toBe('irq');
    expect(describeField('periodic_IRQ')).toMatch(/read off the chip by the driver/);
  });

  it('finds an idle alarm and a live battery', () => {
    expect(isYes(rtc, 'alarm_IRQ')).toBe(false);
    expect(batteryDead(rtc)).toBe(false);
    expect(withoutAlarm(rtc)).toBe(false);
  });

  /** An RTC that matches only the time of day stars the fields it ignores. */
  it('reads the wildcards in an alarm date as a value', () => {
    expect(valueOf(rtc, 'alrm_date')).toBe('****-**-**');
    expect(hasWildcards('****-**-**')).toBe(true);
    expect(hasWildcards('2026-03-16')).toBe(false);
    // Not a reading, so nothing is derived from it.
    expect(reading(parseRtc('rtc_date\t: ****-**-**\nrtc_time\t: 14:32:07\n'))).toBeNull();
  });
});

describe('parseRtc — the other machines', () => {
  it('reads an alarm armed for a real date', () => {
    const rtc = parseRtc(fixture('alarm-set'));

    expect(isYes(rtc, 'alarm_IRQ')).toBe(true);
    expect(valueOf(rtc, 'alrm_time')).toBe('06:30:00');
    expect(valueOf(rtc, 'alrm_date')).toBe('2026-03-16');
    expect(hasWildcards(valueOf(rtc, 'alrm_date')!)).toBe(false);
  });

  it('reads a failed backup battery', () => {
    const rtc = parseRtc(fixture('dead-battery'));

    expect(batteryDead(rtc)).toBe(true);
    // And the date a chip that lost the time powers back on to.
    expect(valueOf(rtc, 'rtc_date')).toBe('2000-01-01');
  });

  /** The 2.6-era driver: one alarm line, an epoch, and a square wave. */
  it('reads the older format', () => {
    const rtc = parseRtc(fixture('legacy-2.6'));

    expect(valueOf(rtc, 'rtc_epoch')).toBe('1900');
    expect(valueOf(rtc, 'alarm')).toBe('**:30:00');
    expect(valueOf(rtc, 'square_wave')).toBe('no');
    expect(rtc.unread).toEqual([]);
    // None of the modern core's spellings are in it.
    expect(valueOf(rtc, 'alrm_time')).toBeNull();
    expect(valueOf(rtc, 'max user IRQ frequency')).toBeNull();
  });

  /**
   * The alarm and all four interrupt fields come from one `rtc_read_alarm`, so
   * a device that cannot answer it drops the block rather than showing it empty.
   */
  it('reads a clock with no alarm block at all', () => {
    const rtc = parseRtc(fixture('no-alarm'));

    expect(rtc.fields.map((field) => field.key)).toEqual(['rtc_time', 'rtc_date', '24hr']);
    expect(withoutAlarm(rtc)).toBe(true);
    expect(fieldsIn(rtc, 'irq')).toEqual([]);
  });
});

describe('parseRtc — lines the fixtures do not hold', () => {
  it('keeps a key no table here knows', () => {
    const rtc = parseRtc('rtc_time\t: 14:32:07\nvendor_trim\t: 0x1f\n');

    expect(valueOf(rtc, 'vendor_trim')).toBe('0x1f');
    expect(groupOf('vendor_trim')).toBe('other');
    expect(describeField('vendor_trim')).toBeNull();
    expect(rtc.fields.filter(isUnknown).map((field) => field.key)).toEqual(['vendor_trim']);
  });

  it('sets aside a line that is not key, tab and value', () => {
    const rtc = parseRtc('rtc_time\t: 14:32:07\nnot a field at all\n');

    expect(rtc.fields).toHaveLength(1);
    expect(rtc.unread).toEqual(['not a field at all']);
  });

  it('reads an empty value without dropping the key', () => {
    expect(valueOf(parseRtc('batt_status\t: \n'), 'batt_status')).toBe('');
  });

  it('has nothing to say about an empty file', () => {
    const rtc = parseRtc('');

    expect(rtc.fields).toEqual([]);
    expect(withoutAlarm(rtc)).toBe(false);
    expect(reading(rtc)).toBeNull();
  });
});

describe('readAsUtc and driftSeconds', () => {
  const rtc = parseRtc(fixture('desktop'));

  it('reads the two fields as one instant', () => {
    expect(readAsUtc(rtc)?.toISOString()).toBe('2026-03-15T14:32:07.000Z');
  });

  it('measures the gap from a given moment, ahead positive', () => {
    expect(driftSeconds(rtc, new Date('2026-03-15T14:32:00Z'))).toBe(7);
    expect(driftSeconds(rtc, new Date('2026-03-15T14:35:07Z'))).toBe(-180);
    expect(driftSeconds(rtc, new Date('2026-03-15T14:32:07Z'))).toBe(0);
  });

  it('has no gap to give without a reading', () => {
    expect(driftSeconds(parseRtc('24hr\t\t: yes\n'), new Date())).toBeNull();
    expect(readAsUtc(parseRtc('rtc_date\t: not-a-date\nrtc_time\t: 14:32:07\n'))).toBeNull();
  });
});

describe('describeSpan', () => {
  it('names the largest unit that says something', () => {
    expect(describeSpan(7)).toBe('7 seconds');
    expect(describeSpan(1)).toBe('1 second');
    expect(describeSpan(-180)).toBe('3 minutes');
    expect(describeSpan(7200)).toBe('2 hours');
    expect(describeSpan(90000)).toBe('1 day');
    expect(describeSpan(0)).toBe('less than a second');
  });
});
