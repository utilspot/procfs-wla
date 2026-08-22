/**
 * Parser for `/proc/<pid>/sessionid` — the audit session this process belongs
 * to, if it belongs to one.
 *
 * One decimal number, and that is the whole file:
 *
 *   2
 *
 * **It is not the session `setsid()` makes.** That one is a pid, it is what
 * `getsid()` returns, and it lives in field 6 of `/proc/<pid>/stat`. This is the
 * kernel *audit* subsystem's session id: a counter the kernel bumps when a
 * login is recorded, handed to that login's first process and inherited by
 * everything it starts. Two files with the word "session" in them, describing
 * two unrelated things, one of which is a pid and one of which is not.
 *
 * What makes it worth reading:
 *
 * - **It survives `su` and `sudo`.** Changing user changes the uid, the
 *   process, and nothing here: the session id follows the whole tree from the
 *   login that started it. That is the point of it — it is what lets `auditd`
 *   put "root deleted the file" and "this person logged in at 09:14" on the
 *   same string, and it pairs with `/proc/<pid>/loginuid`, which holds *who*
 *   that login was.
 * - **{@link UNSET} means no login session**, not session zero. The kernel
 *   writes `(unsigned int)-1` — 4294967295 — for a process that no login
 *   started: `init`, a daemon the boot brought up, a kernel thread, or anything
 *   in a container where nothing ever wrote `loginuid`. It is the ordinary
 *   answer for most of a machine's processes, not an error.
 * - **It is set once.** The kernel allocates it when `loginuid` is written —
 *   which `pam_loginuid` does at login — and with
 *   `CONFIG_AUDIT_LOGINUID_IMMUTABLE` it can never be written again, not even
 *   by root. A process with the wrong one has it for life.
 * - **The file exists only with `CONFIG_AUDIT`.** On a kernel built without
 *   it there is nothing here to read at all, and the backend answers 404 —
 *   which is a different thing from {@link UNSET}, and reads the same to
 *   anybody who is not looking closely.
 *
 * Like `/proc/<pid>/wchan`, the kernel writes the number with no trailing
 * newline. Unlike it, this file needs no `ptrace` access: it is readable by
 * anyone, for every process on the machine.
 */

/**
 * `(unsigned int)-1`, which is what the kernel writes for a process that no
 * login session owns. `AUDIT_SID_UNSET` in `include/uapi/linux/audit.h`.
 */
export const UNSET = 4294967295;

export interface SessionId {
  /** The number in the file, or null where it did not hold one. */
  id: number | null;
  /** Whether a login session owns this process, i.e. the id is not {@link UNSET}. */
  set: boolean;
  /**
   * Whether the file ended with a newline. The kernel writes none, so true is
   * the tell that something in between has been reformatting it.
   */
  terminated: boolean;
  /** Bytes the file held. */
  bytes: number;
  raw: string;
}

export function parseSessionId(text: string): SessionId {
  const bytes = new TextEncoder().encode(text).length;
  const terminated = text.endsWith('\n');
  const value = text.trim();

  // A decimal, and nothing else: the kernel prints it with `%u`, so a file
  // holding anything else is not one of these however it parses.
  const id = /^\d+$/.test(value) ? Number(value) : null;

  return {
    id,
    set: id !== null && id !== UNSET,
    terminated,
    bytes,
    raw: text,
  };
}

/** Whether the kernel wrote its "no login session" value. */
export function isUnset(session: SessionId): boolean {
  return session.id === UNSET;
}

/** Whether there is nothing in the file at all. */
export function isEmpty(session: SessionId): boolean {
  return session.raw.trim() === '';
}

/** Whether the file held something that is not a number the kernel would write. */
export function isUnreadable(session: SessionId): boolean {
  return session.id === null && !isEmpty(session);
}

/**
 * Whether two processes belong to the same login session — the question this
 * file exists to answer, and the reason a page for it shows the number plainly
 * rather than dressing it up.
 */
export function sameSession(a: SessionId, b: SessionId): boolean {
  return a.set && b.set && a.id === b.id;
}
