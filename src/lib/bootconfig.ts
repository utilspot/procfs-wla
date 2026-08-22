/**
 * Parser for `/proc/bootconfig`.
 *
 * The extended boot config an initrd can carry, printed back by the kernel one
 * key per line with its full dotted path:
 *
 *   kernel.root = "UUID=1b9f3a7c-5d2e-4f81-9a6b-0c3d8e7f2a41"
 *   kernel.rootwait
 *   init.arg = "--system", "--unit=multi-user.target"
 *   ftrace.event.sched.sched_switch.enable
 *   ftrace.instance.boot.events = "initcall.initcall_start", "irq.irq_handler_entry"
 *
 * Unlike `/proc/cmdline` this is a **tree**: the dots are structure, not part of
 * the name, and the file is the flattened form of nested blocks written in the
 * initrd. Values are always double-quoted here whatever the source used, may be
 * a comma-separated array, and a key may carry none at all — a bare line is a
 * flag.
 *
 * Two top-level sections are special, and it is the whole point of the file:
 * `kernel.*` is appended to the kernel command line, and `init.*` is handed to
 * init. Anything else is left for whoever reads it — ftrace configures itself
 * from `ftrace.*`, a module from its own name. See {@link destinationOf}.
 *
 * The file is empty on a machine that booted without a boot config, which is
 * most of them.
 */

export interface BootConfigEntry {
  /** Full dotted key, e.g. `ftrace.instance.boot.events`. */
  key: string;
  /** The key split on its dots — the path through the tree. */
  path: string[];
  /** Values as given, unquoted. Empty for a bare key. */
  values: string[];
}

/** Where the kernel sends a top-level section. */
export type Destination = 'kernel command line' | 'init' | 'whoever reads it';

export const KERNEL_SECTION = 'kernel';
export const INIT_SECTION = 'init';

export function destinationOf(entry: BootConfigEntry): Destination {
  if (entry.path[0] === KERNEL_SECTION) return 'kernel command line';
  if (entry.path[0] === INIT_SECTION) return 'init';
  return 'whoever reads it';
}

/**
 * Reads the `"a", "b"` list on the right of a key. Commas and spaces inside the
 * quotes belong to the value, so this scans rather than splitting on commas.
 */
function parseValues(text: string): string[] {
  const values: string[] = [];
  let index = 0;

  while (index < text.length) {
    while (index < text.length && /[\s,]/.test(text[index]!)) index++;
    if (index >= text.length) break;

    if (text[index] === '"') {
      const end = text.indexOf('"', index + 1);
      // An unterminated quote takes the rest of the line rather than vanishing.
      if (end === -1) {
        values.push(text.slice(index + 1));
        break;
      }
      values.push(text.slice(index + 1, end));
      index = end + 1;
      continue;
    }

    // The kernel always quotes, but take a bare token rather than drop it.
    const end = text.indexOf(',', index);
    const stop = end === -1 ? text.length : end;
    values.push(text.slice(index, stop).trim());
    index = stop + 1;
  }

  return values.filter((value) => value !== '');
}

export function parseBootConfig(text: string): BootConfigEntry[] {
  const entries: BootConfigEntry[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    // The kernel may append a comment footer; keys never start with #.
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    const key = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim();
    if (key === '') continue;

    entries.push({
      key,
      path: key.split('.'),
      values: separator === -1 ? [] : parseValues(trimmed.slice(separator + 1)),
    });
  }

  return entries;
}

/** A bare key with no value — `kernel.rootwait`. */
export function isFlag(entry: BootConfigEntry): boolean {
  return entry.values.length === 0;
}

export interface Section {
  /** Top-level key, e.g. `kernel` or `ftrace`. */
  name: string;
  destination: Destination;
  entries: BootConfigEntry[];
}

/**
 * Groups by top-level key, in the order each first appears — which is the order
 * the boot config declared them.
 */
export function sections(entries: readonly BootConfigEntry[]): Section[] {
  const grouped = new Map<string, BootConfigEntry[]>();

  for (const entry of entries) {
    const name = entry.path[0] ?? entry.key;
    const existing = grouped.get(name);
    if (existing === undefined) grouped.set(name, [entry]);
    else existing.push(entry);
  }

  return [...grouped].map(([name, list]) => ({
    name,
    destination: destinationOf(list[0]!),
    entries: list,
  }));
}

export interface BootConfigSummary {
  keys: number;
  /** Keys carrying no value at all. */
  flags: number;
  /** Values across every key, since one key may hold several. */
  values: number;
  sections: number;
  /** Deepest key, counted in dots — `a.b.c` is 3. */
  depth: number;
  /** Keys appended to the kernel command line. */
  toKernel: number;
  /** Keys handed to init. */
  toInit: number;
}

export function summarize(entries: readonly BootConfigEntry[]): BootConfigSummary {
  return {
    keys: entries.length,
    flags: entries.filter(isFlag).length,
    values: entries.reduce((total, entry) => total + entry.values.length, 0),
    sections: sections(entries).length,
    depth: Math.max(0, ...entries.map((entry) => entry.path.length)),
    toKernel: entries.filter((entry) => destinationOf(entry) === 'kernel command line').length,
    toInit: entries.filter((entry) => destinationOf(entry) === 'init').length,
  };
}

/** The last-given entry for a key, matching how a repeated key resolves. */
export function find(
  entries: readonly BootConfigEntry[],
  key: string,
): BootConfigEntry | undefined {
  return [...entries].reverse().find((entry) => entry.key === key);
}
