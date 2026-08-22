import { describe, expect, it } from 'vitest';
import { readPidStatFixture as fixture } from '../test/fixtures';
import {
  CLOCK_TICK,
  COMM_MAX,
  describeField,
  describePolicy,
  describePriority,
  describeState,
  field,
  FIELD_NAMES,
  formatBytes,
  formatField,
  formatSeconds,
  isCommAwkward,
  isCommTruncated,
  isMaintained,
  num,
  PAGE_SIZE,
  pagesToBytes,
  parsePidStat,
  summarize,
  ticksToSeconds,
} from './pid-stat';

describe('parsePidStat — an ordinary shell', () => {
  const stat = parsePidStat(fixture('desktop', 'self'));

  it('reads all fifty-two fields a current kernel prints', () => {
    expect(stat.fields).toHaveLength(52);
    expect(stat.fields[0]).toEqual({ number: 1, name: 'pid', raw: '4021' });
    expect(stat.fields.at(-1)).toEqual({ number: 52, name: 'exit_code', raw: '0' });
  });

  it('numbers them the way proc(5) does, from one', () => {
    expect(field(stat, 'state')).toBe('S');
    expect(stat.fields.find((entry) => entry.name === 'state')?.number).toBe(3);
    expect(stat.fields.find((entry) => entry.name === 'rss')?.number).toBe(24);
  });

  it('reads the numbers it is asked for', () => {
    expect(num(stat, 'ppid')).toBe(4019);
    expect(num(stat, 'num_threads')).toBe(1);
    expect(num(stat, 'utime')).toBe(12);
  });

  it('returns null for a field this kernel did not print', () => {
    expect(field(parsePidStat(fixture('legacy-2.6', 'self')), 'exit_code')).toBeNull();
    expect(num(parsePidStat(fixture('legacy-2.6', 'self')), 'arg_start')).toBeNull();
  });
});

/**
 * `comm` holds whatever the process called itself, so the line cannot be split
 * on whitespace — the name is what lies between the first `(` and the last `)`.
 */
describe('parsePidStat — the name is not a token', () => {
  it('takes a name with parentheses in it', () => {
    const stat = parsePidStat(fixture('awkward-name', 'self'));

    expect(stat.comm).toBe('(sd-pam)');
    expect(num(stat, 'pid')).toBe(1789);
    expect(field(stat, 'state')).toBe('S');
    expect(num(stat, 'ppid')).toBe(1788);
  });

  it('takes a name with spaces in it', () => {
    const stat = parsePidStat(fixture('awkward-name', '901'));

    expect(stat.comm).toBe('Isolated Web Co');
    expect(stat.fields).toHaveLength(52);
    expect(num(stat, 'num_threads')).toBe(31);
  });

  /**
   * The one that matters: a process may name itself something shaped like the
   * rest of the line. Splitting on whitespace would let it choose what every
   * field after the name appears to say — and it fits inside the fifteen
   * characters the kernel keeps, so this is a name a real process could take.
   */
  it('is not fooled by a name shaped like the rest of the line', () => {
    const stat = parsePidStat(fixture('awkward-name', '5150'));

    expect(stat.comm).toBe('sh) R 1 1 1 0');
    expect(stat.fields).toHaveLength(52);
    // A naive split would have read the state as `R` and the parent as 1.
    expect(field(stat, 'state')).toBe('S');
    expect(num(stat, 'ppid')).toBe(4021);
    expect(num(stat, 'processor')).toBe(2);
  });

  it('says which names would have broken such a parser', () => {
    expect(isCommAwkward(parsePidStat(fixture('awkward-name', 'self')))).toBe(true);
    expect(isCommAwkward(parsePidStat(fixture('awkward-name', '901')))).toBe(true);
    expect(isCommAwkward(parsePidStat(fixture('desktop', 'self')))).toBe(false);
  });

  /** Fifteen characters is the tell; the kernel keeps no flag saying so. */
  it('spots a name at the length the kernel truncates to', () => {
    expect(fixture('awkward-name', '901')).toContain('(Isolated Web Co)');
    expect(isCommTruncated(parsePidStat(fixture('awkward-name', '901')))).toBe(true);
    expect(COMM_MAX).toBe(15);
    expect(isCommTruncated(parsePidStat(fixture('desktop', 'self')))).toBe(false);
  });
});

describe('parsePidStat — the shapes a file can take', () => {
  /** The last eight fields arrived in 3.3 and 3.5. */
  it('reads an older kernel’s forty-four fields without inventing the rest', () => {
    const stat = parsePidStat(fixture('legacy-2.6', 'self'));

    expect(stat.fields).toHaveLength(44);
    expect(stat.fields.at(-1)?.name).toBe('cguest_time');
    expect(field(stat, 'policy')).not.toBeNull();
  });

  it('reads nothing out of a file that is not this one', () => {
    for (const text of ['', 'nonsense', '(bash) S 1', '4021 bash S 1']) {
      expect(parsePidStat(text).fields, text).toEqual([]);
    }
  });

  it('keeps the line as it was read', () => {
    expect(parsePidStat(fixture('desktop', 'self')).raw).toMatch(/^4021 \(bash\) S 4019 /);
  });

  it('names no more fields than it has names for', () => {
    const extra = `${fixture('desktop', 'self').trim()} 99 98 97`;

    expect(parsePidStat(extra).fields).toHaveLength(FIELD_NAMES.length);
  });
});

/**
 * Two units in one line, and neither is named in it: `rss` is pages where
 * `vsize` is bytes, and the times are clock ticks.
 */
describe('the units the file does not name', () => {
  it('reads rss as the pages it is, not the bytes it looks like', () => {
    expect(PAGE_SIZE).toBe(4096);
    expect(pagesToBytes(1568)).toBe(6_422_528);
  });

  it('reads the times as clock ticks', () => {
    expect(CLOCK_TICK).toBe(100);
    expect(ticksToSeconds(4213)).toBe(42.13);
  });

  it('formats a field by what that field counts', () => {
    // Pages to bytes, ticks to seconds, and a raw count left alone.
    expect(formatField('rss', '1568')).toBe('6.1 MiB');
    expect(formatField('vsize', '12345344')).toBe('12 MiB');
    expect(formatField('utime', '4213')).toBe('42.1 s');
    expect(formatField('minflt', '1842913')).toBe('1,842,913');
    expect(formatField('startcode', '94566864601088')).toMatch(/^0x/);
  });

  it('leaves a field with nothing to add alone', () => {
    expect(formatField('state', 'S')).toBeNull();
    expect(formatField('nice', '0')).toBeNull();
    expect(formatField('rss', '0')).toBeNull();
    expect(formatField('minflt', '214')).toBeNull();
  });
});

describe('describeState', () => {
  it('explains every state a fixture is in', () => {
    for (const state of ['S', 'D', 'Z', 'R', 'T', 'I']) {
      expect(describeState(state), state).not.toBeNull();
    }
  });

  /** The state a process cannot be killed out of. */
  it('says what makes D worth noticing', () => {
    expect(describeState('D')).toMatchObject({ name: 'uninterruptible sleep' });
    expect(describeState('D')!.note).toMatch(/cannot be killed/);
  });

  it('has nothing to say about a letter it does not know', () => {
    expect(describeState('Q')).toBeNull();
    expect(describeState(null)).toBeNull();
  });
});

/** `priority` is not the nice value, and means two different things. */
describe('describePriority and describePolicy', () => {
  it('reads an ordinary task’s priority on the kernel’s own scale', () => {
    const stat = parsePidStat(fixture('desktop', 'self'));

    expect(describePriority(stat)).toBe('nice 0 on the kernel’s 0–39 scale');
    expect(describePolicy(stat)).toEqual({ name: 'SCHED_OTHER', realtime: false });
  });

  it('reads a real-time task’s priority as the negated one it is', () => {
    const stat = parsePidStat(fixture('realtime', 'self'));

    expect(num(stat, 'priority')).toBe(-51);
    expect(describePriority(stat)).toBe('real-time priority 50');
    expect(describePolicy(stat)).toEqual({ name: 'SCHED_FIFO', realtime: true });
    expect(num(stat, 'rt_priority')).toBe(50);
  });

  it('has nothing to say where the field is absent', () => {
    expect(describePriority(parsePidStat(''))).toBeNull();
    expect(describePolicy(parsePidStat(''))).toBeNull();
  });
});

describe('the fields nothing maintains', () => {
  it('explains every field a current kernel prints', () => {
    for (const name of FIELD_NAMES) {
      expect(describeField(name).note.length, name).toBeGreaterThan(0);
    }
  });

  it('knows which are printed and kept by nothing', () => {
    expect(isMaintained('nswap')).toBe(false);
    expect(isMaintained('itrealvalue')).toBe(false);
    expect(isMaintained('signal')).toBe(false);
    expect(isMaintained('wchan')).toBe(false);
    expect(isMaintained('utime')).toBe(true);
    expect(isMaintained('rss')).toBe(true);
  });

  it('says why, rather than only that', () => {
    expect(describeField('kstkesp').dead).toMatch(/4\.9/);
    expect(describeField('signal').dead).toMatch(/real-time signals/);
    expect(describeField('nswap').dead).toMatch(/Never maintained/);
  });
});

describe('summarize', () => {
  it('summarizes an ordinary shell', () => {
    const summary = summarize(parsePidStat(fixture('desktop', 'self')));

    expect(summary).toMatchObject({
      pid: 4021,
      comm: 'bash',
      state: 'S',
      ppid: 4019,
      threads: 1,
      nice: 0,
      processor: 3,
      count: 52,
      commTruncated: false,
      commAwkward: false,
    });
    // 12 + 9 ticks, at 100 to the second.
    expect(summary.cpuSeconds).toBeCloseTo(0.21, 5);
    expect(summary.rssBytes).toBe(6_422_528);
  });

  it('summarizes a browser with real CPU behind it', () => {
    const summary = summarize(parsePidStat(fixture('desktop', '12282')));

    expect(summary.threads).toBe(24);
    expect(summary.userSeconds).toBe(42.13);
    expect(summary.systemSeconds).toBe(8.92);
    expect(summary.majorFaults).toBe(1204);
    expect(summary.rssBytes).toBe(pagesToBytes(235_412));
  });

  /** Waiting on the disk, which is what the blkio ticks say. */
  it('shows what a process in uninterruptible sleep is waiting on', () => {
    const summary = summarize(parsePidStat(fixture('desktop', '3117')));

    expect(summary.state).toBe('D');
    expect(summary.blkioSeconds).toBe(44.71);
    expect(summary.systemSeconds).toBeGreaterThan(summary.userSeconds!);
  });

  /** The memory is gone, the accounting is not. */
  it('summarizes a zombie', () => {
    const summary = summarize(parsePidStat(fixture('zombie', '4242')));

    expect(summary).toMatchObject({ state: 'Z', rssBytes: 0, vsizeBytes: 0 });
    expect(summary.cpuSeconds).toBeCloseTo(5.8, 5);
  });

  it('counts the fields nothing maintains', () => {
    const summary = summarize(parsePidStat(fixture('desktop', 'self')));

    expect(summary.dead.map((entry) => entry.name)).toEqual([
      'itrealvalue',
      'kstkesp',
      'kstkeip',
      'signal',
      'blocked',
      'sigignore',
      'sigcatch',
      'wchan',
      'nswap',
      'cnswap',
    ]);
  });

  it('summarizes a line it could not read without inventing anything', () => {
    expect(summarize(parsePidStat('nonsense'))).toMatchObject({
      pid: null,
      comm: null,
      state: null,
      count: 0,
      cpuSeconds: null,
      rssBytes: null,
    });
  });
});

describe('formatting', () => {
  it('gives memory in the binary units it reads best in', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(6_422_528)).toBe('6.1 MiB');
    expect(formatBytes(1_198_034_944)).toBe('1.1 GiB');
  });

  it('gives CPU time in the unit that suits how much there is', () => {
    expect(formatSeconds(0.21)).toBe('0.21 s');
    expect(formatSeconds(42.13)).toBe('42.1 s');
    expect(formatSeconds(3600)).toBe('1.0 h');
  });
});
