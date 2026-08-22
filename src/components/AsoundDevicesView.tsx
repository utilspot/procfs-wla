import { useMemo } from 'react';
import {
  describeType,
  isGlobal,
  MINORS,
  MINORS_PER_CARD,
  parseDevices,
  pathOf,
  SOUND_MAJOR,
  staticMinorOf,
  summarize,
  type SoundDevice,
} from '../lib/asound-devices';

const GLOBAL_TITLE =
  'No card at all: the sequencer and the timer belong to the core, so there is one of each for ' +
  'the machine rather than one per card';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/** Which card and device the node belongs to, in the shape the file printed. */
function Owner({ device }: { device: SoundDevice }) {
  if (isGlobal(device)) {
    return (
      <span className="muted" title={GLOBAL_TITLE}>
        the core
      </span>
    );
  }

  if (device.device === null) {
    return (
      <span title={`Card ${device.card} as a whole, rather than a device on it`}>
        card {device.card}
      </span>
    );
  }

  return (
    <span title={`Card ${device.card}, device ${device.device} — the pair /proc/asound/pcm prints as ${String(device.card).padStart(2, '0')}-${String(device.device).padStart(2, '0')}`}>
      card {device.card}, device {device.device}
    </span>
  );
}

function DeviceRow({ device }: { device: SoundDevice }) {
  const type = describeType(device.type);
  const path = pathOf(device);
  const expected = staticMinorOf(device);

  return (
    <tr className={isGlobal(device) ? 'asndd__row asndd__row--global' : 'asndd__row'}>
      <td className="asndd__number">
        <span
          title={`Minor ${device.minor} on major ${SOUND_MAJOR}${
            expected === null || expected === device.minor
              ? ''
              : `, where the static scheme would have put it at ${expected}`
          }`}
        >
          {device.minor}
        </span>
      </td>

      <td className="asndd__owner">
        <Owner device={device} />
      </td>

      <td className="asndd__type">
        {device.type === '?' ? (
          <span
            className="chip chip--flag"
            title="A device type snd_device_type_name has no name for, which it prints as a question mark"
          >
            ?
          </span>
        ) : (
          device.type
        )}
      </td>

      <td className="asndd__note">
        {type?.note ?? (
          <span className="muted" title="A type this page has no note for">
            —
          </span>
        )}
      </td>

      <td className="asndd__node">
        {path === null ? (
          <span className="muted" title="No node name can be built for a type this file does not name">
            —
          </span>
        ) : (
          <span title={`Character device ${SOUND_MAJOR}:${device.minor}`}>{path}</span>
        )}
      </td>
    </tr>
  );
}

export function AsoundDevicesView({ content }: { content: string }) {
  const table = useMemo(() => parseDevices(content), [content]);
  const summary = useMemo(() => summarize(table), [table]);

  if (table.devices.length === 0) {
    return (
      <p className="notice notice--warn">
        No devices in this file. The sequencer and the timer belong to the sound core rather than to
        any card, so even a machine with no card at all lists those two — an empty file here is the
        read failing rather than the machine having nothing. Switch to the raw view to see what the
        server returned.
      </p>
    );
  }

  return (
    <>
      {summary.scheme === 'dynamic' && (
        <p className="notice" role="status" data-testid="scheme">
          <strong>This kernel hands its minors out rather than computing them.</strong> At least one
          node here is not where <code>SNDRV_MINOR(card, dev)</code> would put it, so the build has{' '}
          <code>CONFIG_SND_DYNAMIC_MINORS</code> — minors come off a free list in registration
          order and encode nothing. Without it the minor is{' '}
          <code>(card &lt;&lt; {Math.log2(MINORS_PER_CARD)}) | offset</code>, which is what makes
          the static scheme&rsquo;s ceilings real: {MINORS_PER_CARD} minors per card, 8 PCM devices
          and 4 hardware-dependent nodes inside that, and 8 cards in the {MINORS} minors ALSA has.
        </p>
      )}

      {summary.scheme === 'static' && (
        <p className="notice" role="status" data-testid="scheme">
          Every minor here is exactly where <code>SNDRV_MINOR(card, dev)</code> would put it:{' '}
          <code>card &times; {MINORS_PER_CARD}</code> plus the type&rsquo;s own offset in that block
          — control at 0, raw midi at 8, PCM playback at 16, capture at 24. So the number{' '}
          <em>encodes</em> the card and the type, which is a kernel built without{' '}
          <code>CONFIG_SND_DYNAMIC_MINORS</code> — or a dynamic one that has so far allocated in the
          same order, which on a single-card machine it often does.
        </p>
      )}

      {summary.unknownTypes.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="unknown">
          {summary.unknownTypes.length === 1 ? 'A device type' : 'Device types'} this file names as{' '}
          {summary.unknownTypes.map((type, index) => (
            <span key={type}>
              {index > 0 && ', '}
              <code>{type}</code>
            </span>
          ))}
          , which <code>snd_device_type_name</code> has no case for. A <code>?</code> is a type the
          kernel registered and its own printer cannot name.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="nodes" value={String(summary.devices)} />
        <Stat
          label="cards"
          value={String(summary.cards.length)}
          title={
            summary.cards.length === 0
              ? 'No card has a node here — only the core’s own two'
              : `Card ${summary.cards.join(', ')}`
          }
        />
        <Stat
          label="PCM nodes"
          value={String(summary.pcm.length)}
          title="One per PCM device and direction — substreams are opened through the same node, so they add none"
        />
        <Stat
          label="highest minor"
          value={summary.highestMinor === null ? '—' : String(summary.highestMinor)}
          title={`Out of the ${MINORS} minors ALSA has on major ${SOUND_MAJOR}`}
        />
      </section>

      <div className="card mounts asndd">
        <table className="mounts__table asndd__table" aria-label="Sound devices">
          <thead>
            <tr>
              <th scope="col">Minor</th>
              <th scope="col">Belongs to</th>
              <th scope="col">Type</th>
              <th scope="col">What it is</th>
              <th scope="col">Node</th>
            </tr>
          </thead>
          <tbody>
            {table.devices.map((device) => (
              <DeviceRow key={device.minor} device={device} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        This is the map from what ALSA registered to <strong>what a program opens</strong>: every
        line is one character device under <code>/dev/snd</code> on major {SOUND_MAJOR}, and the
        number on the left is its minor. Three things about it read wrong at first glance.{' '}
        <strong>A substream is not a device</strong> — a PCM device with eight substreams has one
        node here, because substreams are opened through the same one, so this file counts devices
        where <code>/proc/asound/pcm</code> counts what each will carry.{' '}
        <strong>The two lines with no card are the core&rsquo;s</strong>: the sequencer at minor 1
        and the timer at 33 are the machine&rsquo;s rather than any card&rsquo;s, which is why they
        are there on a machine with no card at all, and why those two numbers never move. And{' '}
        <strong>what the minor means depends on the build</strong>. Without{' '}
        <code>CONFIG_SND_DYNAMIC_MINORS</code> it is computed —{' '}
        <code>(card &lt;&lt; {Math.log2(MINORS_PER_CARD)}) | offset</code>, with each type at a
        fixed offset in the card&rsquo;s block of {MINORS_PER_CARD} — so the number encodes the card
        and the type, and the block is a real ceiling on how many PCM, MIDI and hwdep nodes a card
        can have. With dynamic minors, which is what a distribution ships, they come off a free list
        in registration order and encode nothing: a card plugged in later takes the numbers after
        the last one rather than a block of its own. The timer&rsquo;s 33 is the tell for the old
        scheme — it is the sequencer&rsquo;s offset inside the <em>second</em> card&rsquo;s block,
        which is why a static-minor machine&rsquo;s card 1 keeps its control at 32 and has nothing
        at 33.
      </p>
    </>
  );
}
