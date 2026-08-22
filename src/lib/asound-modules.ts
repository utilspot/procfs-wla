/**
 * Parser for `/proc/asound/modules`.
 *
 * One line per sound card, printed by `snd_card_module_info_read` in
 * `sound/core/init.c` as `"%2i %s\n"` over the card's slot and
 * `card->module->name`:
 *
 *    0 snd_hda_intel
 *    1 snd_usb_audio
 *
 * **It is not a list of the ALSA modules that are loaded**, which is what the
 * name suggests and what people read it as. The loop walks the `snd_cards[]`
 * array and prints, for each slot that holds a card, the module that
 * *registered* that card — one line per card, never one per module. On the
 * `desktop` capture here `/proc/modules` carries `snd_hda_intel`,
 * `snd_hda_codec`, `snd_pcm` and `snd`, and this file has a single line: the
 * codec drivers, the PCM core and the core itself registered no card, so none
 * of them is named. `lsmod` is the question this file is not answering.
 *
 * Two more things read wrong at first glance.
 *
 * **The number is the slot, not a line number.** It is the index into
 * `snd_cards[]` — the same number as in `/proc/asound/cards`, as the `C` and
 * `P` lines of `/proc/asound/timers`, as `00-00:` in `/proc/asound/pcm`, and as
 * the `hw:0` a program opens. Only occupied slots are printed, so the numbers
 * can skip: a slot reserved through the core's `slots=` parameter for a module
 * that never loaded, or freed by a card going away, leaves a gap and the cards
 * after it keep the slots they already had. How many slots there are is
 * `SNDRV_CARDS` — 8 without `CONFIG_SND_DYNAMIC_MINORS`, and
 * `CONFIG_SND_MAX_CARDS` (32 by default) with it.
 *
 * **The module name is the kernel's spelling, not the file's.** A module is
 * `snd_hda_intel` here and `snd-hda-intel.ko` on disk; the kernel treats the
 * two as one name — `module_slot_match` compares them with hyphens folded to
 * underscores — which is why `slots=` accepts either. See {@link modprobeName}.
 *
 * What the file is *for* is that `slots=` parameter: it reserves a slot for a
 * named module, and this file is where you see which module ended up in which
 * slot. That is how `hw:0` is kept from moving between boots — except when two
 * cards share a module, which `slots=` cannot tell apart, since it matches on
 * the name. See {@link slotsOption} and {@link sharedModules}.
 *
 * The file itself exists only where `CONFIG_MODULES` does: `snd_card_info_init`
 * creates `cards` unconditionally and this one inside an `#ifdef`, so a kernel
 * built without loadable module support has the first and not the second.
 */

/** The core parameter this file exists to make legible. */
export const SLOTS_PARAMETER = 'slots';

/** Slots without `CONFIG_SND_DYNAMIC_MINORS`, where the minor numbers fix it. */
export const SLOTS_STATIC = 8;

/** And the default with it, from `CONFIG_SND_MAX_CARDS`. */
export const SLOTS_DYNAMIC = 32;

/**
 * What some of the drivers that turn up here are. A module with no entry is
 * still shown — this is a note where there is one, not a list of what is
 * allowed.
 */
export const DRIVERS: Readonly<Record<string, string>> = {
  snd_hda_intel:
    "The HD-Audio controller driver. The codec modules behind it — snd_hda_codec_realtek and the rest — register no card of their own, so they never appear here",
  snd_usb_audio:
    'One module for every USB audio device, so two headsets are two cards under this one name',
  snd_intel8x0: "An older Intel AC'97 controller, which is also what many virtual machines emulate",
  snd_ens1371: "The Ensoniq AudioPCI, which is the card VMware's emulated audio presents as",
  snd_bcm2835: "The Raspberry Pi's on-board audio",
  snd_dummy: 'The dummy driver: a card with no hardware behind it at all',
  snd_aloop: 'The loopback driver, whose playback side comes out of its own capture side',
  snd_pcsp: 'The PC speaker, driven as a sound card',
};

export interface CardModule {
  /** The slot in `snd_cards[]`, which is the card number everything else uses. */
  slot: number;
  /** `card->module->name` — the module that registered this card. */
  module: string;
  raw: string;
}

export interface ModulesTable {
  cards: CardModule[];
}

/** ` 0 snd_hda_intel` — a right-aligned slot, a space, and the module. */
const LINE = /^(\d+)\s+(\S+)\s*$/;

/**
 * Parses the file. An empty file parses to no cards, which is what a machine
 * with the sound core loaded and nothing registered really prints.
 */
export function parseModules(text: string): ModulesTable {
  const cards: CardModule[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const match = LINE.exec(trimmed);
    if (match === null) continue;

    cards.push({ slot: Number(match[1]), module: match[2]!, raw: line.replace(/\s+$/, '') });
  }

  return { cards };
}

/** What this driver is, or null for one this page has no note for. */
export function describeModule(module: string): string | null {
  return DRIVERS[module] ?? null;
}

/**
 * How the module is spelled on disk and to `modprobe`: the kernel normalises
 * hyphens to underscores, so `snd_hda_intel` here is `snd-hda-intel.ko` there
 * and either spelling names the same module.
 */
export function modprobeName(module: string): string {
  return module.replace(/_/g, '-');
}

/** Whether a slot is empty between two that are not. */
export function hasGaps(table: ModulesTable): boolean {
  return table.cards.some((card, index) => card.slot !== index);
}

/** The empty slots below the highest card, which are what a gap is. */
export function emptySlots(table: ModulesTable): number[] {
  const taken = new Set(table.cards.map((card) => card.slot));
  const highest = table.cards.reduce((max, card) => Math.max(max, card.slot), -1);
  const empty: number[] = [];

  for (let slot = 0; slot < highest; slot++) {
    if (!taken.has(slot)) empty.push(slot);
  }

  return empty;
}

/** Every distinct module here, in the order the slots run. */
export function modulesOf(table: ModulesTable): string[] {
  const modules: string[] = [];

  for (const card of table.cards) {
    if (!modules.includes(card.module)) modules.push(card.module);
  }

  return modules;
}

/**
 * The modules that registered more than one card, with the slots they hold.
 * These are the cards `slots=` cannot pin apart: it matches on the module
 * name, and both of them answer to it.
 */
export function sharedModules(table: ModulesTable): { module: string; slots: number[] }[] {
  return modulesOf(table)
    .map((module) => ({
      module,
      slots: table.cards.filter((card) => card.module === module).map((card) => card.slot),
    }))
    .filter((entry) => entry.slots.length > 1);
}

/**
 * The `slots=` value that would pin this arrangement — the modules in slot
 * order, which is exactly what the parameter takes.
 *
 * Null where the slots are not filled from 0 upwards: the parameter is
 * positional, so an arrangement with a hole in it cannot be written down as a
 * plain list, and guessing at a spelling for the hole would be worse than
 * saying so.
 */
export function slotsOption(table: ModulesTable): string | null {
  if (table.cards.length === 0 || hasGaps(table)) return null;
  return `${SLOTS_PARAMETER}=${table.cards.map((card) => card.module).join(',')}`;
}

export interface ModulesSummary {
  cards: number;
  /** Distinct modules, which is fewer than the cards when two share one. */
  modules: string[];
  /** The highest slot in use, which says how far the numbering has run. */
  highestSlot: number | null;
  emptySlots: number[];
  shared: { module: string; slots: number[] }[];
  /** The `slots=` line that would pin this order, where one can be written. */
  slotsOption: string | null;
}

export function summarize(table: ModulesTable): ModulesSummary {
  return {
    cards: table.cards.length,
    modules: modulesOf(table),
    highestSlot:
      table.cards.length === 0
        ? null
        : table.cards.reduce((max, card) => Math.max(max, card.slot), 0),
    emptySlots: emptySlots(table),
    shared: sharedModules(table),
    slotsOption: slotsOption(table),
  };
}
