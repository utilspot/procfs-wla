import { useMemo } from 'react';
import {
  DEFAULT_ID,
  deviceNameOf,
  DRIVER_MAX,
  ID_MAX,
  isDriverCut,
  isIdFull,
  longnameAdds,
  NO_SOUNDCARDS,
  parseCards,
  sharesShortname,
  slotNameOf,
  summarize,
  uniquifierOf,
  type Card,
  type CardsTable,
} from '../lib/asound-cards';

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function CardRow({ card, table }: { card: Card; table: CardsTable }) {
  const suffix = uniquifierOf(card);
  const collides = sharesShortname(table, card);

  return (
    <tr className={collides ? 'asndc__row asndc__row--collides' : 'asndc__row'}>
      <td className="asndc__number">
        <span title={`Slot ${card.slot} in snd_cards[], which is the number in hw:${card.slot} and in every other ALSA name`}>
          {card.slot}
        </span>
      </td>

      <td className="asndc__id">
        <span
          title={`card->id — the card as a word, which is what ${deviceNameOf(card)} names${
            isIdFull(card) ? `. It fills the ${ID_MAX} characters the field holds, so a longer name would have been cut` : ''
          }`}
        >
          {card.id}
        </span>
        {suffix !== null && (
          <span
            className="chip chip--flag"
            title={`ALSA appends a suffix to keep two ids apart, counted in hex — _1, _2, … _A after _9. The name it was built from is ${suffix.base}`}
          >
            suffixed
          </span>
        )}
      </td>

      <td className="asndc__driver">
        <span
          title={`card->driver — the driver's own class name, which ALSA's userspace configuration keys off${
            isDriverCut(card) ? `. It fills the ${DRIVER_MAX} characters the field holds, so this may be the front of a longer name` : ''
          }`}
        >
          {card.driver}
        </span>
        {isDriverCut(card) && (
          <span className="chip" title={`${DRIVER_MAX} characters, which is the whole field`}>
            cut
          </span>
        )}
      </td>

      <td className="asndc__names">
        <span className="asndc__short" title="card->shortname, the human name">
          {card.shortname === '' ? '—' : card.shortname}
        </span>
        {longnameAdds(card) ? (
          <span
            className="asndc__long"
            title="card->longname, which is the short name plus where the hardware is — an address and an IRQ, or a bus path"
          >
            {card.longname}
          </span>
        ) : (
          <span className="asndc__long muted" title="The long name says no more than the short one">
            {card.longname === null ? 'no second line' : 'same again'}
          </span>
        )}
      </td>

      <td className="asndc__open">
        <span title="The card by name, which does not move when the slots do">
          {deviceNameOf(card)}
        </span>
        <span className="muted" title="And by number, which does">
          {slotNameOf(card)}
        </span>
      </td>
    </tr>
  );
}

export function AsoundCardsView({ content }: { content: string }) {
  const table = useMemo(() => parseCards(content), [content]);
  const summary = useMemo(() => summarize(table), [table]);

  /** The kernel's own way of saying the array is empty, which is not silence. */
  if (summary.noSoundcards && summary.cards === 0) {
    return (
      <p className="notice" role="status" data-testid="no-soundcards">
        <code>{NO_SOUNDCARDS}</code> — the kernel&rsquo;s own words. With nothing registered the
        printer writes that line rather than nothing, so this is a machine whose sound core is
        loaded and has <strong>no card under it</strong>, said plainly. It is worth knowing that
        this file alone answers that way: an empty <code>/proc/asound/pcm</code> means the same
        thing with no line at all.
      </p>
    );
  }

  if (table.cards.length === 0) {
    return (
      <p className="notice notice--warn">
        No cards in this file, and not the <code>{NO_SOUNDCARDS}</code> the kernel prints when there
        are none — so this is the read failing rather than the machine having nothing. Switch to the
        raw view to see what the server returned.
      </p>
    );
  }

  return (
    <>
      {summary.colliding.length > 0 && (
        <p className="notice" role="status" data-testid="colliding">
          {summary.colliding.length} cards share the name{' '}
          <strong>{summary.colliding[0]?.shortname}</strong>, so ALSA gave{' '}
          {summary.suffixed.length === 1 ? 'one of them' : 'them'} a suffix to keep the ids apart —{' '}
          {summary.suffixed.map((card) => card.id).join(', ') || 'none of them yet'}. The count is
          printed with <code>%X</code>, so an eleventh card would be <code>_B</code> rather than{' '}
          <code>_11</code>. Which of these is which is not in the ids at all: the long names are
          where the bus address is, and that is what tells two identical devices apart.
        </p>
      )}

      {summary.defaulted.length > 0 && (
        <p className="notice" role="status" data-testid="defaulted">
          {summary.defaulted.length === 1 ? 'A card is' : 'Cards are'} named{' '}
          <code>{DEFAULT_ID}</code>, which is the id ALSA falls back to when a card&rsquo;s own
          would be empty or would start with <code>card</code> — the second because it would collide
          with the <code>/proc/asound/card0</code> directories.
        </p>
      )}

      <section className="summary" data-testid="summary">
        <Stat label="cards" value={String(summary.cards)} />
        <Stat
          label="drivers"
          value={String(summary.drivers.length)}
          title={`Distinct driver names: ${summary.drivers.join(', ')}`}
        />
        <Stat
          label="highest slot"
          value={summary.highestSlot === null ? '—' : String(summary.highestSlot)}
          title="The slot numbering, which is what /proc/asound/modules pins with slots="
        />
      </section>

      <div className="card mounts asndc">
        <table className="mounts__table asndc__table" aria-label="Sound cards">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Id</th>
              <th scope="col">Driver</th>
              <th scope="col">Name</th>
              <th scope="col">Opened as</th>
            </tr>
          </thead>
          <tbody>
            {table.cards.map((card) => (
              <CardRow key={card.slot} card={card} table={table} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="disks__note muted">
        This is the only file in <code>/proc/asound</code> whose record is{' '}
        <strong>two lines</strong>: the kernel prints{' '}
        <code>&quot;%2i [%-15s]: %s - %s\n&quot;</code> and then 22 spaces and the long name, so a
        card is a pair of lines and the padding inside the brackets is the file&rsquo;s own. It
        gives one card four names, and <strong>none of them is the module that registered it</strong>{' '}
        — that is <code>/proc/asound/modules</code>, which says <code>snd_hda_intel</code> where
        this file says <code>HDA-Intel</code>. <strong>The id is the useful one</strong>: it is the
        card as a word, what <code>hw:PCH</code> means, and the one handle here that does not move
        when the slots do — set it with a driver&rsquo;s <code>id=</code> parameter and a card keeps
        its name wherever it lands, where the core&rsquo;s <code>slots=</code> pins the number
        instead. ALSA builds it from the short name when nothing set it, keeps only what makes a
        valid identifier, falls back to <code>{DEFAULT_ID}</code> for a name that would be empty or
        start with <code>card</code>, and appends <code>_1</code>, <code>_2</code>, … in{' '}
        <em>hex</em> to keep duplicates apart. <strong>The driver is a class name</strong>, and the{' '}
        {DRIVER_MAX} characters the field holds are all of it — a Pi&rsquo;s{' '}
        <code>bcm2835_headphones</code> arrives as <code>bcm2835_headpho</code> — which matters
        because ALSA&rsquo;s userspace configuration keys off that string. And{' '}
        <strong>the long name is where the hardware is</strong>: the short name repeated, plus an
        address and an IRQ or a USB bus path, which is the only thing here that tells two identical
        devices apart. Finally, with no card at all this file says so in words —{' '}
        <code>{NO_SOUNDCARDS}</code> — where <code>pcm</code> and <code>modules</code> beside it
        simply come back empty.
      </p>
    </>
  );
}
