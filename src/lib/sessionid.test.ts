import { describe, expect, it } from 'vitest';
import { readSessionIdFixture as sessionid } from '../test/fixtures';
import {
  isEmpty,
  isUnreadable,
  isUnset,
  parseSessionId,
  sameSession,
  UNSET,
} from './sessionid';

describe('parseSessionId', () => {
  it('reads the number a login session was given', () => {
    expect(parseSessionId(sessionid('desktop'))).toMatchObject({
      id: 2,
      set: true,
      terminated: false,
      bytes: 1,
    });
  });

  /** The kernel writes the number and stops, as it does for `wchan`. */
  it('notices a trailing newline, which the kernel does not write', () => {
    expect(parseSessionId('2').terminated).toBe(false);
    expect(parseSessionId('2\n')).toMatchObject({ id: 2, set: true, terminated: true, bytes: 2 });
  });

  /**
   * `(unsigned int)-1` is not session zero: it is the kernel saying no login
   * session owns this process, which is the ordinary answer for most of them.
   */
  it('reads the unset value as unset rather than as a session', () => {
    const pid1 = parseSessionId(sessionid('desktop', '1'));

    expect(pid1.id).toBe(UNSET);
    expect(pid1.set).toBe(false);
    expect(isUnset(pid1)).toBe(true);
  });

  it('does not take zero for the unset value', () => {
    const zero = parseSessionId('0');

    expect(zero).toMatchObject({ id: 0, set: true });
    expect(isUnset(zero)).toBe(false);
  });

  it('has nothing to read in an empty file', () => {
    const empty = parseSessionId('');

    expect(empty).toMatchObject({ id: null, set: false, bytes: 0 });
    expect(isEmpty(empty)).toBe(true);
    expect(isUnreadable(empty)).toBe(false);
  });

  /** The kernel prints it with `%u`; anything else came from somewhere else. */
  it('refuses what is not a number the kernel would write', () => {
    for (const text of ['-1', '2 3', 'none', '0x2', '2.0']) {
      const parsed = parseSessionId(text);

      expect(parsed.id, text).toBeNull();
      expect(isUnreadable(parsed), text).toBe(true);
    }
  });

  it('counts the bytes the file held', () => {
    expect(parseSessionId(sessionid('no-login')).bytes).toBe(10);
  });
});

/**
 * The question the file exists to answer: whether two processes came out of the
 * same login — which is what makes an audit trail a trail rather than a list.
 */
describe('sameSession', () => {
  it('is true for two processes of one login', () => {
    const shell = parseSessionId(sessionid('desktop'));
    const browser = parseSessionId(sessionid('desktop', '12282'));

    expect(sameSession(shell, browser)).toBe(true);
  });

  it('is false across two logins', () => {
    const mine = parseSessionId(sessionid('two-logins'));
    const theirs = parseSessionId(sessionid('two-logins', '5150'));

    expect(mine.id).toBe(7);
    expect(theirs.id).toBe(3);
    expect(sameSession(mine, theirs)).toBe(false);
  });

  /** Two processes with no session are not in one session together. */
  it('is false for two processes that have no session at all', () => {
    const daemon = parseSessionId(sessionid('two-logins', '901'));
    const init = parseSessionId(sessionid('no-login', '1'));

    expect(isUnset(daemon)).toBe(true);
    expect(isUnset(init)).toBe(true);
    expect(sameSession(daemon, init)).toBe(false);
  });
});
