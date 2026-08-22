import { useMemo } from 'react';
import {
  formatDuration,
  formatMicroseconds,
  globalTimer,
  hzOf,
  isConfigured,
  longestInterval,
  parseTimers,
  substreamOf,
  summarize,
  type Timer,
} from '../lib/asound-timers';

/** What each class of identifier is, which is the whole left-hand column. */
const CLASSES: Readonly<Record<Timer['class'], { label: string; title: string }>> = {
  global: {
    label: 'global',
    title: "One of the kernel's own timers, registered by ALSA rather than belonging to a card",
  },
  card: {
    label: 'card',
    title: "A timer on the sound card itself, ticking on the card's clock rather than the kernel's",
  },
  pcm: {
    label: 'PCM',
    title: 'The timer of one PCM substream, which ticks once per period of whatever is playing',
  },
  other: {
    label: 'unnamed class',
    title: 'The fallback branch of the printer: a class it has no letter for',
  },
};

const SLAVE_TITLE =
  'SNDRV_TIMER_HW_SLAVE: no clock of its own, so it ticks when something else says a period has ' +
  'passed — for a PCM stream, the sound card’s own interrupt';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** The identifier, which is a class and the coordinates of the thing it times. */
function Identifier({ timer }: { timer: Timer }) {
  const substream = substreamOf(timer);
  const global = globalTimer(timer);

  const title =
    timer.class === 'global'
      ? `Global timer ${timer.device}${global === null ? '' : ` — ${global.name}`}`
      : timer.class === 'card'
        ? `Card ${timer.card}, timer ${timer.device}`
        : substream === null
          ? `Class ${timer.classNumber}, card ${timer.card ?? -1}, device ${timer.device}`
          : `Card ${timer.card}, device ${timer.device}, substream ${substream.index} ${
              substream.capture ? 'capture' : 'playback'
            } — printed as ${timer.subdevice}, which packs the two together`;

  return (
    <span className="asndt__id" title={title}>
      {timer.id}
    </span>
  );
}

/** The resolution, which is nanoseconds however the kernel spells it. */
function Resolution({ timer }: { timer: Timer }) {
  if (timer.resolution === null) {
    return (
      <span
        className="muted"
        title={
          timer.class === 'pcm'
            ? 'No stream is configured on this substream, so it has no period to tick at — the kernel prints the field only when it is not zero'
            : 'This timer printed no resolution, which is what a resolution of 0 looks like: the field is left out rather than shown as zero'
        }
      >
        —
      </span>
    );
  }

  const hz = hzOf(timer);

  return (
    <span
      title={`${formatMicroseconds(timer.resolution)} as printed — ${timer.resolution.toLocaleString('en-US')} nanoseconds${
        hz === null ? '' : `, which is CONFIG_HZ = ${hz}`
      }`}
    >
      {formatDuration(timer.resolution)}
    </span>
  );
}

function TimerRow({ timer }: { timer: Timer }) {
  const interval = longestInterval(timer);
  const substream = substreamOf(timer);
  const global = globalTimer(timer);

  return (
    <tr className={isConfigured(timer) ? 'asndt__row asndt__row--configured' : 'asndt__row'}>
      <td>
        <Identifier timer={timer} />
      </td>

      <td className="asndt__class">
        <span title={CLASSES[timer.class].title}>{CLASSES[timer.class].label}</span>
      </td>

      <td className="asndt__name">
        <span title={global?.note}>{timer.name}</span>
        {substream !== null && (
          <span
            className="chip"
            title={`Printed as ${timer.subdevice}: the substream number shifted up one bit with the direction in the bottom bit`}
          >
            substream {substream.index} {substream.capture ? 'capture' : 'playback'}
          </span>
        )}
      </td>

      <td className="asndt__number">
        <Resolution timer={timer} />
      </td>

      <td className="asndt__number">
        {timer.ticks === null ? (
          <span className="muted">—</span>
        ) : (
          <span
            title={`hw.ticks: the most ticks this timer will count in one go — ${
              interval === null ? 'a ceiling, not a count' : `${formatDuration(interval)} at this resolution`
            }`}
          >
            {timer.ticks.toLocaleString('en-US')}
          </span>
        )}
      </td>

      <td className="asndt__flags">
        {timer.slave && (
          <span className="chip chip--flag" title={SLAVE_TITLE}>
            SLAVE
          </span>
        )}
      </td>

      <td className="asndt__clients">
        {timer.clients.length === 0 ? (
          <span className="muted" title="Nothing has this timer open">
            —
          </span>
        ) : (
          timer.clients.map((client) => (
            <span
              key={client.raw}
              className={client.running ? 'chip asndt__client--running' : 'chip'}
              title={
                client.running
                  ? 'Started or running — the kernel prints those two states as one'
                  : 'Open, but not started'
              }
            >
              {client.owner}
            </span>
          ))
        )}
      </td>
    </tr>
  );
}

export function AsoundTimersView({ content }: { content: string }) {
  const table = useMemo(() => parseTimers(content), [content]);
  const summary = useMemo(() => summarize(table), [table]);

  /**
   * No timers at all, which a machine with the sound core loaded does not
   * really say — `snd-timer` registers the system timer as it comes up — so
   * this is an empty read rather than an empty list.
   */
  if (table.timers.length === 0) {
    return (
      <p className="notice notice--warn">
        No timers in this file. ALSA registers the system timer when{' '}
        <code>snd-timer</code> initialises, so even a machine with no sound card lists that one —
        an empty file here is the read failing rather than the machine having nothing. Switch to the
        raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.hz !== null && summary.tick !== null && (
        <p className="notice" role="status" data-testid="kernel-tick">
          <strong>This kernel ticks at {summary.hz} Hz.</strong> The system timer&rsquo;s resolution
          is one tick of it — {formatMicroseconds(summary.tick)}, or {formatDuration(summary.tick)} —
          so the first line of this file says what <code>CONFIG_HZ</code> the running kernel was
          built with, which nothing else under <code>/proc</code> spells out.
        </p>
      )}

      {summary.configured.length > 0 && (
        <p className="notice" role="status" data-testid="configured">
          {summary.configured.length === 1
            ? '1 substream has a stream set up on it'
            : `${summary.configured.length} substreams have a stream set up on them`}
          , and the resolution of a PCM timer is that stream&rsquo;s <strong>period</strong>:{' '}
          {summary.configured
            .map((timer) => `${timer.id} at ${formatDuration(timer.resolution!)}`)
            .join(', ')}
          . That is <code>period_size ÷ rate</code> — how often the card interrupts, and the
          quantum the whole latency of the stream is built out of. A substream with no resolution
          has nothing configured on it.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="timers" value={String(summary.timers)} />
        <Stat
          label="kernel tick"
          value={summary.hz === null ? '—' : `${summary.hz} Hz`}
          title={
            summary.tick === null
              ? 'No system timer in this file'
              : `${formatMicroseconds(summary.tick)} per tick, which is 1/CONFIG_HZ`
          }
        />
        <Stat
          label="streams up"
          value={String(summary.configured.length)}
          title="PCM substreams with a period configured, which is what a resolution on a P line means"
        />
        <Stat
          label="clients"
          value={
            summary.running.length === 0
              ? String(summary.clients.length)
              : `${summary.clients.length} · ${summary.running.length} running`
          }
          title="Everything holding a timer open, and how many of those have started it"
        />
      </section>

      <div className="card mounts asndt">
        <table className="mounts__table asndt__table" aria-label="ALSA timers">
          <thead>
            <tr>
              <th scope="col">Timer</th>
              <th scope="col">Class</th>
              <th scope="col">Name</th>
              <th scope="col">Resolution</th>
              <th scope="col">Max ticks</th>
              <th scope="col">Flags</th>
              <th scope="col">Clients</th>
            </tr>
          </thead>
          <tbody>
            {table.timers.map((timer) => (
              <TimerRow key={timer.id} timer={timer} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        <strong>The identifier is coordinates, not an index.</strong> The letter is the timer&rsquo;s
        class — <code>G</code> for one of the kernel&rsquo;s own, <code>C</code> for one on a card,{' '}
        <code>P</code> for one PCM substream&rsquo;s — and the numbers after it say which card,
        device and substream, so nothing here is numbered in the order it is printed. A global
        timer&rsquo;s device number is one of the <code>SNDRV_TIMER_GLOBAL_*</code> constants rather
        than a count: 0 is the system timer, 1 the 1024 Hz RTC that a modern kernel no longer
        registers, and 3 the hrtimer. Three more things read wrong at first glance.{' '}
        <strong>The resolution is nanoseconds</strong>, printed as microseconds by splitting it —{' '}
        <code>&quot;%lu.%03luus&quot;</code> over <code>resolution / 1000</code> and{' '}
        <code>resolution % 1000</code> — so the three decimals are the nanosecond remainder and{' '}
        <code>0.001us</code> is one nanosecond rather than a rounding error.{' '}
        <strong>
          <code>ticks</code> is a ceiling
        </strong>{' '}
        — <code>hw.ticks</code> is the most the timer will count in one go, so it multiplies out to
        the longest interval it can be programmed for and counts nothing that has happened. And{' '}
        <strong>a field that is 0 is not printed at all</strong>: the resolution is written only when
        it is non-zero, which is why an idle substream&rsquo;s line stops at its name or at{' '}
        <code>SLAVE</code>. That flag is <code>SNDRV_TIMER_HW_SLAVE</code>, a timer with no clock of
        its own — a PCM substream ticks on the card&rsquo;s interrupt, which is exactly what makes it
        worth slaving a sequencer queue to: the queue then follows the audio clock rather than the
        kernel&rsquo;s. The <code>Client</code> lines are the instances holding a timer open, with{' '}
        <code>running</code> covering both started and running, since the kernel prints one word for
        the two flags. What is <em>not</em> here is anything about audio: a substream&rsquo;s timer
        is registered whether or not the substream is in use, and the clients are timer users rather
        than the processes playing sound.
      </p>
    </>
  );
}
