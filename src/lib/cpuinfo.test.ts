import { describe, expect, it } from 'vitest';
import { readCpuInfoFixture as fixture } from '../test/fixtures';
import { cpuBugs, cpuFlags, cpuModel, parseCpuInfo, summarize } from './cpuinfo';

describe('parseCpuInfo — x86_64 (Intel)', () => {
  const info = parseCpuInfo(fixture('intel-x86_64'));

  it('finds every processor block', () => {
    expect(info.cpus).toHaveLength(4);
    expect(info.cpus.map((cpu) => cpu.index)).toEqual([0, 1, 2, 3]);
  });

  it('reads fields with tab-padded keys', () => {
    const [cpu] = info.cpus;
    expect(cpu?.get('model name')).toBe('Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz');
    expect(cpu?.get('cache size')).toBe('12288 KB');
  });

  it('keeps keys that have an empty value', () => {
    expect(info.cpus[0]?.get('power management')).toBe('');
  });

  it('is case-insensitive on lookup', () => {
    expect(info.cpus[0]?.get('MODEL NAME')).toBe(info.cpus[0]?.get('model name'));
  });

  it('summarizes topology from physical id / cpu cores', () => {
    const summary = summarize(info);
    expect(summary.logicalCount).toBe(4);
    expect(summary.sockets).toBe(1);
    expect(summary.physicalCores).toBe(6);
    expect(summary.models).toEqual(['Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz']);
    expect(Math.max(...summary.clocksMHz)).toBeCloseTo(4012.548);
  });

  it('splits flags and bugs', () => {
    const cpu = info.cpus[0]!;
    expect(cpuFlags(cpu)).toContain('avx2');
    expect(cpuFlags(cpu).length).toBeGreaterThan(100);
    expect(cpuBugs(cpu)).toContain('spectre_v2');
  });
});

describe('parseCpuInfo — AMD', () => {
  const info = parseCpuInfo(fixture('amd-ryzen'));

  it('handles AMD-only fields', () => {
    expect(info.cpus).toHaveLength(3);
    expect(info.cpus[0]?.get('TLB size')).toBe('2560 4K pages');
    expect(info.cpus[0]?.get('vendor_id')).toBe('AuthenticAMD');
  });

  it('keeps a non-empty power management value', () => {
    expect(info.cpus[0]?.get('power management')).toBe('ts ttp tm hwpstate cpb eff_freq_ro [13] [14]');
  });
});

describe('parseCpuInfo — ARM (Raspberry Pi)', () => {
  const info = parseCpuInfo(fixture('arm-rpi4'));

  it('parses four CPUs and the trailing machine block', () => {
    expect(info.cpus).toHaveLength(4);
    expect(Object.fromEntries(info.machine.map((f) => [f.key, f.value]))).toMatchObject({
      Hardware: 'BCM2835',
      Model: 'Raspberry Pi 4 Model B Rev 1.4',
    });
  });

  it('falls back when "model name" is absent', () => {
    expect(info.cpus[0]?.get('model name')).toBeUndefined();
    expect(cpuModel(info.cpus[0]!)).toBe('Unknown model');
  });

  it('reads ARM feature list', () => {
    expect(cpuFlags(info.cpus[0]!)).toEqual(['fp', 'asimd', 'evtstrm', 'crc32', 'cpuid']);
  });

  it('reports no topology when the fields are missing', () => {
    const summary = summarize(info);
    expect(summary.sockets).toBeNull();
    expect(summary.physicalCores).toBeNull();
    expect(summary.clocksMHz).toEqual([]);
  });

  it('keeps a key whose colon has no leading space ("CPU architecture:")', () => {
    expect(info.cpus[0]?.get('CPU architecture')).toBe('8');
  });
});

describe('parseCpuInfo — RISC-V', () => {
  const info = parseCpuInfo(fixture('riscv'));

  it('uses uarch as the display model', () => {
    expect(cpuModel(info.cpus[0]!)).toBe('sifive,u74-mc');
  });

  it('splits the ISA string into extensions', () => {
    const flags = cpuFlags(info.cpus[0]!);
    expect(flags[0]).toBe('rv64imafdch');
    expect(flags).toContain('zicsr');
  });
});

describe('parseCpuInfo — single CPU', () => {
  it('parses a file with one block and no trailing newline group', () => {
    const info = parseCpuInfo(fixture('single-core'));
    expect(info.cpus).toHaveLength(1);
    expect(cpuModel(info.cpus[0]!)).toBe('QEMU Virtual CPU version 2.5+');
    expect(info.machine).toEqual([]);
  });
});

describe('parseCpuInfo — edge cases', () => {
  it('returns nothing for an empty file', () => {
    expect(parseCpuInfo('')).toEqual({ cpus: [], machine: [] });
  });

  it('ignores lines without a colon', () => {
    const info = parseCpuInfo('processor\t: 0\ngarbage line\nmodel name\t: Test\n');
    expect(info.cpus[0]?.fields).toHaveLength(2);
  });

  it('handles CRLF line endings', () => {
    const info = parseCpuInfo('processor\t: 0\r\nmodel name\t: Test CPU\r\n');
    expect(info.cpus[0]?.get('model name')).toBe('Test CPU');
  });

  it('keeps values that themselves contain a colon', () => {
    const info = parseCpuInfo('processor\t: 0\nmodel name\t: CPU @ 2.60GHz: turbo\n');
    expect(info.cpus[0]?.get('model name')).toBe('CPU @ 2.60GHz: turbo');
  });

  it('treats a block with no processor field as machine info', () => {
    const info = parseCpuInfo('Hardware\t: BCM2835\n');
    expect(info.cpus).toEqual([]);
    expect(info.machine).toHaveLength(1);
  });
});
