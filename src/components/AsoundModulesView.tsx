import { useMemo } from 'react';
import {
  describeModule,
  modprobeName,
  parseModules,
  SLOTS_DYNAMIC,
  SLOTS_PARAMETER,
  SLOTS_STATIC,
  summarize,
  type CardModule,
} from '../lib/asound-modules';

const SLOT_TITLE =
  `The index into snd_cards[], which is the card number everywhere else: /proc/asound/cards, the ` +
  `C and P lines of the timers file, the 00- of the pcm file, and hw:N. There are ${SLOTS_STATIC} ` +
  `slots without CONFIG_SND_DYNAMIC_MINORS and CONFIG_SND_MAX_CARDS — ${SLOTS_DYNAMIC} by ` +
  `default — with it`;

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function CardRow({ card, shared }: { card: CardModule; shared: boolean }) {
  const note = describeModule(card.module);

  return (
    <tr className={shared ? 'asndm__row asndm__row--shared' : 'asndm__row'}>
      <td className="asndm__number">
        <span title={SLOT_TITLE}>{card.slot}</span>
      </td>

      <td className="asndm__module">
        <span
          title={`card->module->name — the module that called snd_card_new. On disk it is ${modprobeName(card.module)}.ko, and the kernel folds the two spellings together`}
        >
          {card.module}
        </span>
        {shared && (
          <span
            className="chip chip--flag"
            title={`This module registered more than one card, so ${SLOTS_PARAMETER}= cannot tell them apart — it matches on the module name and both answer to it`}
          >
            two cards
          </span>
        )}
      </td>

      <td className="asndm__note">
        {note ?? (
          <span className="muted" title="A driver this page has no note for">
            —
          </span>
        )}
      </td>

      <td className="asndm__device">
        <span title="What a program opens to reach this card, which is the slot on the left">
          hw:{card.slot}
        </span>
      </td>
    </tr>
  );
}

export function AsoundModulesView({ content }: { content: string }) {
  const table = useMemo(() => parseModules(content), [content]);
  const summary = useMemo(() => summarize(table), [table]);
  const shared = useMemo(
    () => new Set(summary.shared.flatMap((entry) => entry.slots)),
    [summary],
  );

  /**
   * An empty file, which is an answer rather than a failure: the loop prints
   * the slots that are taken, and a machine with the sound core loaded and no
   * card has none.
   */
  if (table.cards.length === 0) {
    return (
      <p className="notice" role="status">
        No cards on this machine. The file lists one line per registered card — the slot it took and
        the module that registered it — so an empty file is a sound core with{' '}
        <strong>nothing under it</strong> rather than a read that failed. The file existing at all
        says the kernel has module support: <code>/proc/asound/cards</code> is created
        unconditionally and this one only where <code>CONFIG_MODULES</code> is.
      </p>
    );
  }

  return (
    <>
      {summary.shared.length > 0 && (
        <p className="notice notice--warn" role="status" data-testid="shared">
          {summary.shared
            .map((entry) => `${entry.module} registered ${entry.slots.length} cards`)
            .join('; ')}{' '}
          — slots {summary.shared.flatMap((entry) => entry.slots).join(' and ')}. That is the one
          arrangement <code>{SLOTS_PARAMETER}=</code> cannot pin: it reserves a slot for a{' '}
          <em>module name</em>, and both cards answer to the same one. Keeping{' '}
          <code>hw:0</code> where it is here means the driver&rsquo;s own <code>index=</code>{' '}
          parameter, matched on something that tells the two devices apart.
        </p>
      )}

      {summary.emptySlots.length > 0 && (
        <p className="notice" role="status" data-testid="gaps">
          Slot {summary.emptySlots.join(', ')}{' '}
          {summary.emptySlots.length === 1 ? 'is' : 'are'} empty below the cards above.
          Only taken slots are printed, so this is a slot reserved through{' '}
          <code>{SLOTS_PARAMETER}=</code> for a module that never loaded, or one freed by a card
          going away — the cards after it keep the numbers they already had, which is the whole
          point of a slot being an address rather than a position.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="cards" value={String(summary.cards)} />
        <Stat
          label="drivers"
          value={String(summary.modules.length)}
          title={`Distinct modules: ${summary.modules.join(', ')}`}
        />
        <Stat
          label="highest slot"
          value={summary.highestSlot === null ? '—' : String(summary.highestSlot)}
          title={SLOT_TITLE}
        />
      </section>

      <div className="card mounts asndm">
        <table className="mounts__table asndm__table" aria-label="Cards and their modules">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Module</th>
              <th scope="col">What it is</th>
              <th scope="col">Opened as</th>
            </tr>
          </thead>
          <tbody>
            {table.cards.map((card) => (
              <CardRow key={card.slot} card={card} shared={shared.has(card.slot)} />
            ))}
          </tbody>
        </table>
      </div>

      {summary.slotsOption !== null && (
        <p className="disks__note" data-testid="slots-option">
          To keep this order across reboots, that arrangement written as the core&rsquo;s own
          parameter is <code>options snd {summary.slotsOption}</code> — the modules in slot order,
          which is exactly what <code>{SLOTS_PARAMETER}=</code> takes.
        </p>
      )}

      <p className="disks__note muted">
        <strong>This is not the list of ALSA modules that are loaded</strong>, which is what the
        name suggests and what <code>lsmod</code> answers. The kernel walks{' '}
        <code>snd_cards[]</code> and prints, for each slot that holds a card, the module that{' '}
        <em>registered</em> it — so there is a line per card and never a line per module. The
        codec drivers behind an HD-Audio controller, the PCM core, the timer core and{' '}
        <code>snd</code> itself all appear in <code>/proc/modules</code> and none of them here,
        because none of them registered a card. Two more things read wrong at first glance.{' '}
        <strong>The number is a slot</strong>, the index into that array: the same number as in{' '}
        <code>/proc/asound/cards</code>, as the <code>C</code> and <code>P</code> lines of{' '}
        <code>/proc/asound/timers</code>, as the <code>00-</code> of <code>/proc/asound/pcm</code>{' '}
        and as <code>hw:0</code>. Only taken slots are printed, so gaps are ordinary and mean a
        slot reserved or released rather than a card missing. And{' '}
        <strong>the spelling is the kernel&rsquo;s</strong>: a module is{' '}
        <code>snd_hda_intel</code> here and <code>snd-hda-intel.ko</code> on disk, the two folded
        together — <code>module_slot_match</code> compares them with hyphens read as underscores,
        which is why <code>{SLOTS_PARAMETER}=</code> accepts either. That parameter is what this
        file is for: it reserves a slot for a named module, and this is where you see which module
        got which slot — the answer to why <code>hw:0</code> moved after a reboot.
      </p>
    </>
  );
}
