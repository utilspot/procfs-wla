/**
 * Parser for `/proc/cmdline`.
 *
 * One line: the parameters the boot loader handed the kernel.
 *
 *   BOOT_IMAGE=/boot/vmlinuz-6.8.0-45 root=UUID=1b9f… ro quiet splash vt.handoff=7
 *
 * Three shapes of token, and two rules that are easy to get wrong:
 *
 * - A parameter splits on its **first** `=`, so `root=UUID=1b9f…` is the key
 *   `root` with the value `UUID=1b9f…`, not a key of `root=UUID`.
 * - A dotted key configures a module: `i915.enable_psr=0` is `enable_psr` on
 *   `i915`. Not every dot means a module — `vt.handoff` is a built-in — but the
 *   shape is the same and the kernel treats them alike.
 * - Values may be double-quoted to hold spaces (`dyndbg="module nvme +p"`), so
 *   the line cannot simply be split on whitespace.
 * - Everything after a bare `--` is passed to init as arguments rather than
 *   read by the kernel, so those are kept apart.
 *
 * A parameter may appear more than once; for most of them the kernel takes the
 * last, which is why {@link find} looks from the end. See {@link duplicates}.
 */

export interface Parameter {
  /** The token exactly as it appeared, quotes and all. */
  raw: string;
  /** Everything before the first `=`, or the whole token for a bare flag. */
  key: string;
  /** Everything after the first `=`, unquoted. Null for a bare flag. */
  value: string | null;
  /** Module a dotted key configures: `i915` in `i915.enable_psr=0`. */
  module: string | null;
  /** The key without its module prefix. */
  name: string;
}

export interface CommandLine {
  /** The line as it was read, trimmed. */
  raw: string;
  /** Kernel parameters, in the order they were given. */
  parameters: Parameter[];
  /** Tokens after a bare `--`, which the kernel hands to init untouched. */
  initArgs: string[];
}

/**
 * Splits the line on whitespace, except inside double quotes. The kernel drops
 * the quotes when it reads the value, so they are stripped from `value` but
 * kept in `raw`.
 */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  let started = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      started = true;
      current += char;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }

  if (started) tokens.push(current);
  return tokens;
}

function parseParameter(raw: string): Parameter {
  const separator = raw.indexOf('=');
  const key = separator === -1 ? raw : raw.slice(0, separator);
  const value = separator === -1 ? null : raw.slice(separator + 1).replace(/"/g, '');

  const dot = key.indexOf('.');
  return {
    raw,
    key,
    value,
    module: dot === -1 ? null : key.slice(0, dot),
    name: dot === -1 ? key : key.slice(dot + 1),
  };
}

export function parseCmdline(text: string): CommandLine {
  // The file is one line, but a trailing newline and a stray blank line either
  // side of it are both possible.
  const raw = text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
  const tokens = tokenize(raw);

  const separator = tokens.indexOf('--');
  const kernel = separator === -1 ? tokens : tokens.slice(0, separator);
  const initArgs = separator === -1 ? [] : tokens.slice(separator + 1);

  return { raw, parameters: kernel.map(parseParameter), initArgs };
}

/**
 * The parameter the kernel would act on for a key: the last one given, since
 * a later occurrence overrides an earlier one for most parameters.
 */
export function find(cmdline: CommandLine, key: string): Parameter | undefined {
  return [...cmdline.parameters].reverse().find((parameter) => parameter.key === key);
}

/** Keys given more than once, with every value in the order they appeared. */
export function duplicates(cmdline: CommandLine): { key: string; values: (string | null)[] }[] {
  const seen = new Map<string, (string | null)[]>();

  for (const parameter of cmdline.parameters) {
    const values = seen.get(parameter.key);
    if (values === undefined) seen.set(parameter.key, [parameter.value]);
    else values.push(parameter.value);
  }

  return [...seen]
    .filter(([, values]) => values.length > 1)
    .map(([key, values]) => ({ key, values }));
}

export interface ModuleGroup {
  module: string;
  parameters: Parameter[];
}

/** Groups the dotted parameters by the module they configure, module first. */
export function byModule(cmdline: CommandLine): ModuleGroup[] {
  const groups = new Map<string, Parameter[]>();

  for (const parameter of cmdline.parameters) {
    if (parameter.module === null) continue;
    const existing = groups.get(parameter.module);
    if (existing === undefined) groups.set(parameter.module, [parameter]);
    else existing.push(parameter);
  }

  return [...groups]
    .map(([module, parameters]) => ({ module, parameters }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

/**
 * Parameters that turn off a kernel protection.
 *
 * A hint for reading the line rather than a verdict — every one of these is a
 * legitimate thing to set while debugging, and the page only points them out.
 * Matched on key and value, since `selinux=1` is the opposite of `selinux=0`.
 */
const HARDENING_OFF: { key: string; off: (value: string | null) => boolean; note: string }[] = [
  { key: 'mitigations', off: (v) => v === 'off', note: 'CPU vulnerability mitigations disabled' },
  { key: 'nokaslr', off: () => true, note: 'kernel address randomisation disabled' },
  { key: 'selinux', off: (v) => v === '0', note: 'SELinux disabled' },
  { key: 'apparmor', off: (v) => v === '0', note: 'AppArmor disabled' },
  { key: 'audit', off: (v) => v === '0', note: 'audit subsystem disabled' },
  { key: 'lockdown', off: (v) => v === 'none', note: 'kernel lockdown off' },
  { key: 'module.sig_enforce', off: (v) => v === '0', note: 'unsigned modules allowed' },
  { key: 'iommu', off: (v) => v === 'off', note: 'IOMMU disabled' },
  { key: 'init', off: (v) => v !== null && /\/(ba|da|z|k)?sh$/.test(v), note: 'init is a shell' },
];

export interface Relaxation {
  parameter: Parameter;
  note: string;
}

export function relaxations(cmdline: CommandLine): Relaxation[] {
  const found: Relaxation[] = [];

  for (const parameter of cmdline.parameters) {
    const rule = HARDENING_OFF.find((candidate) => candidate.key === parameter.key);
    if (rule !== undefined && rule.off(parameter.value)) {
      found.push({ parameter, note: rule.note });
    }
  }

  return found;
}

export interface CmdlineSummary {
  total: number;
  /** Bare flags, i.e. parameters with no value. */
  flags: number;
  modules: number;
  /** The parameters the page calls out at the top, when they were given. */
  notable: { label: string; parameter: Parameter }[];
}

/** The handful of parameters that say what the machine actually booted. */
const NOTABLE: { key: string; label: string }[] = [
  { key: 'BOOT_IMAGE', label: 'kernel' },
  { key: 'root', label: 'root device' },
  { key: 'rootfstype', label: 'root filesystem' },
  { key: 'init', label: 'init' },
  { key: 'console', label: 'console' },
];

export function summarize(cmdline: CommandLine): CmdlineSummary {
  const notable: { label: string; parameter: Parameter }[] = [];
  for (const { key, label } of NOTABLE) {
    const parameter = find(cmdline, key);
    if (parameter !== undefined) notable.push({ label, parameter });
  }

  return {
    total: cmdline.parameters.length,
    flags: cmdline.parameters.filter((parameter) => parameter.value === null).length,
    modules: byModule(cmdline).length,
    notable,
  };
}
