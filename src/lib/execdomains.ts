/**
 * Parser for `/proc/execdomains`.
 *
 * The registered execution domains, one per line, written as
 * `%d-%d\t%-16s\t[%s]`:
 *
 *    0-0	Linux           	[kernel]
 *    1-1	SVR4            	[abi_svr4]
 *
 * An exec domain claimed a range of **personality numbers** — the low byte of
 * what `personality(2)` sets, masked with 0xff — and gave processes running
 * under them another system's signal numbering and syscall behaviour. The
 * loadable ABI modules (linux-abi, iBCS2) registered themselves this way, which
 * is why a domain can name a module rather than `[kernel]`.
 *
 * Exec domains were removed in **Linux 4.1**; the file was kept so that tools
 * reading it do not break, and every kernel since prints the single fixed line
 * `0-0 Linux [kernel]` whatever the machine is. See {@link isStub} — which is a
 * shape, not a version check, since a pre-4.1 kernel with no ABI module loaded
 * printed exactly the same thing.
 */

/** What the kernel prints in brackets for a domain that is not from a module. */
export const BUILT_IN = 'kernel';

/**
 * The personality numbers with a name in `include/uapi/linux/personality.h`,
 * i.e. the low byte of each `PER_*` constant. A domain is free to claim a
 * number outside this list, and nothing is claimed about one that does.
 */
export const PERSONALITIES: Readonly<Record<number, string>> = {
  0: 'Linux',
  1: 'SVR4',
  2: 'SVR3',
  3: 'SCO OpenServer',
  4: 'Wyse V/386',
  5: 'Interactive UNIX',
  6: 'BSD / SunOS',
  7: 'Xenix',
  8: 'Linux 32-bit',
  9: 'IRIX32',
  10: 'IRIX N32',
  11: 'IRIX64',
  12: 'RISC OS',
  13: 'Solaris',
  14: 'UnixWare 7',
  15: 'OSF/1 v4',
  16: 'HP-UX',
};

export interface ExecDomain {
  /** First personality number the domain claims. */
  low: number;
  /** Last one it claims, inclusive — equal to {@link low} for a single number. */
  high: number;
  /** The domain's name, as it registered itself. */
  name: string;
  /** What stood in the brackets: a module name, or `kernel` when built in. */
  module: string;
}

export interface ExecDomainsInfo {
  domains: ExecDomain[];
}

/** `13-13\tSolaris         \t[abi_solaris]` */
const LINE = /^(\d+)-(\d+)\s+(.*?)\s*\[([^\]]*)\]$/;

export function parseExecDomains(text: string): ExecDomainsInfo {
  const domains: ExecDomain[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const match = LINE.exec(trimmed);
    if (match === null) continue;

    // The name is padded to 16 columns, so it arrives with trailing spaces.
    const name = (match[3] ?? '').trim();
    if (name === '') continue;

    domains.push({
      low: Number(match[1]),
      high: Number(match[2]),
      name,
      module: (match[4] ?? '').trim(),
    });
  }

  return { domains };
}

/** A domain compiled into the kernel rather than loaded as a module. */
export function isBuiltIn(domain: ExecDomain): boolean {
  return domain.module === BUILT_IN;
}

/**
 * How many personality numbers the domain claims. A range that runs backwards
 * claims none: it is not a real kernel's output, so nothing is invented for it.
 */
export function personalityCount(domain: ExecDomain): number {
  return domain.high < domain.low ? 0 : domain.high - domain.low + 1;
}

/** The personality numbers the domain claims, in order. */
export function personalitiesOf(domain: ExecDomain): number[] {
  return Array.from({ length: personalityCount(domain) }, (_, index) => domain.low + index);
}

/** The ABI a personality number stands for, or null when it names none. */
export function personalityName(personality: number): string | null {
  return PERSONALITIES[personality] ?? null;
}

/** The named ABIs a domain covers, skipping the numbers that name none. */
export function abisOf(domain: ExecDomain): string[] {
  const names = personalitiesOf(domain)
    .map((personality) => personalityName(personality))
    .filter((name): name is string => name !== null);

  return Array.from(new Set(names));
}

/**
 * Whether the file is the fixed line every kernel since 4.1 prints: the Linux
 * domain on personality 0, built in, and nothing else.
 *
 * This is the file's shape, not the kernel's version — a pre-4.1 kernel with no
 * ABI module loaded printed the same line, and the file cannot tell the two
 * apart.
 */
export function isStub(info: ExecDomainsInfo): boolean {
  const [only] = info.domains;

  return (
    info.domains.length === 1 &&
    only !== undefined &&
    only.low === 0 &&
    only.high === 0 &&
    only.name === 'Linux' &&
    isBuiltIn(only)
  );
}

/**
 * Personality numbers claimed by more than one domain. The kernel refused to
 * register a domain overlapping an existing one, so this is empty for anything
 * a real machine produced.
 */
export function overlaps(info: ExecDomainsInfo): number[] {
  const seen = new Set<number>();
  const twice = new Set<number>();

  for (const domain of info.domains) {
    for (const personality of personalitiesOf(domain)) {
      if (seen.has(personality)) twice.add(personality);
      seen.add(personality);
    }
  }

  return Array.from(twice).sort((a, b) => a - b);
}

export interface ExecDomainsSummary {
  domains: number;
  /** Personality numbers covered across all domains, counting each once. */
  personalities: number;
  /** Domains that came from a loadable module rather than the kernel. */
  fromModules: ExecDomain[];
  /** True when the file is the fixed post-4.1 line and nothing more. */
  stub: boolean;
  overlapping: number[];
}

export function summarize(info: ExecDomainsInfo): ExecDomainsSummary {
  const covered = new Set(info.domains.flatMap((domain) => personalitiesOf(domain)));

  return {
    domains: info.domains.length,
    personalities: covered.size,
    fromModules: info.domains.filter((domain) => !isBuiltIn(domain)),
    stub: isStub(info),
    overlapping: overlaps(info),
  };
}
