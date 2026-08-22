import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPidSetgroupsFixture as fixture } from '../test/fixtures';
import {
  certainlyFails,
  conditions,
  describeOrigin,
  isAllowed,
  isDenied,
  isEmpty,
  isFinal,
  isUnreadable,
  parseSetgroups,
  SETGROUPS_ALLOW,
  SETGROUPS_DENY,
  summarize,
} from './pid-setgroups';
import { parseGidMap, setgroupsEvidence } from './gid_map';

describe('parseSetgroups — the ordinary answer', () => {
  const setgroups = parseSetgroups(fixture('allow'));

  it('reads the word and the newline the kernel writes', () => {
    expect(setgroups.setting).toBe(SETGROUPS_ALLOW);
    expect(setgroups.value).toBe('allow');
    expect(setgroups.printed).toBe(true);
    expect(setgroups.terminated).toBe(true);
    expect(setgroups.bytes).toBe(6);
  });

  it('is allowed, and that answer can still change', () => {
    expect(isAllowed(setgroups)).toBe(true);
    expect(isDenied(setgroups)).toBe(false);
    expect(isFinal(setgroups)).toBe(false);
    expect(certainlyFails(setgroups)).toBe(false);
  });

  /** The flag belongs to the namespace, so two pids of one read the same word. */
  it('says the same thing under either pid of one namespace', () => {
    expect(parseSetgroups(fixture('allow', '1')).setting).toBe(SETGROUPS_ALLOW);
    expect(parseSetgroups(fixture('allow', '1')).value).toBe(setgroups.value);
  });
});

describe('parseSetgroups — a namespace that gave setgroups up', () => {
  const setgroups = parseSetgroups(fixture('denied'));

  it('reads deny as the settled answer it is', () => {
    expect(setgroups.setting).toBe(SETGROUPS_DENY);
    expect(isDenied(setgroups)).toBe(true);
    expect(isFinal(setgroups)).toBe(true);
    expect(certainlyFails(setgroups)).toBe(true);
  });

  it('is the same for every process in that namespace', () => {
    expect(parseSetgroups(fixture('denied', '4242')).setting).toBe(SETGROUPS_DENY);
  });

  /** Denying is what an unprivileged writer trades for a gid_map at all. */
  it('reads the denial as the unprivileged bargain', () => {
    expect(describeOrigin(setgroups)!.summary).toContain('before writing gid_map');
    expect(describeOrigin(setgroups)!.certain).toBe(false);
  });
});

/** Two namespaces on one machine answer differently without either changing. */
describe('parseSetgroups — two namespaces side by side', () => {
  it('answers per namespace rather than per machine', () => {
    expect(parseSetgroups(fixture('mixed', '1')).setting).toBe(SETGROUPS_ALLOW);
    expect(parseSetgroups(fixture('mixed')).setting).toBe(SETGROUPS_ALLOW);
    expect(parseSetgroups(fixture('mixed', '3117')).setting).toBe(SETGROUPS_DENY);
  });
});

/**
 * The page's point: `userns_may_setgroups` wants three things and this file
 * reports one, so `allow` is necessary and not sufficient.
 */
describe('the three conditions', () => {
  it('names three, of which this file answers exactly one', () => {
    const checks = conditions(parseSetgroups(fixture('allow')));

    expect(checks).toHaveLength(3);
    expect(checks.filter((check) => check.reported)).toHaveLength(1);
    expect(checks[0]!.reported).toBe(true);
    expect(summarize(parseSetgroups(fixture('allow'))).unreported).toBe(2);
  });

  it('points the other two at the files that do answer them', () => {
    const checks = conditions(parseSetgroups(fixture('allow')));

    expect(checks[1]!.where).toBe('/proc/<pid>/gid_map');
    expect(checks[2]!.where).toBe('/proc/<pid>/status');
    expect(checks[1]!.met).toBeNull();
    expect(checks[2]!.met).toBeNull();
  });

  it('marks the one it does answer as met or not', () => {
    expect(conditions(parseSetgroups(fixture('allow')))[0]!.met).toBe(true);
    expect(conditions(parseSetgroups(fixture('denied')))[0]!.met).toBe(false);
    // Nothing to answer with at all, for a file holding neither word.
    expect(conditions(parseSetgroups('nonsense\n'))[0]!.met).toBeNull();
  });

  /** deny is an `and` that has already failed, so the other two stop mattering. */
  it('is the whole answer only when it is deny', () => {
    expect(certainlyFails(parseSetgroups(fixture('denied')))).toBe(true);
    expect(certainlyFails(parseSetgroups(fixture('allow')))).toBe(false);
  });
});

describe('parseSetgroups — what is not this file', () => {
  it('reads an empty file as empty rather than as a word', () => {
    const setgroups = parseSetgroups('');

    expect(isEmpty(setgroups)).toBe(true);
    expect(isUnreadable(setgroups)).toBe(false);
    expect(setgroups.setting).toBeNull();
    expect(describeOrigin(setgroups)).toBeNull();
  });

  it('refuses anything that is neither of the two words', () => {
    const setgroups = parseSetgroups('maybe\n');

    expect(isUnreadable(setgroups)).toBe(true);
    expect(setgroups.setting).toBeNull();
    expect(summarize(setgroups)).toMatchObject({ setting: null, allowed: false, denied: false });
  });

  /** `seq_printf` writes the word in lower case with one newline after it. */
  it('reads a reformatted word, and says it is not the kernel’s shape', () => {
    expect(parseSetgroups('ALLOW\n')).toMatchObject({
      setting: SETGROUPS_ALLOW,
      printed: false,
    });
    expect(parseSetgroups('deny')).toMatchObject({
      setting: SETGROUPS_DENY,
      printed: false,
      terminated: false,
    });
    expect(parseSetgroups('  deny  \n').setting).toBe(SETGROUPS_DENY);
  });
});

/**
 * The `gid_map` page cannot read this file — a page reads the one path its URL
 * names — so it infers the value from the shape of the map instead. These
 * captures are what that inference is claiming, so they are checked against it:
 * change a `gid_map` capture and the `setgroups` beside it has to move too.
 */
describe('the machine captures, against what the gid_map page infers', () => {
  const root = resolve(process.cwd(), 'server/machines');
  const machines = ['container', 'desktop', 'raspberry-pi', 'server', 'vm'];
  const pids = ['1', '12282', 'self'];

  const dirOf = (machine: string, pid: string) => resolve(root, machine, 'proc', pid);
  const withGidMap = machines.flatMap((machine) =>
    pids
      .map((pid) => ({ machine, pid }))
      .filter(({ pid }) => existsSync(resolve(dirOf(machine, pid), 'gid_map'))),
  );

  /** The two are a pair: the rule this file holds is the rule about that one. */
  it('has a setgroups beside every gid_map, and beside nothing else', () => {
    for (const machine of machines) {
      for (const pid of pids) {
        const dir = dirOf(machine, pid);
        expect(
          existsSync(resolve(dir, 'setgroups')),
          `${machine}/${pid} setgroups`,
        ).toBe(existsSync(resolve(dir, 'gid_map')));
      }
    }
    expect(withGidMap).toHaveLength(13);
  });

  it.each(withGidMap)('$machine/$pid says what its own gid_map implies', ({ machine, pid }) => {
    const dir = dirOf(machine, pid);
    const setgroups = parseSetgroups(readFileSync(resolve(dir, 'setgroups'), 'utf8'));
    const evidence = setgroupsEvidence(parseGidMap(readFileSync(resolve(dir, 'gid_map'), 'utf8')));

    expect(evidence.value).not.toBeNull();
    expect(setgroups.setting).toBe(evidence.value);
  });

  it.each(withGidMap)('$machine/$pid is written the way the kernel writes it', ({ machine, pid }) => {
    const setgroups = parseSetgroups(
      readFileSync(resolve(dirOf(machine, pid), 'setgroups'), 'utf8'),
    );

    expect(setgroups.printed).toBe(true);
    expect(setgroups.setting).not.toBeNull();
  });

  /**
   * Every capture here reads `allow`, and that is not an oversight: none of the
   * five machines was set up by an unprivileged `unshare -U`, so none of them
   * had to strike the bargain. The `deny` shapes are in the fixtures.
   */
  it('reads allow on all five, because none of them is a rootless unshare', () => {
    for (const { machine, pid } of withGidMap) {
      const setgroups = parseSetgroups(
        readFileSync(resolve(dirOf(machine, pid), 'setgroups'), 'utf8'),
      );

      expect(isAllowed(setgroups), `${machine}/${pid}`).toBe(true);
    }
    // And the fixtures carry the answer the captures cannot.
    expect(isDenied(parseSetgroups(fixture('denied')))).toBe(true);
  });
});
