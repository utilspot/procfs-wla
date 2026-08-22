import { describe, expect, it } from 'vitest';
import { readInterruptsFixture as fixture } from '../test/fixtures';
import {
  concentration,
  formatCount,
  isPerCpu,
  parseInterrupts,
  summarize,
  total,
} from './interrupts';

describe('parseInterrupts — an x86 desktop', () => {
  const interrupts = parseInterrupts(fixture('desktop-x86'));
  const line = (label: string) => interrupts.lines.find((candidate) => candidate.label === label)!;

  it('reads a column per CPU from the header', () => {
    expect(interrupts.cpus).toEqual(['CPU0', 'CPU1', 'CPU2', 'CPU3']);
    expect(interrupts.lines).toHaveLength(21);
  });

  it('splits a numbered line into chip, hardware number, trigger and device', () => {
    expect(line('0')).toMatchObject({
      irq: 0,
      counts: [33, 0, 0, 0],
      chip: 'IO-APIC',
      hwirq: 2,
      trigger: 'edge',
      devices: ['timer'],
      description: null,
    });
  });

  it('reads a PCI-MSI line with a large hardware number', () => {
    expect(line('121')).toMatchObject({
      chip: 'PCI-MSI',
      hwirq: 32768,
      trigger: 'edge',
      devices: ['nvme0q0'],
    });
  });

  it('reads a fasteoi trigger', () => {
    expect(line('9')).toMatchObject({ hwirq: 9, trigger: 'fasteoi', devices: ['acpi'] });
  });

  // `NMI: … Non-maskable interrupts` is prose, not a chip and a device.
  it('keeps a symbolic counter’s tail whole as a description', () => {
    expect(line('LOC')).toMatchObject({
      irq: null,
      chip: null,
      hwirq: null,
      trigger: null,
      devices: [],
      description: 'Local timer interrupts',
    });
    expect(line('TLB').description).toBe('TLB shootdowns');
  });

  // ERR and MIS carry one count for the machine, not one per CPU.
  it('does not pad the single-count lines out to the CPU list', () => {
    expect(line('ERR').counts).toEqual([0]);
    expect(line('MIS').counts).toEqual([0]);
    expect(isPerCpu(line('ERR'), interrupts.cpus)).toBe(false);
    expect(isPerCpu(line('LOC'), interrupts.cpus)).toBe(true);
  });

  it('totals each line and the machine', () => {
    const summary = summarize(interrupts);

    expect(total(line('121'))).toBe(12847 + 13102 + 12994 + 13011);
    expect(summary.total).toBe(7156155);
    expect(summary.hardware).toBe(10);
    expect(summary.idle).toBe(10);
  });

  it('totals per CPU without counting ERR and MIS against CPU0', () => {
    const summary = summarize(interrupts);

    expect(summary.perCpu).toEqual([1997004, 1724162, 1716225, 1718764]);
    // Were ERR's single count folded in, CPU0 would be the odd one out here.
    expect(summary.perCpu.reduce((sum, value) => sum + value, 0)).toBe(
      summary.total - total(line('ERR')) - total(line('MIS')),
    );
  });

  it('ranks the hardware IRQs and leaves the counters out of it', () => {
    const summary = summarize(interrupts);

    expect(summary.busiest[0]?.devices).toEqual(['i915']);
    expect(summary.busiest.every((candidate) => candidate.irq !== null)).toBe(true);
  });

  it('measures how concentrated a line is on one CPU', () => {
    // The i915 IRQ takes almost everything on CPU0.
    expect(concentration(line('122'))).toBeGreaterThan(0.99);
    // The audio IRQ is spread across all four.
    expect(concentration(line('123'))).toBeCloseTo(0.25, 2);
    expect(concentration(line('NMI'))).toBe(0);
  });
});

describe('parseInterrupts — an ARM GICv3', () => {
  const interrupts = parseInterrupts(fixture('arm-gic'));
  const line = (label: string) => interrupts.lines.find((candidate) => candidate.label === label)!;

  // The GIC writes `30 Level` where x86 writes `2-edge`; splitting on a fixed
  // token count would read the trigger as part of the device name.
  it('reads a hardware number and trigger separated by a space', () => {
    expect(line('11')).toMatchObject({
      chip: 'GICv3',
      hwirq: 30,
      trigger: 'Level',
      devices: ['arch_timer'],
    });
    expect(line('27')).toMatchObject({ hwirq: 101, trigger: 'Level', devices: ['eth0'] });
  });

  it('keeps a device name that contains spaces', () => {
    expect(line('14').devices).toEqual(['kvm guest vtimer']);
  });

  it('reads the IPI counters as symbolic lines', () => {
    expect(line('IPI0')).toMatchObject({
      irq: null,
      chip: null,
      description: 'Rescheduling interrupts',
    });
    expect(summarize(interrupts).hardware).toBe(5);
  });
});

describe('parseInterrupts — shared legacy IRQs', () => {
  const interrupts = parseInterrupts(fixture('shared-irq'));
  const line = (label: string) => interrupts.lines.find((candidate) => candidate.label === label)!;

  it('splits the drivers sharing one line', () => {
    expect(line('5').devices).toEqual(['uhci_hcd:usb2', 'eth0', 'snd_ens1371']);
    expect(line('10').devices).toEqual(['uhci_hcd:usb3', 'ehci_hcd:usb1']);
  });

  it('reads a non-zero ERR count', () => {
    expect(line('ERR').counts).toEqual([12]);
    expect(total(line('ERR'))).toBe(12);
  });
});

describe('parseInterrupts — a busy server', () => {
  const interrupts = parseInterrupts(fixture('server-nvme'));

  it('reads eight CPU columns', () => {
    expect(interrupts.cpus).toHaveLength(8);
    expect(summarize(interrupts).perCpu).toHaveLength(8);
  });

  it('sees each NVMe queue pinned to its own CPU', () => {
    const queues = interrupts.lines.filter((line) => line.devices[0]?.startsWith('nvme0q'));

    expect(queues).toHaveLength(4);
    for (const queue of queues) {
      expect(concentration(queue)).toBeGreaterThan(0.99);
    }
  });

  it('sees the NIC spread evenly instead', () => {
    const nic = interrupts.lines.find((line) => line.devices[0]?.startsWith('mlx5'))!;
    expect(concentration(nic)).toBeLessThan(0.2);
  });
});

describe('parseInterrupts — every fixture', () => {
  const names = ['desktop-x86', 'arm-gic', 'server-nvme', 'vm-virtio', 'shared-irq'];

  it.each(names)('parses %s into consistent lines', (name) => {
    const interrupts = parseInterrupts(fixture(name));
    const summary = summarize(interrupts);

    expect(interrupts.cpus.length).toBeGreaterThan(0);
    expect(interrupts.lines.length).toBeGreaterThan(0);

    for (const line of interrupts.lines) {
      expect(line.label).not.toBe('');
      // Either a count per CPU, or the single count ERR and MIS carry.
      expect([interrupts.cpus.length, 1]).toContain(line.counts.length);
      expect(line.counts.every((count) => count >= 0)).toBe(true);
      // A numbered line names a chip; a symbolic one carries prose instead.
      if (line.irq === null) expect(line.chip).toBeNull();
      else expect(line.chip).not.toBeNull();
      expect(concentration(line)).toBeLessThanOrEqual(1);
    }

    // The per-CPU totals plus the machine-wide counters are the whole file.
    const single = interrupts.lines
      .filter((line) => !isPerCpu(line, interrupts.cpus))
      .reduce((sum, line) => sum + total(line), 0);
    expect(summary.perCpu.reduce((sum, value) => sum + value, 0) + single).toBe(summary.total);
  });
});

describe('parseInterrupts — awkward input', () => {
  it('returns nothing for a file that is not /proc/interrupts', () => {
    expect(parseInterrupts('')).toEqual({ cpus: [], lines: [] });
    expect(parseInterrupts('processor\t: 0\n').lines).toEqual([]);
  });

  it('reads lines even when the header is missing', () => {
    const interrupts = parseInterrupts('  0:   33   0   IO-APIC  2-edge  timer\n');

    expect(interrupts.cpus).toEqual([]);
    expect(interrupts.lines).toHaveLength(1);
    expect(interrupts.lines[0]?.counts).toEqual([33, 0]);
  });

  it('skips a line with no counts at all', () => {
    const interrupts = parseInterrupts(
      '           CPU0\nfoo: not a number\n  0:   1   IO-APIC  2-edge  timer\n',
    );

    expect(interrupts.lines.map((line) => line.label)).toEqual(['0']);
  });

  it('reads a numbered line that names no device', () => {
    const [line] = parseInterrupts('           CPU0\n  7:   5   IO-APIC  7-edge\n').lines;

    expect(line).toMatchObject({ chip: 'IO-APIC', hwirq: 7, trigger: 'edge', devices: [] });
  });

  it('reads a line whose tail is only a chip', () => {
    const [line] = parseInterrupts('           CPU0\n  7:   5   XT-PIC\n').lines;

    expect(line).toMatchObject({ chip: 'XT-PIC', hwirq: null, trigger: null, devices: [] });
  });

  it('reports no concentration for a line that never fired', () => {
    const [line] = parseInterrupts('           CPU0       CPU1\n  7:   0   0   IO-APIC  7-edge  x\n')
      .lines;

    expect(total(line!)).toBe(0);
    expect(concentration(line!)).toBe(0);
  });
});

describe('formatCount', () => {
  it('shortens the big counters', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(12847)).toBe('12.8k');
    expect(formatCount(8472103)).toBe('8.5M');
    expect(formatCount(2210800230)).toBe('2.2G');
  });
});
