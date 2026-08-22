/**
 * Parser for `/proc/<pid>/setgroups` — whether `setgroups()` may be called in
 * this process's user namespace.
 *
 * One word and a newline, and there are only two of them:
 *
 *     deny
 *
 * `proc_setgroups_show` prints `allow` or `deny` out of one flag bit,
 * `USERNS_SETGROUPS_ALLOWED`. This is the file `/proc/<pid>/gid_map` cannot be
 * written without — since Linux {@link SETGROUPS_SINCE} an unprivileged process
 * must write `deny` here first — so the pair is best read together, and
 * `src/lib/gid_map.ts` is where the rule around the write is written down.
 *
 * Five things it is read wrong for:
 *
 *  - **`allow` does not mean `setgroups()` will work.** `userns_may_setgroups`
 *    needs **three** things and this file reports one of them: the flag, *and*
 *    a `gid_map` that has been written, *and* `CAP_SETGID` in the namespace. A
 *    fresh user namespace reads `allow` and every `setgroups()` in it still
 *    fails, because there is no `gid_map` yet. See {@link CONDITIONS}.
 *  - **`deny` is a final answer, and `allow` is only a maybe.** The asymmetry
 *    is the whole shape of the file: denying is one-way — writing `allow` over
 *    a `deny` is `EPERM`, for the lifetime of the namespace — so `deny` settles
 *    the question and `allow` merely fails to settle it. See {@link isFinal}.
 *  - **It is a property of the namespace, not of the process.** The flag hangs
 *    off `user_namespace`, so every process sharing one reads the same word,
 *    and reading it under a different pid does not ask a different question.
 *    That it lives under `/proc/<pid>/` makes it look per-process, and it is
 *    not — `uid_map` and `gid_map` are the same way.
 *  - **The order is fixed, and each write closes the other door.**
 *    `setgroups` has to be written before `gid_map`: once `gid_map` has any
 *    extent, writing `deny` here is `EPERM`. So a namespace either gave up
 *    `setgroups()` before it had any groups to speak of, or it never can.
 *  - **A denial is inherited.** A namespace created inside one that has denied
 *    starts denied too, which is what stops the restriction being escaped by
 *    nesting another namespace inside the first.
 *
 * Why the file exists at all is {@link SETGROUPS_CVE}: before it, an
 * unprivileged user could make a user namespace and **drop** a supplementary
 * group, which defeats a *negative* group permission — a file whose group bits
 * grant less than its other bits, where being in the group is exactly what
 * denies you.
 *
 * Mode 0644: every user on the machine reads it, and writing it needs privilege
 * over the namespace. In the initial user namespace it reads `allow` and can
 * never be written, because that namespace's `gid_map` was filled in before
 * anything could ask.
 */
import { SETGROUPS_ALLOW, SETGROUPS_CVE, SETGROUPS_DENY, SETGROUPS_SINCE } from './gid_map';

// The two words, the release and the CVE are `gid_map`'s — that page reasons
// about this file and this one holds its value, and what the words are is one
// fact rather than two that have to agree.
export { SETGROUPS_ALLOW, SETGROUPS_CVE, SETGROUPS_DENY, SETGROUPS_SINCE };

/** The only two things this file can say. */
export type Setting = typeof SETGROUPS_ALLOW | typeof SETGROUPS_DENY;

export interface Setgroups {
  /** The file exactly as it was read. */
  raw: string;
  /** What it held, with the newline off. */
  value: string;
  /** Which of the two words it is, or null for anything else. */
  setting: Setting | null;
  /** Whether it is written the way `seq_printf` writes it: lower case, one newline. */
  printed: boolean;
  /** Whether the file ended with the newline the kernel writes. */
  terminated: boolean;
  bytes: number;
}

export function parseSetgroups(text: string): Setgroups {
  const bytes = new TextEncoder().encode(text).length;
  const terminated = text.endsWith('\n');
  const value = text.trim();
  const lower = value.toLowerCase();

  const setting: Setting | null =
    lower === SETGROUPS_ALLOW ? SETGROUPS_ALLOW : lower === SETGROUPS_DENY ? SETGROUPS_DENY : null;

  return {
    raw: text,
    value,
    setting,
    printed: text === `${SETGROUPS_ALLOW}\n` || text === `${SETGROUPS_DENY}\n`,
    terminated,
    bytes,
  };
}

/** Whether there was nothing in the file at all. */
export function isEmpty(setgroups: Setgroups): boolean {
  return setgroups.value === '';
}

/** Whether it held something that is neither of the two words. */
export function isUnreadable(setgroups: Setgroups): boolean {
  return setgroups.setting === null && !isEmpty(setgroups);
}

/** Whether the flag is set — which is necessary and not sufficient. */
export function isAllowed(setgroups: Setgroups): boolean {
  return setgroups.setting === SETGROUPS_ALLOW;
}

/** Whether it is cleared, which settles the question for good. */
export function isDenied(setgroups: Setgroups): boolean {
  return setgroups.setting === SETGROUPS_DENY;
}

/**
 * Whether this answer can still change. Denying is one-way — writing `allow`
 * over a `deny` is `EPERM` for the lifetime of the namespace — so a `deny` is
 * final and an `allow` is not.
 */
export function isFinal(setgroups: Setgroups): boolean {
  return isDenied(setgroups);
}

/**
 * Whether `setgroups()` is certainly going to fail. True only for `deny`: an
 * `allow` says one of three conditions is met and nothing about the other two.
 */
export function certainlyFails(setgroups: Setgroups): boolean {
  return isDenied(setgroups);
}

/** One of the three things `userns_may_setgroups` wants. */
export interface Condition {
  name: string;
  what: string;
  /** Whether **this file** is the one that answers it. */
  reported: boolean;
  /** Where it is answered here: whether it is met. Null for the other two. */
  met: boolean | null;
  /** Where the answer actually lives, for the two this file does not carry. */
  where?: string;
}

/**
 * The three conditions `setgroups()` has to clear, with this file's answer
 * against the one it reports.
 *
 * Written out rather than summarised because the point of the page is that
 * **this file is one of three**, and a reader who takes `allow` for permission
 * has mistaken a third of the answer for the whole of it.
 */
export function conditions(setgroups: Setgroups): Condition[] {
  return [
    {
      name: 'the namespace still allows it',
      what: 'The USERNS_SETGROUPS_ALLOWED flag, which is what this file prints. Cleared once and never set again.',
      reported: true,
      met: setgroups.setting === null ? null : isAllowed(setgroups),
    },
    {
      name: 'a gid_map has been written',
      what: 'Groups mean nothing in a namespace with no mapping, so the kernel refuses setgroups() until one exists — which is why a brand-new namespace reads allow here and still cannot call it.',
      reported: false,
      met: null,
      where: '/proc/<pid>/gid_map',
    },
    {
      name: 'the caller holds CAP_SETGID here',
      what: 'The ordinary capability check, made against this namespace rather than the one above it.',
      reported: false,
      met: null,
      where: '/proc/<pid>/status',
    },
  ];
}

/** How this namespace most likely came to hold this value. */
export interface Origin {
  /** What must have happened. */
  summary: string;
  /** Whether it is settled by the value or merely likely. */
  certain: boolean;
}

/**
 * What the value says about how the namespace was made.
 *
 * `deny` is close to a signature: the kernel refuses it once `gid_map` has any
 * extent, so someone wrote it **before** the map — and the reason to do that is
 * to be allowed to write the map at all, which is the unprivileged path. `allow`
 * says much less: the initial namespace reads it, and so does any namespace
 * whose maps were written by something holding `CAP_SETGID`.
 */
export function describeOrigin(setgroups: Setgroups): Origin | null {
  if (isDenied(setgroups)) {
    return {
      summary:
        'someone wrote deny here before writing gid_map, which is the one way an unprivileged process is allowed to map any group at all',
      certain: false,
    };
  }

  if (isAllowed(setgroups)) {
    return {
      summary:
        'nothing has ever denied it — the initial user namespace, or one whose maps were written by something already holding CAP_SETGID, which needs no denial',
      certain: false,
    };
  }

  return null;
}

export interface SetgroupsSummary {
  setting: Setting | null;
  allowed: boolean;
  denied: boolean;
  /** Whether the answer can still change. */
  final: boolean;
  /** Conditions this file does not report, which is two of the three. */
  unreported: number;
  bytes: number;
}

export function summarize(setgroups: Setgroups): SetgroupsSummary {
  return {
    setting: setgroups.setting,
    allowed: isAllowed(setgroups),
    denied: isDenied(setgroups),
    final: isFinal(setgroups),
    unreported: conditions(setgroups).filter((condition) => !condition.reported).length,
    bytes: setgroups.bytes,
  };
}
