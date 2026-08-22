import { describe, expect, it } from 'vitest';
import { readAsoundDevicesFixture as fixture } from '../test/fixtures';
import {
  cardsOf,
  describeType,
  devicesOfCard,
  devicesOfType,
  isGlobal,
  minorScheme,
  MINORS,
  MINORS_PER_CARD,
  nodeOf,
  parseDevices,
  pathOf,
  SOUND_MAJOR,
  staticMinorOf,
  summarize,
  type SoundDevice,
} from './asound-devices';

/** The line for this minor, which is what the file is keyed by. */
const at = (devices: SoundDevice[], minor: number): SoundDevice =>
  devices.find((device) => device.minor === minor)!;

describe('parseDevices — an ordinary desktop', () => {
  const table = parseDevices(fixture('desktop'));

  /** Three line shapes, by how much of a card the device belongs to. */
  it('reads the card and the device out of the shape of the line', () => {
    expect(at(table.devices, 2)).toMatchObject({
      card: 0,
      device: 0,
      type: 'digital audio playback',
    });
    expect(at(table.devices, 6)).toMatchObject({ card: 0, device: null, type: 'control' });
    expect(at(table.devices, 1)).toMatchObject({ card: null, device: null, type: 'sequencer' });
  });

  /** The two with no card are the core's, and their minors never move. */
  it('reads the sequencer and the timer as belonging to no card', () => {
    expect(isGlobal(at(table.devices, 1))).toBe(true);
    expect(isGlobal(at(table.devices, 33))).toBe(true);
    expect(isGlobal(at(table.devices, 2))).toBe(false);
    expect(summarize(table).global.map((device) => device.minor)).toEqual([1, 33]);
  });

  /** Which is what the file is for: the node a program actually opens. */
  it('builds the /dev/snd node back from the type and the numbers', () => {
    expect(pathOf(at(table.devices, 2))).toBe('/dev/snd/pcmC0D0p');
    expect(pathOf(at(table.devices, 3))).toBe('/dev/snd/pcmC0D0c');
    expect(pathOf(at(table.devices, 5))).toBe('/dev/snd/pcmC0D7p');
    expect(pathOf(at(table.devices, 6))).toBe('/dev/snd/controlC0');
    expect(pathOf(at(table.devices, 1))).toBe('/dev/snd/seq');
    expect(pathOf(at(table.devices, 33))).toBe('/dev/snd/timer');
  });

  /** A distribution kernel allocates them, so they are not where a formula says. */
  it('reads minors that are not where the static formula would put them', () => {
    expect(staticMinorOf(at(table.devices, 2))).toBe(16);
    expect(staticMinorOf(at(table.devices, 6))).toBe(0);
    expect(minorScheme(table)).toBe('dynamic');
  });

  it('summarizes the machine as nodes, cards and PCM devices', () => {
    expect(summarize(table)).toMatchObject({
      devices: 7,
      cards: [0],
      scheme: 'dynamic',
      highestMinor: 33,
      unknownTypes: [],
    });
    expect(summarize(table).pcm).toHaveLength(4);
    expect(devicesOfCard(table, 0)).toHaveLength(5);
  });
});

describe('parseDevices — a computed minor', () => {
  const table = parseDevices(fixture('static-minors'));

  /** `(card << 5) | offset`, with a fixed offset per type. */
  it('finds every minor where the static formula puts it', () => {
    expect(staticMinorOf(at(table.devices, 0))).toBe(0);
    expect(staticMinorOf(at(table.devices, 8))).toBe(8);
    expect(staticMinorOf(at(table.devices, 16))).toBe(16);
    expect(staticMinorOf(at(table.devices, 24))).toBe(24);
    expect(minorScheme(table)).toBe('static');
  });

  /** A second card takes the next block of 32 rather than the next number. */
  it('reads a second card as a block above the first', () => {
    expect(at(table.devices, 32)).toMatchObject({ card: 1, device: null, type: 'control' });
    expect(staticMinorOf(at(table.devices, 48))).toBe(48);
    expect(48).toBe((1 << 5) + 16);
    expect(cardsOf(table)).toEqual([0, 1]);
  });

  /** The timer sits in the sequencer's offset of the second card's block. */
  it('keeps the timer at 33 even where a card owns that block', () => {
    expect(at(table.devices, 33)).toMatchObject({ card: null, type: 'timer' });
    expect(staticMinorOf(at(table.devices, 33))).toBe(33);
    expect(33).toBe((1 << 5) + 1);
  });
});

describe('parseDevices — substreams are not devices', () => {
  const table = parseDevices(fixture('raspberry-pi'));

  /** The pcm file gives this device four substreams; here it is one node. */
  it('gives one PCM device one node however many substreams it has', () => {
    expect(devicesOfType(table, 'digital audio playback')).toHaveLength(1);
    expect(pathOf(table.devices[1]!)).toBe('/dev/snd/pcmC0D0p');
  });
});

describe('parseDevices — the types a card can register', () => {
  const table = parseDevices(fixture('midi-and-hwdep'));

  it('names the MIDI and hardware-dependent nodes', () => {
    expect(pathOf(at(table.devices, 4))).toBe('/dev/snd/midiC0D0');
    expect(pathOf(at(table.devices, 5))).toBe('/dev/snd/hwC0D0');
    expect(describeType('raw midi')?.note).toMatch(/umpC/);
  });

  it('knows where each type sits in a card’s block', () => {
    expect(describeType('raw midi')?.staticBase).toBe(8);
    expect(describeType('hardware dependent')?.staticBase).toBe(4);
    expect(describeType('compress')?.staticBase).toBe(2);
  });
});

describe('parseDevices — a machine with no card', () => {
  const table = parseDevices(fixture('no-cards'));

  /** Unlike pcm and modules, this file is not empty without a card. */
  it('still lists the two the core registers for itself', () => {
    expect(table.devices.map((device) => device.type)).toEqual(['sequencer', 'timer']);
    expect(summarize(table)).toMatchObject({ devices: 2, cards: [], scheme: 'static' });
    expect(summarize(table).pcm).toEqual([]);
  });
});

describe('parseDevices — lines that are not the ordinary ones', () => {
  it('reads a type the kernel’s own printer could not name', () => {
    const table = parseDevices('  9: [ 0- 0]: ?\n');

    expect(table.devices[0]).toMatchObject({ minor: 9, card: 0, device: 0, type: '?' });
    expect(describeType('?')).toBeNull();
    expect(nodeOf(table.devices[0]!)).toBeNull();
    expect(staticMinorOf(table.devices[0]!)).toBeNull();
    expect(summarize(table)).toMatchObject({ scheme: 'unknown', unknownTypes: ['?'] });
  });

  it('reads the wide fields a two-digit card and device print', () => {
    const table = parseDevices(' 96: [ 3-12]: digital audio capture\n');

    expect(table.devices[0]).toMatchObject({ minor: 96, card: 3, device: 12 });
    expect(pathOf(table.devices[0]!)).toBe('/dev/snd/pcmC3D12c');
  });

  it('reads a minor at the top of the range ALSA has', () => {
    const table = parseDevices(`${MINORS - 1}: [ 7]   : control\n`);

    expect(table.devices[0]!.minor).toBe(255);
    expect(MINORS_PER_CARD * 8).toBe(MINORS);
    expect(SOUND_MAJOR).toBe(116);
  });

  it('reads no devices out of a file that is not this one', () => {
    expect(parseDevices('').devices).toEqual([]);
    expect(parseDevices(' 0 snd_hda_intel\n').devices).toEqual([]);
    expect(parseDevices('00-00: ALC256 Analog : ALC256 Analog : playback 1\n').devices).toEqual([]);
  });
});
