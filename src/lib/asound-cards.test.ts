import { describe, expect, it } from 'vitest';
import { readAsoundCardsFixture as fixture } from '../test/fixtures';
import {
  DEFAULT_ID,
  deviceNameOf,
  driversOf,
  DRIVER_MAX,
  hasDefaultId,
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
} from './asound-cards';

describe('parseCards — one card, two lines', () => {
  const table = parseCards(fixture('desktop'));
  const card = table.cards[0]!;

  /** The record is a pair of lines, which no other file here has. */
  it('reads the pair of lines as one card', () => {
    expect(table.cards).toHaveLength(1);
    expect(card).toMatchObject({
      slot: 0,
      id: 'PCH',
      driver: 'HDA-Intel',
      shortname: 'HDA Intel PCH',
      longname: 'HDA Intel PCH at 0xf7f60000 irq 145',
    });
  });

  it('keeps both lines in the raw record', () => {
    expect(card.raw.split('\n')).toHaveLength(2);
    expect(card.raw).toContain('[PCH            ]');
  });

  /** The padding inside the brackets is the file's, not part of the id. */
  it('takes the %-15s padding off the id', () => {
    expect(card.id).toBe('PCH');
    expect(isIdFull(card)).toBe(false);
    expect(ID_MAX).toBe(15);
  });

  /** The id is the handle that does not move; the slot is the one that does. */
  it('names the card both ways', () => {
    expect(deviceNameOf(card)).toBe('hw:PCH');
    expect(slotNameOf(card)).toBe('hw:0');
  });

  /** And the driver is not the module: /proc/asound/modules says snd_hda_intel. */
  it('reads the driver as its own class name', () => {
    expect(driversOf(table)).toEqual(['HDA-Intel']);
    expect(card.driver).not.toContain('snd_');
  });

  it('reads the long name as saying more than the short one', () => {
    expect(longnameAdds(card)).toBe(true);
    expect(card.longname).toContain('irq 145');
  });

  it('summarizes the machine as one card with nothing odd about it', () => {
    expect(summarize(table)).toMatchObject({
      cards: 1,
      drivers: ['HDA-Intel'],
      noSoundcards: false,
      suffixed: [],
      colliding: [],
      defaulted: [],
      highestSlot: 0,
    });
  });
});

describe('parseCards — a name the field could not hold', () => {
  const table = parseCards(fixture('raspberry-pi'));
  const card = table.cards[0]!;

  /** `bcm2835_headphones` does not fit in the 15 characters driver[16] has. */
  it('reads a driver name cut to the width of its field', () => {
    expect(card.driver).toBe('bcm2835_headpho');
    expect(card.driver).toHaveLength(DRIVER_MAX);
    expect(isDriverCut(card)).toBe(true);
  });

  /** A longname that repeats the shortname adds nothing, and often does. */
  it('reads a long name that says no more than the short one', () => {
    expect(card.longname).toBe(card.shortname);
    expect(longnameAdds(card)).toBe(false);
  });
});

describe('parseCards — two of the same device', () => {
  const table = parseCards(fixture('two-of-a-kind'));

  /** The suffix is counted in hex, so _A follows _9. */
  it('finds the suffix ALSA appends to keep two ids apart', () => {
    expect(uniquifierOf(table.cards[1]!)).toEqual({ base: 'Device', suffix: '1' });
    expect(uniquifierOf(table.cards[0]!)).toBeNull();
    expect(summarize(table).suffixed.map((card) => card.id)).toEqual(['Device_1']);
  });

  /** Which is forced by the collision the shortnames show. */
  it('reads the collision behind the suffix', () => {
    expect(sharesShortname(table, table.cards[0]!)).toBe(true);
    expect(summarize(table).colliding).toHaveLength(2);
  });

  /** The ids cannot tell them apart; the long names can. */
  it('keeps the bus address that is the only thing telling them apart', () => {
    expect(table.cards[0]!.longname).toContain('usb-0000:00:14.0-2');
    expect(table.cards[1]!.longname).toContain('usb-0000:00:14.0-4');
    expect(table.cards[0]!.shortname).toBe(table.cards[1]!.shortname);
  });
});

describe('parseCards — a second card in the next slot', () => {
  const table = parseCards(fixture('two-cards'));

  it('reads a card per record, in slot order', () => {
    expect(table.cards.map((card) => [card.slot, card.id])).toEqual([
      [0, 'PCH'],
      [1, 'Headset'],
    ]);
    expect(driversOf(table)).toEqual(['HDA-Intel', 'USB-Audio']);
    expect(summarize(table).highestSlot).toBe(1);
  });

  it('says nothing about collisions between two different cards', () => {
    expect(summarize(table)).toMatchObject({ colliding: [], suffixed: [] });
  });
});

describe('parseCards — an id that nearly fills the field', () => {
  const table = parseCards(fixture('emulated'));
  const card = table.cards[0]!;

  it('reads a long id and a three-letter driver off one line', () => {
    expect(card).toMatchObject({ id: 'I82801AAICH', driver: 'ICH' });
    expect(card.longname).toContain('AD1980');
  });
});

describe('parseCards — no cards at all', () => {
  const table = parseCards(fixture('no-soundcards'));

  /** The kernel says so in words, where pcm and modules just come back empty. */
  it('reads the sentinel rather than treating the file as empty', () => {
    expect(table.noSoundcards).toBe(true);
    expect(table.cards).toEqual([]);
    expect(summarize(table)).toMatchObject({ cards: 0, noSoundcards: true, highestSlot: null });
    expect(NO_SOUNDCARDS).toBe('--- no soundcards ---');
  });
});

describe('parseCards — lines that are not the ordinary ones', () => {
  /** An id of exactly 15 leaves no gap before the bracket. */
  it('reads an id that fills the field', () => {
    const table = parseCards(' 0 [ABCDEFGHIJKLMNO]: Driver - Short name\n');

    expect(table.cards[0]!.id).toBe('ABCDEFGHIJKLMNO');
    expect(isIdFull(table.cards[0]!)).toBe(true);
  });

  /** The split is at the first separator, so a dash in the name survives. */
  it('keeps a dash inside the short name', () => {
    const table = parseCards(' 0 [X              ]: USB-Audio - Scarlett 2i2 - USB\n');

    expect(table.cards[0]).toMatchObject({
      driver: 'USB-Audio',
      shortname: 'Scarlett 2i2 - USB',
    });
  });

  it('reads the fallback id a card with no usable name gets', () => {
    const table = parseCards(
      ' 0 [Default        ]: USB-Audio - USB Audio\n' +
        '                      USB Audio at usb-0000:00:14.0-1\n' +
        ' 1 [Default_1      ]: USB-Audio - USB Audio\n' +
        '                      USB Audio at usb-0000:00:14.0-2\n',
    );

    expect(table.cards.every(hasDefaultId)).toBe(true);
    expect(summarize(table).defaulted).toHaveLength(2);
    expect(DEFAULT_ID).toBe('Default');
  });

  it('reads a card whose second line never came', () => {
    const table = parseCards(' 0 [PCH            ]: HDA-Intel - HDA Intel PCH\n');

    expect(table.cards[0]!.longname).toBeNull();
    expect(longnameAdds(table.cards[0]!)).toBe(false);
  });

  /** Two records in a row, so the second line has to go to the right card. */
  it('gives each long name to the card above it', () => {
    const table = parseCards(fixture('two-cards'));

    expect(table.cards[0]!.longname).toContain('0xf7f60000');
    expect(table.cards[1]!.longname).toContain('Jabra');
  });

  it('reads no cards out of a file that is not this one', () => {
    expect(parseCards('').cards).toEqual([]);
    expect(parseCards(' 0 snd_hda_intel\n').cards).toEqual([]);
    expect(parseCards('  1:        : sequencer\n').cards).toEqual([]);
  });
});
