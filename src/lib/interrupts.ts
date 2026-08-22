/**
 * Parser for `/proc/interrupts`.
 *
 * A column per online CPU, then a line per interrupt source:
 *
 *            CPU0       CPU1       CPU2       CPU3
 *   0:         33          0          0          0   IO-APIC   2-edge      timer
 * 121:      12847      13102      12994      13011   PCI-MSI 32768-edge    nvme0q0
 * NMI:          0          0          0          0   Non-maskable interrupts
 * ERR:          0
 *
 * Three shapes, and the tail after the counts is the awkward part:
 *
 * - A **numbered** line is a hardware IRQ. After the counts comes the chip, the
 *   hardware number with its trigger, and the driver that claimed it. x86 joins
 *   the number and trigger with a dash (`2-edge`); ARM's GIC separates them with
 *   a space (`30 Level`), so a fixed two-token split reads one of them wrong.
 *   Both spellings are handled, and anything else is kept whole as the device.
 * - A **symbolic** line (`NMI`, `LOC`, `RES`, ARM's `IPI0`…) is a kernel
 *   counter, and its tail is prose — `Local timer interrupts` — which must not
 *   be split into chip and device.
 * - `ERR` and `MIS` carry **one** count rather than one per CPU, so the counts
 *   array is shorter than the CPU list and must not be padded with zeroes.
 *
 * A line may name several devices when an IRQ is shared, comma separated.
 */

export interface Interrupt {
  /** `0`, `121`, `NMI`, `IPI0` — the label before the colon. */
  label: string;
  /** The label as a number, for a hardware IRQ; null for a symbolic counter. */
  irq: number | null;
  /** One count per CPU, except ERR and MIS which carry a single total. */
  counts: number[];
  /** Interrupt controller, e.g. `IO-APIC`, `PCI-MSI`, `GICv3`. Numbered lines only. */
  chip: string | null;
  /** Hardware interrupt number as the controller sees it. */
  hwirq: number | null;
  /** `edge`, `fasteoi`, `Level` — how the interrupt is triggered. */
  trigger: string | null;
  /** Drivers that claimed this line; more than one when it is shared. */
  devices: string[];
  /** For a symbolic counter, the kernel's own description of it. */
  description: string | null;
}

export interface Interrupts {
  /** CPUs the file has a column for, in order: `['CPU0', 'CPU1', …]`. */
  cpus: string[];
  lines: Interrupt[];
}

/** The header: nothing but CPU labels. */
const HEADER = /^\s*(CPU\d+\s*)+$/;
/** `121:` or `NMI:` and everything after it. */
const LINE = /^\s*(\S+):\s*(.*)$/;
/** x86 joins the hardware number to its trigger: `32768-edge`. */
const JOINED = /^(\d+)-(\S+)$/;

function splitTail(tokens: readonly string[]): Pick<
  Interrupt,
  'chip' | 'hwirq' | 'trigger' | 'devices'
> {
  const [chip, ...rest] = tokens;
  if (chip === undefined) return { chip: null, hwirq: null, trigger: null, devices: [] };

  const devices = (from: number): string[] =>
    rest
      .slice(from)
      .join(' ')
      .split(',')
      .map((device) => device.trim())
      .filter((device) => device !== '');

  // ARM: `GICv3  30 Level  arch_timer`
  if (rest[0] !== undefined && /^\d+$/.test(rest[0]) && rest[1] !== undefined) {
    return { chip, hwirq: Number(rest[0]), trigger: rest[1], devices: devices(2) };
  }

  // x86: `IO-APIC  2-edge  timer`
  const joined = rest[0] === undefined ? null : JOINED.exec(rest[0]);
  if (joined !== null) {
    return { chip, hwirq: Number(joined[1]), trigger: joined[2]!, devices: devices(1) };
  }

  return { chip, hwirq: null, trigger: null, devices: devices(0) };
}

export function parseInterrupts(text: string): Interrupts {
  const cpus: string[] = [];
  const lines: Interrupt[] = [];

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    if (cpus.length === 0 && HEADER.test(line)) {
      cpus.push(...(line.trim().split(/\s+/)));
      continue;
    }

    const match = LINE.exec(line);
    if (match === null) continue;

    const label = match[1]!;
    const tokens = (match[2] ?? '').trim().split(/\s+/).filter((token) => token !== '');

    // The counts run until the first token that is not a number. ERR and MIS
    // stop after one; a line with no counts at all is not an interrupt.
    let end = 0;
    while (end < tokens.length && /^\d+$/.test(tokens[end]!)) end++;
    if (end === 0) continue;

    const counts = tokens.slice(0, end).map(Number);
    const tail = tokens.slice(end);
    const irq = /^\d+$/.test(label) ? Number(label) : null;

    lines.push({
      label,
      irq,
      counts,
      // A symbolic counter's tail is prose, not a chip and a device.
      ...(irq === null
        ? { chip: null, hwirq: null, trigger: null, devices: [] }
        : splitTail(tail)),
      description: irq === null && tail.length > 0 ? tail.join(' ') : null,
    });
  }

  return { cpus, lines };
}

/** Interrupts on this line across every CPU. */
export function total(line: Interrupt): number {
  return line.counts.reduce((sum, count) => sum + count, 0);
}

/**
 * How concentrated a line is on one CPU, 0–1: 1 when a single CPU took every
 * interrupt, near 1/n when they were spread evenly. Interesting because an IRQ
 * pinned to one CPU is often deliberate — and sometimes not.
 */
export function concentration(line: Interrupt): number {
  const sum = total(line);
  return sum === 0 ? 0 : Math.max(...line.counts) / sum;
}

/** Whether this line has a count per CPU, as opposed to ERR and MIS. */
export function isPerCpu(line: Interrupt, cpus: readonly string[]): boolean {
  return line.counts.length === cpus.length && cpus.length > 0;
}

export interface InterruptsSummary {
  cpus: number;
  /** Lines in the file. */
  lines: number;
  /** Numbered hardware IRQs, as opposed to the kernel's own counters. */
  hardware: number;
  /** Lines that have never fired. */
  idle: number;
  total: number;
  /** Total per CPU, in column order. */
  perCpu: number[];
  /** Hardware IRQs by total, busiest first. */
  busiest: Interrupt[];
}

export function summarize(interrupts: Interrupts): InterruptsSummary {
  const { cpus, lines } = interrupts;

  const perCpu = cpus.map((_, index) =>
    lines.reduce(
      // Skip ERR and MIS: their single count is not CPU 0's.
      (sum, line) => sum + (isPerCpu(line, cpus) ? (line.counts[index] ?? 0) : 0),
      0,
    ),
  );

  const hardware = lines.filter((line) => line.irq !== null);

  return {
    cpus: cpus.length,
    lines: lines.length,
    hardware: hardware.length,
    idle: lines.filter((line) => total(line) === 0).length,
    total: lines.reduce((sum, line) => sum + total(line), 0),
    perCpu,
    busiest: [...hardware].sort((a, b) => total(b) - total(a) || a.label.localeCompare(b.label)),
  };
}

/** `1.2M` — interrupt counts reach the hundreds of millions. */
export function formatCount(value: number): string {
  const units = [
    { limit: 1e9, suffix: 'G' },
    { limit: 1e6, suffix: 'M' },
    { limit: 1e3, suffix: 'k' },
  ];

  for (const { limit, suffix } of units) {
    if (value >= limit) return `${(value / limit).toFixed(1)}${suffix}`;
  }
  return String(value);
}
