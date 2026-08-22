/**
 * Parser for `/proc/version_signature`.
 *
 * One line of three fields, and only Ubuntu kernels have it at all:
 *
 *   Ubuntu 7.0.0-28.28~24.04.1-generic 7.0.12
 *   └ vendor └ package version                └ upstream release
 *
 * The file exists because **`uname -r` does not answer the question people ask
 * it**. On the machine this parser was written against, `uname -r` says
 * `7.0.0-28-generic` while the source tree is really upstream **7.0.12** — the
 * third field here. Ubuntu freezes the last component of the base version at
 * the series' `.0` and never moves it, so the number in `uname -r` and in
 * `/proc/version` says which series you are on and nothing about how far
 * through its stable releases you are. Asked whether a fix that landed in
 * 7.0.9 is present, only this file can say.
 *
 * The package version carries two numbers where it looks like one:
 *
 * - **`-28`** is the ABI number, bumped only when the kernel ABI changes. It
 *   is the part `uname -r` shows and the part module packages pin to.
 * - **`.28`** is the upload number, bumped on every build. It appears nowhere
 *   in `uname -r`, so two machines that agree there can still be running
 *   different builds.
 * - **`~24.04.1`**, when present, marks a **backport**: a newer series' kernel
 *   built for an older release, which is what Ubuntu's HWE kernels are. It is
 *   in the package version and not in `uname -r` either.
 *
 * The flavour on the end — `generic`, `lowlatency`, `azure`, `raspi` — is the
 * build variant. Cloud and board derivatives number their ABI from 1000
 * upwards, independently of `generic`'s, so a four-digit ABI is a derivative
 * rather than a machine that has seen a thousand ABI breaks. See
 * {@link isDerivative}.
 *
 * On Debian, Fedora, Arch and the rest this file does not exist, so a backend
 * that can read it at all is telling you the host is Ubuntu.
 */

/** What each build flavour is for. Anything absent is still shown. */
export const FLAVOURS: Readonly<Record<string, string>> = {
  generic: 'The default build, which is what a desktop or a server gets unless it asked otherwise',
  lowlatency: 'The same source with a faster tick and fuller preemption, for audio and the like',
  realtime: 'The PREEMPT_RT build, where the kernel itself is almost entirely preemptible',
  aws: 'Built for EC2, with its drivers in and much of the rest left out',
  azure: 'Built for Azure, with its drivers in and much of the rest left out',
  gcp: 'Built for Google Compute Engine, with its drivers in and much of the rest left out',
  oracle: 'Built for Oracle Cloud, with its drivers in and much of the rest left out',
  kvm: 'A cut-down build for KVM guests, with hardware support a virtual machine cannot use removed',
  raspi: 'Built for the Raspberry Pi, whose board support is not in the generic kernel',
  'generic-64k': 'The generic build with 64K pages, for arm64 servers that want the larger page',
  'generic-lpae': 'The generic build for 32-bit ARM with large physical addressing',
};

/** The ABI number cloud and board derivatives start counting from. */
export const DERIVATIVE_ABI = 1000;

export interface VersionSignature {
  /** The vendor, which in practice is always `Ubuntu`. */
  vendor: string;
  /** The package version whole, e.g. `7.0.0-28.28~24.04.1-generic`. */
  packageVersion: string;
  /** The upstream release the source really is, e.g. `7.0.12`. */
  upstream: string;
  /** The series base, whose last component Ubuntu freezes, e.g. `7.0.0`. */
  base: string | null;
  /** Bumped only on an ABI change, and the part `uname -r` shows. */
  abi: number | null;
  /** Bumped on every build, and shown nowhere in `uname -r`. */
  upload: number | null;
  /** The release this was backported to, e.g. `24.04.1`, or null. */
  backport: string | null;
  /** The build variant, e.g. `generic`. */
  flavour: string | null;
  /** The line as read, for showing what was parsed. */
  raw: string;
}

/** `<base>-<abi>.<upload>[~<backport>]-<flavour>`. */
const PACKAGE = /^(\d+(?:\.\d+)+)-(\d+)\.(\d+)(?:~([\w.]+))?-(.+)$/;

export function parseVersionSignature(text: string): VersionSignature | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const fields = trimmed.split(/\s+/);
    const [vendor, packageVersion, upstream] = fields;
    // The vendor and a package version are the least this can be.
    if (vendor === undefined || packageVersion === undefined) return null;

    const parts = PACKAGE.exec(packageVersion);

    return {
      vendor,
      packageVersion,
      // Every Ubuntu kernel prints all three, but do not invent the third.
      upstream: upstream ?? '',
      base: parts?.[1] ?? null,
      abi: parts?.[2] === undefined ? null : Number(parts[2]),
      upload: parts?.[3] === undefined ? null : Number(parts[3]),
      backport: parts?.[4] ?? null,
      flavour: parts?.[5] ?? null,
      raw: trimmed,
    };
  }

  return null;
}

/**
 * What `uname -r` would print for this kernel: the base, the ABI number and
 * the flavour. Neither the upload number nor a backport suffix survives into
 * it, which is the whole point of reading this file instead.
 */
export function unameRelease(signature: VersionSignature): string | null {
  const { base, abi, flavour } = signature;
  if (base === null || abi === null || flavour === null) return null;
  return `${base}-${abi}-${flavour}`;
}

/** What this flavour is for, or null for one this page has no note for. */
export function describeFlavour(flavour: string | null): string | null {
  return flavour === null ? null : (FLAVOURS[flavour] ?? null);
}

/**
 * Whether this is a derivative — a cloud or board kernel, which numbers its
 * ABI from 1000 upwards independently of the generic one.
 */
export function isDerivative(signature: VersionSignature): boolean {
  return signature.abi !== null && signature.abi >= DERIVATIVE_ABI;
}

/** Whether this kernel was backported to a release older than its series. */
export function isBackport(signature: VersionSignature): boolean {
  return signature.backport !== null;
}

/**
 * Whether the version `uname -r` reports differs from the upstream release the
 * tree really is — which is the ordinary case, and the reason for this file.
 */
export function hidesUpstream(signature: VersionSignature): boolean {
  return (
    signature.base !== null && signature.upstream !== '' && signature.base !== signature.upstream
  );
}

/** The `X.Y` series a version string belongs to, e.g. `7.0` from `7.0.12`. */
export function seriesOf(version: string): string | null {
  const match = /^(\d+\.\d+)/.exec(version);
  return match === null ? null : match[1]!;
}

/**
 * Whether the package version and the upstream release agree on the series.
 * They always should: the package is built from that upstream tree.
 */
export function seriesAgree(signature: VersionSignature): boolean {
  const base = signature.base === null ? null : seriesOf(signature.base);
  const upstream = signature.upstream === '' ? null : seriesOf(signature.upstream);
  if (base === null || upstream === null) return true;
  return base === upstream;
}

export interface VersionSignatureSummary {
  vendor: string;
  /** The number to quote when asked what upstream version this is. */
  upstream: string;
  /** What `uname -r` would say, which is not that number. */
  uname: string | null;
  abi: number | null;
  upload: number | null;
  flavour: string | null;
  backport: string | null;
  derivative: boolean;
  /** `uname -r` and the upstream release disagree, as they usually do. */
  hidesUpstream: boolean;
  /** The two version fields disagree about the series, which they should not. */
  seriesMismatch: boolean;
}

export function summarize(signature: VersionSignature): VersionSignatureSummary {
  return {
    vendor: signature.vendor,
    upstream: signature.upstream,
    uname: unameRelease(signature),
    abi: signature.abi,
    upload: signature.upload,
    flavour: signature.flavour,
    backport: signature.backport,
    derivative: isDerivative(signature),
    hidesUpstream: hidesUpstream(signature),
    seriesMismatch: !seriesAgree(signature),
  };
}

/** The parsed pieces, in the order they appear in the line. */
export interface SignatureField {
  label: string;
  value: string;
  /** What this piece of the line means. */
  note: string;
}

export function fieldsOf(signature: VersionSignature): SignatureField[] {
  const fields: SignatureField[] = [
    {
      label: 'vendor',
      value: signature.vendor,
      note: 'The distribution that built this kernel — only Ubuntu ships this file',
    },
  ];

  if (signature.base !== null) {
    fields.push({
      label: 'base version',
      value: signature.base,
      note: 'The series, with its last component frozen — it does not move as stable releases land',
    });
  }

  if (signature.abi !== null) {
    fields.push({
      label: 'ABI number',
      value: String(signature.abi),
      note: 'Bumped only when the kernel ABI changes. This is the part uname -r shows',
    });
  }

  if (signature.upload !== null) {
    fields.push({
      label: 'upload number',
      value: String(signature.upload),
      note: 'Bumped on every build, and shown nowhere in uname -r',
    });
  }

  if (signature.backport !== null) {
    fields.push({
      label: 'backported to',
      value: signature.backport,
      note: 'A newer series built for an older release — what an HWE kernel is',
    });
  }

  if (signature.flavour !== null) {
    fields.push({
      label: 'flavour',
      value: signature.flavour,
      note: describeFlavour(signature.flavour) ?? 'A build variant this page has no note for',
    });
  }

  if (signature.upstream !== '') {
    fields.push({
      label: 'upstream release',
      value: signature.upstream,
      note: 'The stable release this source really is, which is the number worth quoting',
    });
  }

  return fields;
}
