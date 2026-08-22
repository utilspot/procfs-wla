/**
 * Parser for `/proc/asound/cards`.
 *
 * Every registered sound card, **two lines each**, printed by
 * `snd_card_info_read` in `sound/core/init.c`:
 *
 *    0 [PCH            ]: HDA-Intel - HDA Intel PCH
 *                         HDA Intel PCH at 0xf7f60000 irq 145
 *
 * The first is `"%2i [%-15s]: %s - %s\n"` over the slot, `card->id`,
 * `card->driver` and `card->shortname`; the second is 22 spaces and
 * `card->longname`. It is the only file in `/proc/asound` whose record is more
 * than a line, which is the first thing to know about reading it.
 *
 * The second thing is that **a card with nothing to say is not silence**: with
 * no card registered the printer writes `--- no soundcards ---` rather than
 * nothing, so an empty file here is a failed read where an empty
 * `/proc/asound/pcm` is an answer. See {@link NO_SOUNDCARDS}.
 *
 * Then the fields, which are four names for one card and none of them the
 * module that registered it — that is `/proc/asound/modules`, and it says
 * `snd_hda_intel` where this file says `HDA-Intel`.
 *
 * - **`id`** is the card's name as a *word*: what `hw:PCH` means, and the one
 *   handle here that does not move when the slots do. `snd_card_set_id_no_lock`
 *   builds it from the `id=` module parameter if there is one and from the
 *   shortname otherwise, keeping only characters that make a valid identifier.
 *   Two rules of it show up in real files. An id that would be empty or would
 *   start with `card` becomes **`Default`** — the second because it would
 *   collide with the `/proc/asound/card0` directories. And a **duplicate gets a
 *   suffix**, `_1`, `_2` and so on — printed with `%X`, so the eleventh is
 *   `_B` rather than `_11`. See {@link uniquifierOf}.
 * - **`driver`** is the driver's own class name, and 15 characters is all of it
 *   that fits: a Raspberry Pi's `bcm2835_headphones` comes out as
 *   `bcm2835_headpho`. ALSA's userspace configuration keys off this string,
 *   which is why it reads like a class rather than a device.
 * - **`shortname`** and **`longname`** are the human names, 31 and 79
 *   characters. The long one usually repeats the short one and adds where the
 *   hardware is — an address and an IRQ for a PCI card, a bus path for USB —
 *   which is what tells two identical devices apart when their ids cannot.
 *
 * The `%-15s` padding is the file's own: an id shorter than 15 is padded out to
 * the `]`, and one of exactly 15 leaves no gap at all.
 */

/** What the printer writes when no card is registered at all. */
export const NO_SOUNDCARDS = '--- no soundcards ---';

/** Characters of each field that survive, from the sizes in `struct snd_card`. */
export const ID_MAX = 15;
export const DRIVER_MAX = 15;
export const SHORTNAME_MAX = 31;
export const LONGNAME_MAX = 79;

/** The id given to a card whose own would be empty or start with `card`. */
export const DEFAULT_ID = 'Default';

export interface Card {
  /** The slot in `snd_cards[]`, which is the number every ALSA name uses. */
  slot: number;
  /** `card->id` — the card as a word, which is what `hw:<id>` names. */
  id: string;
  /** `card->driver` — the driver's class name, cut to what the field holds. */
  driver: string;
  /** `card->shortname` — the human name. */
  shortname: string;
  /** `card->longname` — the same, plus where the hardware is. Null if unprinted. */
  longname: string | null;
  /** Both lines, as they were read. */
  raw: string;
}

export interface CardsTable {
  cards: Card[];
  /** Whether the kernel printed its own "no soundcards" line. */
  noSoundcards: boolean;
}

/** ` 0 [PCH            ]: HDA-Intel - HDA Intel PCH` */
const HEADER = /^(\d+)\s+\[(.*?)\s*\]:\s*(.*)$/;

/** What separates the driver from the shortname on that line. */
const SEPARATOR = ' - ';

/** Parses the file, which is two lines per card and a sentinel for none. */
export function parseCards(text: string): CardsTable {
  const cards: Card[] = [];
  let noSoundcards = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    if (trimmed === NO_SOUNDCARDS) {
      noSoundcards = true;
      continue;
    }

    const header = HEADER.exec(trimmed);
    if (header !== null) {
      // The driver holds no spaces in practice, and the shortname may hold a
      // dash, so the split is at the *first* separator rather than the last.
      const rest = header[3]!;
      const at = rest.indexOf(SEPARATOR);

      cards.push({
        slot: Number(header[1]),
        id: header[2]!,
        driver: at === -1 ? rest.trim() : rest.slice(0, at).trim(),
        shortname: at === -1 ? '' : rest.slice(at + SEPARATOR.length).trim(),
        longname: null,
        raw: line.replace(/\s+$/, ''),
      });
      continue;
    }

    // Anything else belongs to the card above it: the kernel prints exactly one
    // such line per card, indented, and nothing else is unindented prose.
    const card = cards[cards.length - 1];
    if (card !== undefined && card.longname === null) {
      card.longname = trimmed;
      card.raw = `${card.raw}\n${line.replace(/\s+$/, '')}`;
    }
  }

  return { cards, noSoundcards };
}

/** What a program opens to reach this card by name rather than by number. */
export function deviceNameOf(card: Card): string {
  return `hw:${card.id}`;
}

/** And by number, which is the slot and moves when the cards do. */
export function slotNameOf(card: Card): string {
  return `hw:${card.slot}`;
}

/**
 * The suffix ALSA appends to keep two ids apart, if this id looks like it has
 * one: `_1`, `_2`, … printed with `%X`, so `_A` follows `_9`. A card whose own
 * name really ends that way is indistinguishable from here, which is why this
 * is a reading rather than a fact — {@link sharesShortname} is what says the
 * collision actually happened.
 */
export function uniquifierOf(card: Card): { base: string; suffix: string } | null {
  const match = /^(.*)_([0-9A-F]{1,3})$/.exec(card.id);
  return match === null ? null : { base: match[1]!, suffix: match[2]! };
}

/** Whether the card fell back to the id given to one that could not have its own. */
export function hasDefaultId(card: Card): boolean {
  return card.id === DEFAULT_ID || uniquifierOf(card)?.base === DEFAULT_ID;
}

/** Whether the id fills the field, where a longer one would have been cut. */
export function isIdFull(card: Card): boolean {
  return card.id.length === ID_MAX;
}

/** Whether the driver name fills its field, so it may be the front of a longer one. */
export function isDriverCut(card: Card): boolean {
  return card.driver.length === DRIVER_MAX;
}

/** Whether the long name says more than the short one, which it need not. */
export function longnameAdds(card: Card): boolean {
  return card.longname !== null && card.longname !== card.shortname;
}

/** Whether another card here has the same shortname, which is what forces a suffix. */
export function sharesShortname(table: CardsTable, card: Card): boolean {
  return table.cards.some(
    (other) => other !== card && other.shortname === card.shortname && card.shortname !== '',
  );
}

/** The distinct drivers, in the order the slots run. */
export function driversOf(table: CardsTable): string[] {
  const drivers: string[] = [];

  for (const card of table.cards) {
    if (!drivers.includes(card.driver)) drivers.push(card.driver);
  }

  return drivers;
}

export interface CardsSummary {
  cards: number;
  drivers: string[];
  noSoundcards: boolean;
  /** Cards whose id carries the suffix that keeps a duplicate apart. */
  suffixed: Card[];
  /** Cards sharing a shortname, which is the collision behind those suffixes. */
  colliding: Card[];
  /** Cards that fell back to `Default`, having no usable name of their own. */
  defaulted: Card[];
  highestSlot: number | null;
}

export function summarize(table: CardsTable): CardsSummary {
  return {
    cards: table.cards.length,
    drivers: driversOf(table),
    noSoundcards: table.noSoundcards,
    suffixed: table.cards.filter((card) => uniquifierOf(card) !== null),
    colliding: table.cards.filter((card) => sharesShortname(table, card)),
    defaulted: table.cards.filter(hasDefaultId),
    highestSlot:
      table.cards.length === 0
        ? null
        : table.cards.reduce((max, card) => Math.max(max, card.slot), 0),
  };
}
