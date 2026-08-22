import { useMemo } from 'react';
import {
  allTimers,
  CLOCK_EVENT_STATES,
  cpuStat,
  describeCallback,
  describeClock,
  formatNs,
  hasSlack,
  isNoEvent,
  isSoftBase,
  parseTimerList,
  slackNs,
  summarize,
  TICK_MODES,
  type ClockBase,
  type CpuTimers,
  type TickDevice,
  type Timer,
  type TimerList,
} from '../lib/timer_list';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The stats worth reading off a CPU without unfolding the whole block. */
const HEADLINE_STATS = ['nr_events', 'nr_retries', 'nr_hangs'] as const;

function TimerRow({ timer }: { timer: Timer }) {
  const slack = slackNs(timer);
  const described = describeCallback(timer.callback);

  return (
    <tr className="tl__row">
      <td className="tl__callback" title={described ?? 'A callback this page has no note for'}>
        {timer.callback}
      </td>
      <td className="tl__number" title={`Expires at ${timer.expiresNs.toLocaleString()} nsecs`}>
        {formatNs(timer.inToNs)}
      </td>
      <td className="tl__number">
        {hasSlack(timer) ? (
          <span
            title={`May fire from ${formatNs(timer.inFromNs)} — anywhere in a ${formatNs(slack)} window`}
          >
            {formatNs(slack)}
          </span>
        ) : (
          <span className="muted" title="No slack: this one fires at its deadline">
            —
          </span>
        )}
      </td>
      <td className="tl__addr muted">{timer.address}</td>
    </tr>
  );
}

function Base({ base, cpu, list }: { base: ClockBase; cpu: number; list: TimerList }) {
  const soft = isSoftBase(base, list.clockBases);
  const clock = describeClock(base);

  return (
    <div className="tl__base">
      <h4 className="tl__baseName">
        <span title={clock ?? 'A clock this page has no note for'}>
          clock {base.index} · {base.getTime}
        </span>
        {soft && (
          <span
            className="chip chip--type"
            title="Its timers run in the HRTIMER softirq, not in hard interrupt context"
          >
            soft
          </span>
        )}
        {base.offsetNs !== 0 && (
          <span className="muted" title="Distance from the monotonic clock to this one">
            offset {formatNs(base.offsetNs)}
          </span>
        )}
      </h4>

      <table
        className="mounts__table tl__table"
        aria-label={`Timers on clock ${base.index} of cpu ${cpu}`}
      >
        <thead>
          <tr>
            <th scope="col">Callback</th>
            <th scope="col">Fires in</th>
            <th scope="col">Slack</th>
            <th scope="col">Address</th>
          </tr>
        </thead>
        <tbody>
          {base.timers.map((timer) => (
            <TimerRow key={`${timer.index}-${timer.address}-${timer.callback}`} timer={timer} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cpu({ cpu, list }: { cpu: CpuTimers; list: TimerList }) {
  const active = cpu.bases.filter((base) => base.timers.length > 0);
  const empty = cpu.bases.length - active.length;
  const stopped = cpuStat(cpu, 'tick_stopped') === 1;
  const hres = cpuStat(cpu, 'hres_active') === 1;

  return (
    <section className="card tl" aria-label={`CPU ${cpu.cpu}`}>
      <h3 className="tl__name">cpu {cpu.cpu}</h3>

      <p className="tl__stats">
        <span
          className={stopped ? 'chip chip--flag' : 'chip chip--model'}
          title={
            stopped
              ? 'The tick is stopped: this CPU is idle and has been left alone'
              : 'The tick is running here'
          }
        >
          tick {stopped ? 'stopped' : 'running'}
        </span>
        <span
          className="chip chip--model"
          title={
            hres
              ? 'Timers here run at hardware resolution'
              : 'No high-resolution mode: timers here are rounded to the tick'
          }
        >
          {hres ? 'high resolution' : 'low resolution'}
        </span>
        {HEADLINE_STATS.map((name) => {
          const value = cpuStat(cpu, name);
          if (value === null) return null;

          return (
            <span
              key={name}
              className={name === 'nr_hangs' && value > 0 ? 'chip chip--ro' : 'chip chip--model'}
            >
              {name} <span className="count">{value.toLocaleString()}</span>
            </span>
          );
        })}
      </p>

      {active.length === 0 ? (
        <p className="muted tl__none">No timers pending on any of this CPU’s clock bases.</p>
      ) : (
        active.map((base) => <Base key={base.index} base={base} cpu={cpu.cpu} list={list} />)
      )}

      {empty > 0 && (
        <p className="muted tl__empty">
          {empty} of {cpu.bases.length} clock bases have nothing queued.
        </p>
      )}
    </section>
  );
}

function Device({ device }: { device: TickDevice }) {
  const label = device.cpu === null ? 'Broadcast device' : `Per CPU device: ${device.cpu}`;

  return (
    <section className="card tl tl__device" aria-label={label}>
      <h3 className="tl__name">
        {label}
        {device.name !== null && <span className="tl__hw">{device.name}</span>}
      </h3>

      <p className="tl__stats">
        <span
          className="chip chip--model"
          title={TICK_MODES[device.tickMode] ?? 'An unknown tick mode'}
        >
          tick <span className="count">{device.tickMode === 0 ? 'periodic' : 'oneshot'}</span>
        </span>
        {device.state !== null && (
          <span
            className="chip chip--model"
            title={CLOCK_EVENT_STATES[device.state] ?? 'A device state this page has no note for'}
          >
            device <span className="count">{device.state}</span>
          </span>
        )}
        {device.nextEventNs !== null && (
          <span
            className="chip chip--model"
            title={
              isNoEvent(device.nextEventNs)
                ? 'KTIME_MAX: nothing is programmed on this device at all'
                : 'What this device is next programmed to fire at'
            }
          >
            next{' '}
            <span className="count">
              {isNoEvent(device.nextEventNs) ? 'nothing' : device.nextEventNs.toLocaleString()}
            </span>
          </span>
        )}
      </p>

      {device.name === null ? (
        <p className="muted tl__none">
          No hardware behind this tick device — the kernel printed <code>&lt;NULL&gt;</code>.
        </p>
      ) : (
        <dl className="tl__fields">
          {device.fields.map((field) => (
            <div key={field.name} className="tl__field">
              <dt>{field.name}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function TimerListView({ content }: { content: string }) {
  const list = useMemo(() => parseTimerList(content), [content]);
  const summary = useMemo(() => summarize(list), [list]);
  const timers = useMemo(() => allTimers(list), [list]);

  if (list.cpus.length === 0 && list.devices.length === 0) {
    return (
      <p className="notice notice--warn">
        No CPUs or tick devices found in this file. It is readable by root only, so an empty
        response usually means the backend could not read it — switch to the raw view to see what
        it returned.
      </p>
    );
  }

  return (
    <>
      {summary.hangs.length > 0 && (
        <p className="notice notice--warn" role="status">
          {summary.hangs
            .map(
              (entry) =>
                `cpu ${entry.cpu} hung ${entry.hangs.toLocaleString()} times, ` +
                `worst ${formatNs(entry.maxHangNs)}`,
            )
            .join('; ')}
          . A hang is the hrtimer interrupt finding its next event already in the past, because
          the callbacks it just ran took too long — the kernel gives up reprogramming and comes
          back later, so timers on that CPU are firing late.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="pending timers" value={String(summary.timers)} />
        <Stat label="CPUs" value={String(summary.cpus)} />
        <Stat
          label="next expiry"
          value={summary.next === null ? '—' : formatNs(summary.next.timer.inToNs)}
        />
        <Stat label="since boot" value={list.nowNs === null ? '—' : formatNs(list.nowNs)} />
      </section>

      <p className="models" data-testid="machine">
        {list.version !== null && (
          <span className="chip chip--model" title="The format version this kernel prints">
            {list.version}
          </span>
        )}
        {list.clockBases !== null && (
          <span
            className="chip chip--model"
            title={
              list.clockBases >= 8
                ? 'Four clocks, each with a hard and a soft base — a kernel from 4.16 or later'
                : 'Four clocks, no soft bases — a kernel from before 4.16'
            }
          >
            clock bases <span className="count">{list.clockBases}</span>
          </span>
        )}
        {summary.tickStopped.length > 0 && (
          <span className="chip chip--flag" title="These CPUs are idle with the tick stopped">
            tickless <span className="count">cpu {summary.tickStopped.join(', ')}</span>
          </span>
        )}
        {summary.broadcastCpus.length > 0 && (
          <span
            className="chip chip--flag"
            title="Idle deeply enough to stop their own timer, so the broadcast device wakes them"
          >
            on broadcast <span className="count">cpu {summary.broadcastCpus.join(', ')}</span>
          </span>
        )}
        {summary.withSlack > 0 && (
          <span
            className="chip chip--model"
            title="Timers the kernel may fire early to batch them with another wakeup"
          >
            with slack <span className="count">{summary.withSlack}</span>
          </span>
        )}
      </p>

      {summary.next !== null && (
        <p className="disks__note muted" data-testid="next-timer">
          Next up: <code>{summary.next.timer.callback}</code> on cpu {summary.next.cpu} in{' '}
          {formatNs(summary.next.timer.inToNs)}
          {timers.length > 1 && `, then ${timers.length - 1} more`}.
        </p>
      )}

      <div className="md__arrays">
        {list.cpus.map((cpu) => (
          <Cpu key={cpu.cpu} cpu={cpu} list={list} />
        ))}
        {list.devices.map((device) => (
          <Device key={device.cpu === null ? 'broadcast' : `cpu${device.cpu}`} device={device} />
        ))}
      </div>

      <p className="disks__note muted">
        Every expiry here is <strong>a range, not a moment</strong>: the two figures are the
        earliest the kernel may fire the timer and its deadline, and the gap is slack it can spend
        batching that wakeup with another one rather than waking the CPU twice. Watch the two
        different <code>mode</code> numbers in a tick device block — the first is how the tick runs,
        periodic or oneshot, and the indented one is the clock event device&rsquo;s own state, so
        they are not the same scale. A <code>next_event</code> of 9223372036854775807 is{' '}
        <code>KTIME_MAX</code>, which means nothing is programmed rather than something very far
        off. Eight clock bases means four clocks each with a hard and a soft base, the soft ones
        running their callbacks in the <code>HRTIMER</code> softirq; a kernel from before 4.16
        prints four. The file is <strong>root-only</strong> and prints kernel pointers, so under{' '}
        <code>kptr_restrict</code> every address arrives as zeroes and the callback names are all
        there is to go on.
      </p>
    </>
  );
}
