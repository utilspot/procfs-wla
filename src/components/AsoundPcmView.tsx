import { useMemo } from 'react';
import {
  directionOf,
  opensAtOnce,
  parsePcm,
  summarize,
  timerIdsOf,
  type Direction,
  type PcmDevice,
} from '../lib/asound-pcm';

/** What each direction is, which is decided by the fields the kernel printed. */
const DIRECTIONS: Readonly<Record<Direction, { label: string; title: string }>> = {
  duplex: {
    label: 'duplex',
    title: 'Both streams have substreams, so this is one device that plays and records rather than two',
  },
  playback: {
    label: 'playback only',
    title: 'No capture field at all: that stream has no substreams, so the kernel printed nothing for it',
  },
  capture: {
    label: 'capture only',
    title: 'No playback field at all: that stream has no substreams, so the kernel printed nothing for it',
  },
  neither: {
    label: 'no substreams',
    title: 'Neither stream printed a count, which leaves a device nothing can be opened on',
  },
};

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** One of the two counts, which is substreams rather than channels. */
function Count({ device, stream }: { device: PcmDevice; stream: 'playback' | 'capture' }) {
  const count = device[stream];

  if (count === null) {
    return (
      <span
        className="muted"
        title={`This device has no ${stream} substreams, so the kernel left the field out rather than printing a 0`}
      >
        —
      </span>
    );
  }

  return (
    <span
      title={
        count === 1
          ? `One ${stream} substream: a second open on it gets EBUSY unless something is mixing in front of it`
          : `${count} ${stream} substreams — ${count} streams can be open at once, which is not ${count} channels`
      }
    >
      {count}
    </span>
  );
}

/** The `/proc/asound/timers` lines this device's substreams have. */
function Timers({ device }: { device: PcmDevice }) {
  const ids = timerIdsOf(device);
  if (ids.length === 0) return <span className="muted">—</span>;

  const title = `${ids.length} substream${ids.length === 1 ? '' : 's'}, so ${
    ids.length === 1 ? 'one line' : `${ids.length} lines`
  } in /proc/asound/timers: ${ids.length > 6 ? `${ids[0]} through ${ids[ids.length - 1]}` : ids.join(', ')}`;

  return (
    <span className="asndp__timers" title={title}>
      {ids.length > 3 ? `${ids[0]} … ${ids[ids.length - 1]}` : ids.join(' ')}
    </span>
  );
}

function DeviceRow({ device }: { device: PcmDevice }) {
  const direction = directionOf(device);

  return (
    <tr className={opensAtOnce(device) > 1 ? 'asndp__row asndp__row--multi' : 'asndp__row'}>
      <td>
        <span
          className="asndp__address"
          title={`Card ${device.card}, device ${device.device} — the driver's own numbering, not a position in this list`}
        >
          {device.address}
        </span>
      </td>

      <td className="asndp__id" title="pcm->id, which is what the driver passed to snd_pcm_new">
        {device.id}
      </td>

      <td className="asndp__name">
        <span title="pcm->name, which the driver wrote after creating the device">
          {device.name === '' ? '—' : device.name}
        </span>
        <span className="chip" title={DIRECTIONS[direction].title}>
          {DIRECTIONS[direction].label}
        </span>
      </td>

      <td className="asndp__number">
        <Count device={device} stream="playback" />
      </td>

      <td className="asndp__number">
        <Count device={device} stream="capture" />
      </td>

      <td className="asndp__number">
        <Timers device={device} />
      </td>
    </tr>
  );
}

export function AsoundPcmView({ content }: { content: string }) {
  const table = useMemo(() => parsePcm(content), [content]);
  const summary = useMemo(() => summarize(table), [table]);

  /**
   * An empty file, which here is an answer rather than a failure: the sound
   * core can be loaded with no card registered, and then there is no PCM device
   * to list.
   */
  if (table.devices.length === 0) {
    return (
      <p className="notice" role="status">
        No PCM devices on this machine. The file is empty, which is what a machine with the sound
        core loaded and <strong>no card registered</strong> says — the core itself has no device to
        offer, and a card is what brings one. <code>/proc/asound/cards</code> beside this file is
        where that is confirmed, and the timers under <code>/proc/asound/timers</code> will be the
        kernel&rsquo;s own with no <code>P</code> line among them.
      </p>
    );
  }

  return (
    <>
      {summary.multiOpen.length > 0 && (
        <p className="notice" role="status" data-testid="multi-open">
          {summary.multiOpen.length === 1
            ? '1 device carries more than one stream at a time'
            : `${summary.multiOpen.length} devices carry more than one stream at a time`}
          :{' '}
          {summary.multiOpen
            .map((device) => `${device.address} (${opensAtOnce(device)})`)
            .join(', ')}
          . Those are <strong>substreams, not channels</strong> — how many independent streams can
          be open on the device at once, which is the card mixing them itself. A device with one
          substream takes one opener, and the second gets <code>EBUSY</code> unless a sound server
          is mixing in front of it.
        </p>
      )}

      {summary.gappedCards.length > 0 && (
        <p className="notice" role="status" data-testid="gaps">
          The device numbers skip on{' '}
          {summary.gappedCards.length === 1
            ? `card ${summary.gappedCards[0]}`
            : `cards ${summary.gappedCards.join(', ')}`}
          , which is ordinary: the number comes from the driver rather than from counting, so an HDA
          codec puts its analog device at 0 and its HDMI ones at 3 and 7. Nothing is missing — a
          device number and a card number together are the device&rsquo;s identity, and the kernel
          keeps this list sorted by the pair.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="devices" value={String(summary.devices)} />
        <Stat
          label="cards"
          value={String(summary.cards.length)}
          title={`Card ${summary.cards.join(', ')} — every card with a PCM device on it`}
        />
        <Stat
          label="playback"
          value={String(summary.playbackSubstreams)}
          title={`Playback substreams across ${summary.playbackDevices} device${summary.playbackDevices === 1 ? '' : 's'}`}
        />
        <Stat
          label="capture"
          value={String(summary.captureSubstreams)}
          title={`Capture substreams across ${summary.captureDevices} device${summary.captureDevices === 1 ? '' : 's'}`}
        />
      </section>

      <div className="card mounts asndp">
        <table className="mounts__table asndp__table" aria-label="PCM devices">
          <thead>
            <tr>
              <th scope="col">Device</th>
              <th scope="col">Id</th>
              <th scope="col">Name</th>
              <th scope="col">Playback</th>
              <th scope="col">Capture</th>
              <th scope="col">Timers</th>
            </tr>
          </thead>
          <tbody>
            {table.devices.map((device) => (
              <DeviceRow key={device.address} device={device} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        This is the list of PCM devices, <strong>not of anything playing</strong>. The kernel keeps{' '}
        <code>substream_opened</code> in the same structure as the counts above and prints only the
        second of them, so a device that nothing has ever opened reads exactly like one carrying
        audio right now; the state of a stream is under{' '}
        <code>/proc/asound/card0/pcm0p/sub0/status</code>, a file per substream. Four things about
        the line read wrong at first glance. <strong>The two names are two fields</strong>:{' '}
        <code>pcm-&gt;id</code> is what the driver passed to <code>snd_pcm_new</code> and{' '}
        <code>pcm-&gt;name</code> what it wrote afterwards, so they are often the same string and
        sometimes an id like <code>emu10k1</code> against a name like{' '}
        <code>ADC Capture/Standard PCM Playback</code> — <code>aplay -l</code> prints both, the
        second in brackets. <strong>The counts are substreams</strong>, how many streams the device
        will carry at once, and not how many channels any of them has. <strong>
          A stream with none is not printed at all
        </strong>{' '}
        rather than printed as 0, which is why a capture-only device&rsquo;s line simply stops.{' '}
        <strong>And the device number is the driver&rsquo;s</strong>, not this list&rsquo;s: gaps
        are normal, the card and device pair is the identity — <code>snd_pcm_add</code> refuses a
        second PCM claiming one — and that pair is what keeps the file sorted. One thing is missing
        by design: a PCM created as <code>internal</code> is never added to this list, so what is
        here is what userspace can open. Each substream counted above is also one line in{' '}
        <code>/proc/asound/timers</code>, since <code>snd_pcm_dev_register</code> gives every one of
        them a timer — which is where a configured stream&rsquo;s period shows up.
      </p>
    </>
  );
}
