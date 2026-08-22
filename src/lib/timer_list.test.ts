import { describe, expect, it } from 'vitest';
import { readTimerListFixture as fixture } from '../test/fixtures';
import {
  allTimers,
  cpuStat,
  describeCallback,
  describeClock,
  formatNs,
  hasSlack,
  isNoEvent,
  isSoftBase,
  maskCpus,
  NO_EVENT,
  parseTimerList,
  slackNs,
  summarize,
} from './timer_list';

describe('parseTimerList — an ordinary desktop', () => {
  const list = parseTimerList(fixture('desktop'));

  it('reads the header the rest of the file has to be read against', () => {
    expect(list.version).toBe('v0.9');
    expect(list.clockBases).toBe(8);
    expect(list.nowNs).toBe(4185691206824);
    expect(list.jiffies).toBe(4296014963);
  });

  it('reads a CPU and its clock bases', () => {
    expect(list.cpus).toHaveLength(4);
    expect(list.cpus[0]?.bases).toHaveLength(8);
    expect(list.cpus[0]?.bases[0]).toMatchObject({
      index: 0,
      getTime: 'ktime_get',
      offsetNs: 0,
      resolutionNs: 1,
    });
  });

  it('reads a timer and the callback that will run', () => {
    const timer = list.cpus[0]?.bases[0]?.timers[0];

    expect(timer).toMatchObject({
      index: 0,
      callback: 'tick_sched_timer',
      state: '01',
      inFromNs: 793176,
      inToNs: 793176,
    });
    expect(timer?.address).toBe('ffff9e1a01e20cd80');
  });

  /**
   * The two expiry figures are the earliest the kernel may fire the timer and
   * its deadline; the gap is slack it can spend batching the wakeup.
   */
  it('reads the expiry range as the slack it is', () => {
    const [, sleeping] = list.cpus[0]!.bases[0]!.timers;

    expect(sleeping?.callback).toBe('hrtimer_wakeup');
    expect(sleeping?.inFromNs).toBe(64671900);
    expect(sleeping?.inToNs).toBe(114671900);
    expect(slackNs(sleeping!)).toBe(50000000);
    expect(hasSlack(sleeping!)).toBe(true);
  });

  it('reads a timer with no slack as having none', () => {
    const tick = list.cpus[0]!.bases[0]!.timers[0]!;

    expect(slackNs(tick)).toBe(0);
    expect(hasSlack(tick)).toBe(false);
  });

  /** Eight bases means four clocks, each with a hard and a soft one. */
  it('tells the soft bases from the hard ones', () => {
    const bases = list.cpus[0]!.bases;

    expect(isSoftBase(bases[0]!, list.clockBases)).toBe(false);
    expect(isSoftBase(bases[3]!, list.clockBases)).toBe(false);
    expect(isSoftBase(bases[4]!, list.clockBases)).toBe(true);
    expect(bases[4]?.getTime).toBe(bases[0]?.getTime);
  });

  it('names the clock each base runs on', () => {
    expect(describeClock(list.cpus[0]!.bases[0]!)).toMatch(/CLOCK_MONOTONIC/);
    expect(describeClock(list.cpus[0]!.bases[1]!)).toMatch(/CLOCK_REALTIME/);
    expect(describeClock(list.cpus[0]!.bases[2]!)).toMatch(/CLOCK_BOOTTIME/);
  });

  /** The realtime base's offset is the distance to the wall clock. */
  it('reads a base’s offset from the monotonic clock', () => {
    expect(list.cpus[0]?.bases[1]?.offsetNs).toBe(1723000000000000000);
    expect(list.cpus[0]?.bases[0]?.offsetNs).toBe(0);
  });

  it('reads the per-CPU stat block the bases are followed by', () => {
    const cpu = list.cpus[0]!;

    expect(cpuStat(cpu, 'nr_events')).toBe(1085639);
    expect(cpuStat(cpu, 'nr_hangs')).toBe(0);
    expect(cpuStat(cpu, 'hres_active')).toBe(1);
    expect(cpuStat(cpu, 'tick_stopped')).toBe(0);
    // Printed past the 15-column field, so its colon sits hard against it.
    expect(cpuStat(cpu, 'iowait_sleeptime')).toBe(22705032314);
    expect(cpuStat(cpu, 'nonsense')).toBeNull();
  });

  it('keeps the stat block’s units apart from its counts', () => {
    const stats = list.cpus[0]!.stats;

    expect(stats.find((stat) => stat.name === 'idle_sleeptime')?.unit).toBe('nsecs');
    expect(stats.find((stat) => stat.name === 'nr_events')?.unit).toBeNull();
  });

  it('orders every pending timer by the deadline it is up against', () => {
    const timers = allTimers(list);

    expect(timers).toHaveLength(11);
    expect(timers[0]?.timer.callback).toBe('tick_sched_timer');
    expect(timers[0]?.cpu).toBe(0);
    expect(timers.at(-1)?.timer.callback).toBe('alarmtimer_fired');
  });

  it('summarizes the machine', () => {
    const summary = summarize(list);

    expect(summary).toMatchObject({ cpus: 4, timers: 11, clockBases: 8, withSlack: 2 });
    expect(summary.hresActive).toEqual([0, 1, 2, 3]);
    expect(summary.tickStopped).toEqual([]);
    expect(summary.hangs).toEqual([]);
    expect(summary.next?.timer.callback).toBe('tick_sched_timer');
  });

  it('reads the tick devices, broadcast first', () => {
    expect(list.devices).toHaveLength(5);
    expect(list.devices[0]).toMatchObject({ cpu: null, name: 'hpet', tickMode: 1 });
    expect(list.devices[1]).toMatchObject({ cpu: 0, name: 'lapic-deadline' });
  });

  /**
   * Two `mode` numbers in one block: the tick device's, and further down the
   * clock event device's own state. They are not the same scale.
   */
  it('keeps the tick mode apart from the device’s own state', () => {
    const lapic = list.devices[1]!;

    expect(lapic.tickMode).toBe(1);
    expect(lapic.state).toBe(3);
    expect(lapic.fields.find((field) => field.name === 'event_handler')?.value).toBe(
      'hrtimer_interrupt',
    );
  });

  /** KTIME_MAX is not a time: it means nothing is programmed. */
  it('reads KTIME_MAX as nothing programmed', () => {
    expect(list.devices[0]?.nextEventNs).toBe(NO_EVENT);
    expect(isNoEvent(list.devices[0]?.nextEventNs ?? null)).toBe(true);
    expect(isNoEvent(list.devices[1]?.nextEventNs ?? null)).toBe(false);
  });

  it('reads the broadcast masks as the CPUs they name', () => {
    expect(list.masks.map((mask) => mask.name)).toEqual([
      'tick_broadcast_mask',
      'tick_broadcast_oneshot_mask',
    ]);
    expect(list.masks[0]?.cpus).toEqual([]);
  });
});

describe('parseTimerList — an idle machine in tickless mode', () => {
  const list = parseTimerList(fixture('idle-nohz'));

  it('reads which CPUs have stopped their tick', () => {
    const summary = summarize(list);

    expect(summary.tickStopped).toEqual([0, 1]);
    expect(cpuStat(list.cpus[0]!, 'tick_stopped')).toBe(1);
  });

  /**
   * Deep idle stops the CPU's own timer, so the broadcast device is what wakes
   * it — and the mask is which CPUs are relying on that.
   */
  it('reads the CPUs leaning on the broadcast device', () => {
    const summary = summarize(list);

    expect(summary.broadcastCpus).toEqual([0, 1]);
    expect(summary.broadcast?.name).toBe('hpet');
    expect(isNoEvent(summary.broadcast?.nextEventNs ?? null)).toBe(false);
  });

  it('reads the local timers shut down behind it', () => {
    const lapic = list.devices[1]!;

    expect(lapic.state).toBe(1);
    expect(isNoEvent(lapic.nextEventNs)).toBe(true);
  });
});

describe('parseTimerList — callbacks overrunning', () => {
  const list = parseTimerList(fixture('hung-timers'));

  /**
   * A hang is the interrupt finding its next event already past, because the
   * callbacks it just ran took too long. It is what this file is for.
   */
  it('finds the CPUs whose hrtimer interrupt hung', () => {
    const summary = summarize(list);

    expect(summary.hangs).toEqual([{ cpu: 0, hangs: 417, maxHangNs: 8844221 }]);
    expect(summary.retries).toBe(88434);
  });

  it('leaves the CPU that kept up out of it', () => {
    expect(cpuStat(list.cpus[1]!, 'nr_hangs')).toBe(0);
  });
});

describe('parseTimerList — a kernel from before the soft bases', () => {
  const list = parseTimerList(fixture('legacy-v0.8'));

  it('reads four clock bases rather than eight', () => {
    expect(list.version).toBe('v0.8');
    expect(list.clockBases).toBe(4);
    expect(list.cpus[0]?.bases).toHaveLength(4);
    expect(isSoftBase(list.cpus[0]!.bases[3]!, list.clockBases)).toBe(false);
  });

  it('reads a machine with no high-resolution mode', () => {
    expect(summarize(list).hresActive).toEqual([]);
    expect(cpuStat(list.cpus[0]!, 'nohz_mode')).toBe(1);
  });

  it('reads a tick still running periodically', () => {
    const pit = list.devices[1]!;

    expect(pit.tickMode).toBe(0);
    expect(pit.state).toBe(2);
    expect(pit.fields.find((field) => field.name === 'event_handler')?.value).toBe(
      'tick_handle_periodic',
    );
  });

  /** A machine with no broadcast device prints the block with `<NULL>`. */
  it('reads a tick device with no hardware behind it', () => {
    expect(list.devices[0]).toMatchObject({ cpu: null, name: null, tickMode: 0 });
    expect(summarize(list).broadcast).toBeNull();
  });
});

describe('parseTimerList — read under kptr_restrict', () => {
  const list = parseTimerList(fixture('restricted'));

  it('reads the zeroed pointers without losing the timers', () => {
    const timers = allTimers(list);

    expect(timers).toHaveLength(3);
    expect(timers.every((located) => /^0+$/.test(located.timer.address))).toBe(true);
    expect(timers[0]?.timer.callback).toBe('tick_sched_timer');
  });
});

describe('parseTimerList — the awkward files', () => {
  it('reads an empty file as nothing at all', () => {
    expect(parseTimerList('')).toMatchObject({ version: null, cpus: [], devices: [] });
  });

  it('summarizes an empty file without dividing by it', () => {
    const summary = summarize(parseTimerList(''));

    expect(summary).toMatchObject({ cpus: 0, timers: 0, events: 0, retries: 0 });
    expect(summary.next).toBeNull();
    expect(summary.broadcast).toBeNull();
  });

  it('reads a header with no CPUs under it', () => {
    const list = parseTimerList(
      'Timer List Version: v0.9\nHRTIMER_MAX_CLOCK_BASES: 8\nnow at 12 nsecs\n',
    );

    expect(list.clockBases).toBe(8);
    expect(list.cpus).toEqual([]);
  });

  it('reads CRLF line endings', () => {
    const list = parseTimerList('Timer List Version: v0.9\r\ncpu: 0\r\n clock 0:\r\n');

    expect(list.version).toBe('v0.9');
    expect(list.cpus[0]?.bases).toHaveLength(1);
  });

  /** A timer head with no expiry line under it leaves the fields at zero. */
  it('survives a timer whose expiry line is missing', () => {
    const list = parseTimerList(
      ['cpu: 0', ' clock 0:', 'active timers:', ' #0: <ffff00>, hrtimer_wakeup, S:01'].join('\n'),
    );

    expect(list.cpus[0]?.bases[0]?.timers[0]).toMatchObject({
      callback: 'hrtimer_wakeup',
      inToNs: 0,
    });
  });

  it('has no note for a callback it does not know', () => {
    expect(describeCallback('tick_sched_timer')).toMatch(/scheduler tick/);
    expect(describeCallback('some_module_timer')).toBeNull();
  });
});

describe('maskCpus', () => {
  it('reads a single group of bits as CPU numbers', () => {
    expect(maskCpus('0')).toEqual([]);
    expect(maskCpus('3')).toEqual([0, 1]);
    expect(maskCpus('f')).toEqual([0, 1, 2, 3]);
    expect(maskCpus('80000000')).toEqual([31]);
  });

  /** The kernel prints the most significant group first. */
  it('reads the groups from the right', () => {
    expect(maskCpus('00000001,00000000')).toEqual([32]);
    expect(maskCpus('00000000,00000003')).toEqual([0, 1]);
  });

  it('ignores a mask it cannot read', () => {
    expect(maskCpus('')).toEqual([]);
    expect(maskCpus('zz')).toEqual([]);
  });
});

describe('formatNs', () => {
  it('reads a nanosecond figure at a scale a person can', () => {
    expect(formatNs(0)).toBe('0 ns');
    expect(formatNs(793)).toBe('793 ns');
    expect(formatNs(1500)).toBe('1.5 µs');
    expect(formatNs(793176)).toBe('793 µs');
    expect(formatNs(4118844)).toBe('4.1 ms');
    expect(formatNs(114671900)).toBe('115 ms');
    expect(formatNs(3204118844)).toBe('3.2 s');
    expect(formatNs(45000000000)).toBe('45 s');
    expect(formatNs(812004118844)).toBe('13m 32s');
    expect(formatNs(4185691206824)).toBe('1h 9m');
  });
});
