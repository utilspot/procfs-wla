import { describe, expect, it } from 'vitest';
import { readAsoundModulesFixture as fixture } from '../test/fixtures';
import {
  describeModule,
  emptySlots,
  hasGaps,
  modprobeName,
  modulesOf,
  parseModules,
  sharedModules,
  slotsOption,
  SLOTS_DYNAMIC,
  SLOTS_STATIC,
  summarize,
} from './asound-modules';

describe('parseModules — one card', () => {
  const table = parseModules(fixture('desktop'));

  /** The slot is right-aligned in two columns, and the space is the format's. */
  it('reads the slot and the module out of the line', () => {
    expect(table.cards).toEqual([
      { slot: 0, module: 'snd_hda_intel', raw: ' 0 snd_hda_intel' },
    ]);
  });

  /**
   * One line per *card*, not per module: the codec drivers and the cores are
   * loaded on this machine and registered no card, so they are not here.
   */
  it('names the module that registered the card and no other', () => {
    expect(modulesOf(table)).toEqual(['snd_hda_intel']);
    expect(describeModule('snd_hda_intel')).toMatch(/codec modules behind it/);
    expect(describeModule('snd_hda_codec_realtek')).toBeNull();
  });

  it('spells the module for modprobe as well as for the kernel', () => {
    expect(modprobeName('snd_hda_intel')).toBe('snd-hda-intel');
    expect(modprobeName('snd_bcm2835')).toBe('snd-bcm2835');
  });

  it('summarizes the machine as one card in the first slot', () => {
    expect(summarize(table)).toMatchObject({
      cards: 1,
      modules: ['snd_hda_intel'],
      highestSlot: 0,
      emptySlots: [],
      shared: [],
      slotsOption: 'slots=snd_hda_intel',
    });
  });
});

describe('parseModules — a second card', () => {
  const table = parseModules(fixture('usb-headset'));

  it('reads a card per slot, in the order the slots run', () => {
    expect(table.cards.map((card) => [card.slot, card.module])).toEqual([
      [0, 'snd_hda_intel'],
      [1, 'snd_usb_audio'],
    ]);
  });

  /** Which is what the parameter this file exists for takes. */
  it('writes the arrangement out as the slots= that would pin it', () => {
    expect(slotsOption(table)).toBe('slots=snd_hda_intel,snd_usb_audio');
  });

  it('finds no gap where the slots run from 0', () => {
    expect(hasGaps(table)).toBe(false);
    expect(emptySlots(table)).toEqual([]);
  });
});

describe('parseModules — two cards on one module', () => {
  const table = parseModules(fixture('two-of-a-kind'));

  /** The one arrangement `slots=` cannot pin, since it matches on the name. */
  it('finds the module that registered more than one card', () => {
    expect(sharedModules(table)).toEqual([{ module: 'snd_usb_audio', slots: [0, 1] }]);
    expect(modulesOf(table)).toEqual(['snd_usb_audio']);
  });

  it('counts two cards against one driver', () => {
    expect(summarize(table)).toMatchObject({ cards: 2, modules: ['snd_usb_audio'] });
  });
});

describe('parseModules — a slot standing empty', () => {
  const table = parseModules(fixture('pinned-slots'));

  /** Only taken slots are printed, so a gap is a slot rather than a card. */
  it('reads the hole between the two cards', () => {
    expect(table.cards.map((card) => card.slot)).toEqual([0, 2]);
    expect(hasGaps(table)).toBe(true);
    expect(emptySlots(table)).toEqual([1]);
    expect(summarize(table).highestSlot).toBe(2);
  });

  /** The parameter is positional, so an arrangement with a hole has no line. */
  it('refuses to write a slots= line it cannot spell', () => {
    expect(slotsOption(table)).toBeNull();
  });
});

describe('parseModules — a machine with no card', () => {
  const table = parseModules(fixture('no-cards'));

  it('reads an empty file as no cards rather than as a failure', () => {
    expect(table.cards).toEqual([]);
    expect(summarize(table)).toMatchObject({
      cards: 0,
      modules: [],
      highestSlot: null,
      emptySlots: [],
      slotsOption: null,
    });
  });
});

describe('parseModules — lines that are not the ordinary ones', () => {
  it('reads a two-digit slot, where the padding stops helping', () => {
    const table = parseModules('10 snd_usb_audio\n');

    expect(table.cards[0]).toMatchObject({ slot: 10, module: 'snd_usb_audio' });
  });

  it('reads a slot high in the range the kernel allows', () => {
    const table = parseModules(`${SLOTS_DYNAMIC - 1} snd_dummy\n`);

    expect(table.cards[0]!.slot).toBe(31);
    expect(SLOTS_STATIC).toBe(8);
  });

  it('reads a driver whose name is not one of the ones noted here', () => {
    const table = parseModules(' 0 snd_soc_rockchip_i2s\n');

    expect(table.cards[0]!.module).toBe('snd_soc_rockchip_i2s');
    expect(describeModule('snd_soc_rockchip_i2s')).toBeNull();
    expect(modprobeName('snd_soc_rockchip_i2s')).toBe('snd-soc-rockchip-i2s');
  });

  it('reads no cards out of a file that is not this one', () => {
    expect(parseModules('').cards).toEqual([]);
    expect(parseModules('\n\n').cards).toEqual([]);
    expect(parseModules('00-00: ALC256 Analog : ALC256 Analog : playback 1\n').cards).toEqual([]);
  });

  /** The listing in `cards` wraps onto a second line; this file never does. */
  it('ignores a line with no module on it', () => {
    expect(parseModules(' 0\n').cards).toEqual([]);
  });
});
