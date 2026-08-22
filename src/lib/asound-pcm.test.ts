import { describe, expect, it } from 'vitest';
import { readAsoundPcmFixture as fixture } from '../test/fixtures';
import {
  cardsOf,
  devicesOfCard,
  directionOf,
  hasGaps,
  opensAtOnce,
  parsePcm,
  substreamsOf,
  summarize,
  timerIdsOf,
  type PcmDevice,
} from './asound-pcm';

/** The device at this address, which is what the file names them by. */
const at = (devices: PcmDevice[], address: string): PcmDevice =>
  devices.find((device) => device.address === address)!;

describe('parsePcm — an HDA codec and its HDMI outputs', () => {
  const table = parsePcm(fixture('desktop'));

  it('reads a device per line, in the card and device order the kernel keeps', () => {
    expect(table.devices.map((device) => device.address)).toEqual(['00-00', '00-03', '00-07']);
  });

  /** The two names are two fields, whatever the driver put in them. */
  it('reads the id and the name as the separate fields they are', () => {
    expect(at(table.devices, '00-00')).toMatchObject({
      card: 0,
      device: 0,
      id: 'ALC256 Analog',
      name: 'ALC256 Analog',
    });
  });

  /** A stream with no substreams is not printed as 0 — it is not printed. */
  it('tells a stream that printed nothing from one that printed a count', () => {
    expect(at(table.devices, '00-00')).toMatchObject({ playback: 1, capture: 1 });
    expect(at(table.devices, '00-03')).toMatchObject({ playback: 1, capture: null });

    expect(directionOf(at(table.devices, '00-00'))).toBe('duplex');
    expect(directionOf(at(table.devices, '00-03'))).toBe('playback');
  });

  /** Gaps are the driver's numbering rather than a device having gone. */
  it('reads device numbers that skip as the driver’s own', () => {
    expect(hasGaps(table, 0)).toBe(true);
    expect(devicesOfCard(table, 0)).toHaveLength(3);
    expect(cardsOf(table)).toEqual([0]);
  });

  /** Each substream here is one line of /proc/asound/timers. */
  it('works out which timer lines a device’s substreams have', () => {
    expect(timerIdsOf(at(table.devices, '00-00'))).toEqual(['P0-0-0', 'P0-0-1']);
    expect(timerIdsOf(at(table.devices, '00-07'))).toEqual(['P0-7-0']);
  });

  it('summarizes the machine as devices, cards and substreams', () => {
    expect(summarize(table)).toMatchObject({
      devices: 3,
      cards: [0],
      playbackDevices: 3,
      captureDevices: 1,
      playbackSubstreams: 3,
      captureSubstreams: 1,
      gappedCards: [0],
    });
    expect(summarize(table).multiOpen).toEqual([]);
  });
});

describe('parsePcm — a device that mixes in hardware', () => {
  const table = parsePcm(fixture('many-substreams'));

  /** Substreams, which is how many opens fit at once — not channels. */
  it('reads a count of substreams rather than of channels', () => {
    expect(at(table.devices, '00-00')).toMatchObject({ playback: 32, capture: 1 });
    expect(opensAtOnce(at(table.devices, '00-00'))).toBe(32);
    expect(substreamsOf(at(table.devices, '00-00'))).toBe(33);
  });

  /** An id and a name that are nothing like each other, the name with a slash. */
  it('keeps a name that is not the id, punctuation and all', () => {
    expect(at(table.devices, '00-00')).toMatchObject({
      id: 'emu10k1',
      name: 'ADC Capture/Standard PCM Playback',
    });
    expect(at(table.devices, '00-02').name).toBe('Multichannel Capture/PT Playback');
  });

  it('gives every substream of a wide device its own timer line', () => {
    const ids = timerIdsOf(at(table.devices, '00-00'));

    expect(ids).toHaveLength(33);
    expect(ids[0]).toBe('P0-0-0');
    expect(ids[31]).toBe('P0-0-62');
    // The capture substream's line comes after them, with the direction bit set.
    expect(ids[32]).toBe('P0-0-1');
  });

  it('counts the devices that take more than one opener', () => {
    expect(summarize(table).multiOpen.map((device) => device.address)).toEqual(['00-00', '00-02']);
  });

  /** 0, 1, 2 with nothing skipped, unlike the HDA capture. */
  it('reads contiguous device numbers as having no gap', () => {
    expect(hasGaps(table, 0)).toBe(false);
    expect(summarize(table).gappedCards).toEqual([]);
  });
});

describe('parsePcm — one direction only', () => {
  const table = parsePcm(fixture('capture-only'));

  it('reads a device with no playback field at all', () => {
    expect(table.devices[0]).toMatchObject({ playback: null, capture: 1 });
    expect(directionOf(table.devices[0]!)).toBe('capture');
    expect(timerIdsOf(table.devices[0]!)).toEqual(['P0-0-1']);
  });

  it('counts no playback substreams rather than an unknown number', () => {
    expect(summarize(table)).toMatchObject({ playbackDevices: 0, playbackSubstreams: 0 });
  });
});

describe('parsePcm — a second card', () => {
  const table = parsePcm(fixture('usb-headset'));

  it('reads the cards in the order the file lists them', () => {
    expect(cardsOf(table)).toEqual([0, 1]);
    expect(devicesOfCard(table, 1).map((device) => device.address)).toEqual(['01-00']);
  });

  /** A card of one device numbered 0 has nothing skipped in it. */
  it('reads a gap on one card without claiming one on the other', () => {
    expect(summarize(table).gappedCards).toEqual([0]);
    expect(hasGaps(table, 1)).toBe(false);
  });

  it('keeps the card number out of the timer lines of the other card', () => {
    expect(timerIdsOf(at(table.devices, '01-00'))).toEqual(['P1-0-0', 'P1-0-1']);
  });
});

describe('parsePcm — four substreams on one device', () => {
  const table = parsePcm(fixture('raspberry-pi'));

  /** Which is where the timers file's 0, 2, 4, 6 comes from. */
  it('numbers the playback timer lines in twos', () => {
    expect(timerIdsOf(table.devices[0]!)).toEqual(['P0-0-0', 'P0-0-2', 'P0-0-4', 'P0-0-6']);
    expect(opensAtOnce(table.devices[0]!)).toBe(4);
  });
});

describe('parsePcm — lines that are not the ordinary ones', () => {
  it('reads an empty file as a machine with no PCM device', () => {
    expect(parsePcm(fixture('no-devices')).devices).toEqual([]);
    expect(summarize(parsePcm(''))).toMatchObject({ devices: 0, cards: [] });
  });

  /** The counts are taken off the end, so a name reading like one survives. */
  it('does not take a count out of the middle of a name', () => {
    const table = parsePcm('00-00: capture 2 : playback 3 : playback 1 : capture 1\n');

    expect(table.devices[0]).toMatchObject({
      id: 'capture 2',
      name: 'playback 3',
      playback: 1,
      capture: 1,
    });
  });

  it('keeps a name the driver left a separator in', () => {
    const table = parsePcm('00-00: id : first : second : playback 1\n');

    expect(table.devices[0]).toMatchObject({
      id: 'id',
      name: 'first : second',
      playback: 1,
    });
  });

  it('reads a device that printed neither count', () => {
    const table = parsePcm('00-00: Silent : Silent\n');

    expect(table.devices[0]).toMatchObject({ playback: null, capture: null });
    expect(directionOf(table.devices[0]!)).toBe('neither');
    expect(timerIdsOf(table.devices[0]!)).toEqual([]);
  });

  it('reads a card number past the two digits the padding allows for', () => {
    const table = parsePcm('12-34: Big : Big : playback 1\n');

    expect(table.devices[0]).toMatchObject({ address: '12-34', card: 12, device: 34 });
    expect(timerIdsOf(table.devices[0]!)).toEqual(['P12-34-0']);
  });

  it('reads no devices out of a file that is not this one', () => {
    expect(parsePcm('G0: system timer : 1000.000us (10000000 ticks)\n').devices).toEqual([]);
    expect(parsePcm('\n\n').devices).toEqual([]);
  });
});
