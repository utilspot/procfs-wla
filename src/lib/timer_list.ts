/**
 * Parser for `/proc/timer_list`.
 *
 * The pending hrtimers on every CPU, the clock bases they hang off and the
 * hardware that will wake the machine to run them:
 *
 *   Timer List Version: v0.9
 *   HRTIMER_MAX_CLOCK_BASES: 8
 *   now at 4185691206824 nsecs
 *
 *   cpu: 0
 *    clock 0:
 *     .base:       ffff9e1a01e20cd80
 *     .index:      0
 *     .resolution: 1 nsecs
 *     .get_time:   ktime_get
 *     .offset:     0 nsecs
 *   active timers:
 *    #0: <ffff9e1a01e20cd80>, tick_sched_timer, S:01
 *    # expires at 4185692000000-4185692000000 nsecs [in 793176 to 793176 nsecs]
 *   …
 *     .nr_hangs      : 0
 *   jiffies: 4296014963
 *
 *   Tick Device: mode:     1
 *   Per CPU device: 0
 *   Clock Event Device: lapic-deadline
 *    mode:           3
 *    next_event:     4185692000000 nsecs
 *
 * Four things in here are not what they look like:
 *
 * - A timer's expiry is printed as **a range**, `soft-hard`. The gap is the
 *   timer's slack: the kernel may fire it anywhere in that window, so it can
 *   batch the wakeup with another one and leave the CPU asleep longer. See
 *   {@link slackNs}.
 * - **`mode` means two different things** within one tick device block. The
 *   `Tick Device: mode:` line is how the tick runs — {@link TICK_MODES},
 *   periodic or oneshot. The indented `mode:` further down is the clock event
 *   device's own state — {@link CLOCK_EVENT_STATES}, shut down, periodic,
 *   oneshot. Reading one as the other gets the machine backwards.
 * - **`next_event: 9223372036854775807`** is `KTIME_MAX`, which is not a time:
 *   it means nothing is programmed on that device at all. See {@link NO_EVENT}.
 * - With eight clock bases the **second four are the soft ones** — same
 *   clocks, but their timers run in the `HRTIMER` softirq rather than in hard
 *   interrupt context. A kernel from before 4.16 prints four. See
 *   {@link isSoftBase}.
 *
 * Absolute nanoseconds go past `Number.MAX_SAFE_INTEGER` at about 104 days of
 * uptime, so the countdowns here are the deltas the kernel printed rather than
 * a subtraction from `now` — those stay small whatever the uptime. The
 * absolute figures are kept as numbers for display, where a few hundred
 * nanoseconds of float error against a figure that large does not show.
 *
 * The file is root-only, and prints kernel pointers with `%pK`, so under
 * `kptr_restrict` every address arrives as zeroes and the callback names are
 * all there is to go on.
 */

/** What a `Tick Device: mode:` line means. */
export const TICK_MODES: Readonly<Record<number, string>> = {
  0: 'Periodic — the tick fires at a fixed rate whether or not there is anything to do',
  1: 'Oneshot — each tick is programmed for when it is next needed, which is what lets it stop',
};

/** What the indented `mode:` inside a clock event device block means. */
export const CLOCK_EVENT_STATES: Readonly<Record<number, string>> = {
  0: 'Detached — not in use by the tick layer',
  1: 'Shut down — programmed for nothing, which is where a CPU in deep idle leaves it',
  2: 'Periodic — firing at a fixed rate',
  3: 'Oneshot — programmed for a single event, then reprogrammed',
  4: 'Oneshot stopped — armed for oneshot, with nothing pending',
};

/** The clock each base runs on, read from the function that reads it. */
export const CLOCKS: Readonly<Record<string, string>> = {
  ktime_get: 'CLOCK_MONOTONIC — time since boot, which never jumps',
  ktime_get_real: 'CLOCK_REALTIME — the wall clock, which settime and NTP can move',
  ktime_get_boottime: 'CLOCK_BOOTTIME — like monotonic, but counts time spent suspended',
  ktime_get_clocktai: 'CLOCK_TAI — the wall clock without leap seconds, 37s ahead of UTC',
};

/** What the callbacks that turn up most often are there for. */
export const CALLBACKS: Readonly<Record<string, string>> = {
  tick_sched_timer: 'The scheduler tick itself — the timer that runs the CPU’s own housekeeping',
  hrtimer_wakeup: 'A task asleep with a deadline: nanosleep, a poll timeout, a futex wait',
  posix_timer_fn: 'A POSIX timer, created by timer_create and owned by a process',
  timerfd_tmrproc: 'A timerfd, which delivers its expiry by making a file descriptor readable',
  alarmtimer_fired: 'An alarm timer, which is allowed to wake the machine from suspend',
  watchdog_timer_fn: 'The soft lockup detector, checking that this CPU is still getting work done',
  sched_cfs_period_timer: 'A cgroup’s CPU quota being handed back at the start of each period',
  sched_cfs_slack_timer: 'Returning CPU time a cgroup asked for and did not use',
  sched_rt_period_timer: 'The realtime bandwidth budget being refilled',
  perf_mux_hrtimer_handler: 'perf rotating between more events than the PMU has counters for',
  it_real_fn: 'An ITIMER_REAL alarm, set by alarm(2) or setitimer(2)',
};

/** `next_event` when nothing at all is programmed: KTIME_MAX. */
export const NO_EVENT = 9223372036854775807;

export interface Timer {
  /** Position in the base's queue, soonest first. */
  index: number;
  /** The hrtimer's address as printed — all zeroes under `kptr_restrict`. */
  address: string;
  /** The function that will run, e.g. `hrtimer_wakeup`. */
  callback: string;
  /** The hrtimer's state byte, as printed. Enqueued timers read `01`. */
  state: string;
  /** Earliest the kernel may fire this, in nanoseconds on the base's clock. */
  softExpiresNs: number;
  /** Latest it may fire, which is the deadline proper. */
  expiresNs: number;
  /** Nanoseconds until the earliest firing, as the kernel printed it. */
  inFromNs: number;
  /** Nanoseconds until the deadline, as the kernel printed it. */
  inToNs: number;
}

export interface ClockBase {
  index: number;
  /** The base's address as printed. */
  address: string;
  /** The function that reads this base's clock, e.g. `ktime_get`. */
  getTime: string;
  /** Distance from the monotonic clock to this one. */
  offsetNs: number;
  resolutionNs: number | null;
  timers: Timer[];
}

/** One `.name: value` line from a CPU's stat block, in the kernel's order. */
export interface CpuStat {
  name: string;
  value: number;
  /** `nsecs` when the kernel printed a unit, null when it printed a count. */
  unit: string | null;
}

export interface CpuTimers {
  cpu: number;
  bases: ClockBase[];
  stats: CpuStat[];
}

export interface DeviceField {
  name: string;
  value: string;
}

export interface TickDevice {
  /** The CPU this device drives, or null for the broadcast device. */
  cpu: number | null;
  /** How the tick runs here: see {@link TICK_MODES}. */
  tickMode: number;
  /** The hardware, or null where the kernel printed `<NULL>` — none at all. */
  name: string | null;
  /** The device's own state: see {@link CLOCK_EVENT_STATES}. */
  state: number | null;
  /** What it is programmed for, or {@link NO_EVENT} for nothing. */
  nextEventNs: number | null;
  fields: DeviceField[];
}

export interface BroadcastMask {
  name: string;
  /** The mask as printed, in hex groups. */
  raw: string;
  /** The CPUs it names. */
  cpus: number[];
}

export interface TimerList {
  version: string | null;
  /** Clock bases per CPU: four before 4.16, eight after. */
  clockBases: number | null;
  /** The monotonic clock when the file was read. */
  nowNs: number | null;
  jiffies: number | null;
  cpus: CpuTimers[];
  devices: TickDevice[];
  masks: BroadcastMask[];
}

const VERSION = /^Timer List Version:\s*(\S+)$/;
const MAX_BASES = /^HRTIMER_MAX_CLOCK_BASES:\s*(\d+)$/;
const NOW = /^now at (-?\d+) nsecs$/;
const CPU = /^cpu:\s*(\d+)$/;
const CLOCK = /^clock (\d+):$/;
const DOTTED = /^\.(\S+?)\s*:\s*(.*)$/;
const TIMER = /^#(\d+): <([^>]*)>, (.+), S:(\S+)$/;
const EXPIRES = /^# expires at (-?\d+)-(-?\d+) nsecs \[in (-?\d+) to (-?\d+) nsecs\]$/;
const JIFFIES = /^jiffies:\s*(\d+)$/;
const TICK_DEVICE = /^Tick Device: mode:\s*(-?\d+)$/;
const PER_CPU_DEVICE = /^Per CPU device:\s*(\d+)$/;
const EVENT_DEVICE = /^Clock Event Device:\s*(.*)$/;
const DEVICE_FIELD = /^(\w+):\s*(.*)$/;
const MASK = /^(tick_broadcast\w*mask):\s*(\S*)$/;

/** Reads `1 nsecs` or `1085639` as the number in front of it. */
function numberOf(value: string): number {
  const match = /^(-?\d+)/.exec(value.trim());
  return match === null ? 0 : Number(match[1]);
}

/** The unit the kernel printed after a figure, if it printed one. */
function unitOf(value: string): string | null {
  const match = /^-?\d+\s+(\S+)$/.exec(value.trim());
  return match === null ? null : match[1]!;
}

/**
 * Turns `00000000,0000000f` into the CPUs it names. The kernel prints a
 * bitmap as hex groups, most significant first, so the groups are walked from
 * the right and each one covers 32 CPUs.
 */
export function maskCpus(raw: string): number[] {
  const groups = raw.split(',').filter((group) => group !== '');
  const cpus: number[] = [];

  groups.reverse().forEach((group, groupIndex) => {
    const value = Number.parseInt(group, 16);
    if (!Number.isFinite(value)) return;

    for (let bit = 0; bit < 32; bit += 1) {
      if (((value >>> bit) & 1) === 1) cpus.push(groupIndex * 32 + bit);
    }
  });

  return cpus.sort((a, b) => a - b);
}

export function parseTimerList(text: string): TimerList {
  const list: TimerList = {
    version: null,
    clockBases: null,
    nowNs: null,
    jiffies: null,
    cpus: [],
    devices: [],
    masks: [],
  };

  let cpu: CpuTimers | null = null;
  let base: ClockBase | null = null;
  let device: TickDevice | null = null;
  let timer: Timer | null = null;
  // A dotted line belongs to the base it follows until `active timers:` has
  // been seen; after that the CPU's own stat block has begun.
  let inBaseFields = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const version = VERSION.exec(trimmed);
    if (version !== null) {
      list.version = version[1]!;
      continue;
    }

    const bases = MAX_BASES.exec(trimmed);
    if (bases !== null) {
      list.clockBases = Number(bases[1]);
      continue;
    }

    const now = NOW.exec(trimmed);
    if (now !== null) {
      list.nowNs = Number(now[1]);
      continue;
    }

    const jiffies = JIFFIES.exec(trimmed);
    if (jiffies !== null) {
      list.jiffies = Number(jiffies[1]);
      continue;
    }

    const mask = MASK.exec(trimmed);
    if (mask !== null) {
      list.masks.push({ name: mask[1]!, raw: mask[2] ?? '', cpus: maskCpus(mask[2] ?? '') });
      continue;
    }

    const cpuLine = CPU.exec(trimmed);
    if (cpuLine !== null) {
      cpu = { cpu: Number(cpuLine[1]), bases: [], stats: [] };
      list.cpus.push(cpu);
      base = null;
      device = null;
      inBaseFields = false;
      continue;
    }

    const clock = CLOCK.exec(trimmed);
    if (clock !== null && cpu !== null) {
      base = {
        index: Number(clock[1]),
        address: '',
        getTime: '',
        offsetNs: 0,
        resolutionNs: null,
        timers: [],
      };
      cpu.bases.push(base);
      inBaseFields = true;
      continue;
    }

    if (trimmed === 'active timers:') {
      inBaseFields = false;
      continue;
    }

    const tickDevice = TICK_DEVICE.exec(trimmed);
    if (tickDevice !== null) {
      device = {
        cpu: null,
        tickMode: Number(tickDevice[1]),
        name: null,
        state: null,
        nextEventNs: null,
        fields: [],
      };
      list.devices.push(device);
      cpu = null;
      base = null;
      continue;
    }

    if (device !== null) {
      if (trimmed === 'Broadcast device') {
        device.cpu = null;
        continue;
      }

      const perCpu = PER_CPU_DEVICE.exec(trimmed);
      if (perCpu !== null) {
        device.cpu = Number(perCpu[1]);
        continue;
      }

      const eventDevice = EVENT_DEVICE.exec(trimmed);
      if (eventDevice !== null) {
        // `<NULL>` is a tick device with no hardware behind it.
        const name = (eventDevice[1] ?? '').trim();
        device.name = name === '' || name === '<NULL>' ? null : name;
        continue;
      }

      const field = DEVICE_FIELD.exec(trimmed);
      if (field !== null) {
        const name = field[1]!;
        const value = (field[2] ?? '').trim();
        device.fields.push({ name, value });
        if (name === 'mode') device.state = numberOf(value);
        if (name === 'next_event') device.nextEventNs = numberOf(value);
        continue;
      }

      continue;
    }

    const timerLine = TIMER.exec(trimmed);
    if (timerLine !== null && base !== null) {
      timer = {
        index: Number(timerLine[1]),
        address: timerLine[2]!,
        callback: timerLine[3]!,
        state: timerLine[4]!,
        softExpiresNs: 0,
        expiresNs: 0,
        inFromNs: 0,
        inToNs: 0,
      };
      base.timers.push(timer);
      continue;
    }

    const expires = EXPIRES.exec(trimmed);
    if (expires !== null && timer !== null) {
      timer.softExpiresNs = Number(expires[1]);
      timer.expiresNs = Number(expires[2]);
      timer.inFromNs = Number(expires[3]);
      timer.inToNs = Number(expires[4]);
      timer = null;
      continue;
    }

    const dotted = DOTTED.exec(trimmed);
    if (dotted !== null) {
      const name = dotted[1]!;
      const value = dotted[2] ?? '';

      if (inBaseFields && base !== null) {
        if (name === 'base') base.address = value.trim();
        else if (name === 'index') base.index = numberOf(value);
        else if (name === 'resolution') base.resolutionNs = numberOf(value);
        else if (name === 'get_time') base.getTime = value.trim();
        else if (name === 'offset') base.offsetNs = numberOf(value);
        continue;
      }

      if (cpu !== null) {
        cpu.stats.push({ name, value: numberOf(value), unit: unitOf(value) });
      }
    }
  }

  return list;
}

/** One CPU's stat by name, or null where this kernel does not print it. */
export function cpuStat(cpu: CpuTimers, name: string): number | null {
  return cpu.stats.find((entry) => entry.name === name)?.value ?? null;
}

/** What this clock base is, read from the function that reads its clock. */
export function describeClock(base: ClockBase): string | null {
  return CLOCKS[base.getTime] ?? null;
}

/** What this callback is there for, or null for one with no note. */
export function describeCallback(callback: string): string | null {
  return CALLBACKS[callback] ?? null;
}

/**
 * Whether this base is one of the soft ones, whose timers run in the `HRTIMER`
 * softirq rather than in hard interrupt context. A kernel with eight bases
 * puts them in the second half; one with four has none.
 */
export function isSoftBase(base: ClockBase, clockBases: number | null): boolean {
  if (clockBases === null || clockBases < 8) return false;
  return base.index >= clockBases / 2;
}

/** How much room the kernel has to fire this timer early, in nanoseconds. */
export function slackNs(timer: Timer): number {
  return Math.max(0, timer.inToNs - timer.inFromNs);
}

/** Whether this timer was given any slack to be batched within. */
export function hasSlack(timer: Timer): boolean {
  return slackNs(timer) > 0;
}

/** Whether a device is programmed for nothing at all. */
export function isNoEvent(nextEventNs: number | null): boolean {
  return nextEventNs !== null && nextEventNs >= NO_EVENT;
}

/** A timer, and where it was found. */
export interface LocatedTimer {
  cpu: number;
  base: ClockBase;
  timer: Timer;
}

/** Every pending timer on the machine, soonest deadline first. */
export function allTimers(list: TimerList): LocatedTimer[] {
  const timers: LocatedTimer[] = [];

  for (const cpu of list.cpus) {
    for (const base of cpu.bases) {
      for (const timer of base.timers) timers.push({ cpu: cpu.cpu, base, timer });
    }
  }

  return timers.sort((a, b) => a.timer.inToNs - b.timer.inToNs);
}

export interface TimerListSummary {
  cpus: number;
  /** Pending timers across every CPU and base. */
  timers: number;
  /** Bases the kernel printed per CPU. */
  clockBases: number | null;
  /** The soonest deadline anywhere, or null when nothing is pending. */
  next: LocatedTimer | null;
  /** Timers with room to be fired early and batched with another wakeup. */
  withSlack: number;
  /** CPUs whose tick is currently stopped. */
  tickStopped: number[];
  /** CPUs running timers at hardware resolution rather than at jiffies. */
  hresActive: number[];
  /** Total hrtimer interrupts across the machine. */
  events: number;
  /** Times the interrupt had to be reprogrammed because it was already late. */
  retries: number;
  /** CPUs where callbacks overran badly enough to hang the interrupt. */
  hangs: { cpu: number; hangs: number; maxHangNs: number }[];
  /** The broadcast device, when the machine has one with hardware behind it. */
  broadcast: TickDevice | null;
  /** CPUs currently leaning on the broadcast device for their wakeups. */
  broadcastCpus: number[];
}

export function summarize(list: TimerList): TimerListSummary {
  const timers = allTimers(list);

  const hangs = list.cpus
    .map((cpu) => ({
      cpu: cpu.cpu,
      hangs: cpuStat(cpu, 'nr_hangs') ?? 0,
      maxHangNs: cpuStat(cpu, 'max_hang_time') ?? 0,
    }))
    .filter((entry) => entry.hangs > 0);

  const broadcast = list.devices.find((device) => device.cpu === null && device.name !== null);

  return {
    cpus: list.cpus.length,
    timers: timers.length,
    clockBases: list.clockBases,
    next: timers[0] ?? null,
    withSlack: timers.filter((located) => hasSlack(located.timer)).length,
    tickStopped: list.cpus.filter((cpu) => cpuStat(cpu, 'tick_stopped') === 1).map((cpu) => cpu.cpu),
    hresActive: list.cpus.filter((cpu) => cpuStat(cpu, 'hres_active') === 1).map((cpu) => cpu.cpu),
    events: list.cpus.reduce((total, cpu) => total + (cpuStat(cpu, 'nr_events') ?? 0), 0),
    retries: list.cpus.reduce((total, cpu) => total + (cpuStat(cpu, 'nr_retries') ?? 0), 0),
    hangs,
    broadcast: broadcast ?? null,
    broadcastCpus:
      list.masks.find((mask) => mask.name === 'tick_broadcast_oneshot_mask')?.cpus ??
      list.masks.find((mask) => mask.name === 'tick_broadcast_mask')?.cpus ??
      [],
  };
}

/** A nanosecond figure at a scale a person can read. */
export function formatNs(value: number): string {
  const abs = Math.abs(value);

  if (abs < 1_000) return `${Math.round(value)} ns`;
  if (abs < 1_000_000) return `${(value / 1_000).toFixed(abs < 10_000 ? 1 : 0)} µs`;
  if (abs < 1_000_000_000) return `${(value / 1_000_000).toFixed(abs < 10_000_000 ? 1 : 0)} ms`;

  const seconds = value / 1_000_000_000;
  if (abs < 60_000_000_000) return `${seconds.toFixed(abs < 10_000_000_000 ? 1 : 0)} s`;

  const whole = Math.round(Math.abs(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const sign = value < 0 ? '-' : '';

  return hours > 0 ? `${sign}${hours}h ${minutes}m` : `${sign}${minutes}m ${rest}s`;
}
