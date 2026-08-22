import { describe, expect, it } from 'vitest';
import { readPidEnvironFixture as fixture } from '../test/fixtures';
import {
  duplicates,
  entryCount,
  formatBytes,
  isEmpty,
  isMultiline,
  isSecret,
  isShadowed,
  lookup,
  parsePidEnviron,
  secretsIn,
  SEPARATOR,
  summarize,
} from './pid-environ';

describe('parsePidEnviron — a desktop login shell', () => {
  const environment = parsePidEnviron(fixture('login-shell'));
  const variableFor = (name: string) =>
    environment.variables.find((variable) => variable.name === name)!;

  it('reads the block as one variable per NUL-separated entry', () => {
    expect(environment.variables).toHaveLength(17);
    expect(environment.strays).toEqual([]);
    expect(variableFor('USER')).toMatchObject({ name: 'USER', value: 'develop' });
    expect(variableFor('HOME').value).toBe('/home/develop');
  });

  /** `LS_COLORS=rs=0:di=01;34:…` is one variable, not a name with `rs` in it. */
  it('splits an entry at its first equals sign and no other', () => {
    const colours = variableFor('LS_COLORS');

    expect(colours.value.startsWith('rs=0:di=01;34')).toBe(true);
    expect(colours.value).toContain('*.tar=01;31');
    expect(environment.variables.filter((variable) => variable.name === 'rs')).toEqual([]);
  });

  it('keeps the order the loader wrote, which is what getenv walks', () => {
    expect(environment.variables[0]!.name).toBe('SHELL');
    expect(variableFor('_').index).toBe(environment.variables.length - 1);
    expect(lookup(environment, 'TERM')).toBe('xterm-256color');
    expect(lookup(environment, 'NOTHING_LIKE_THIS')).toBeNull();
  });

  it('counts the bytes the file held and sees the terminating NUL', () => {
    expect(environment.bytes).toBe(new TextEncoder().encode(fixture('login-shell')).length);
    expect(environment.terminated).toBe(true);
    expect(environment.padding).toBe(0);
    expect(isEmpty(environment)).toBe(false);
  });

  it('summarizes the block', () => {
    expect(summarize(environment)).toMatchObject({ variables: 17, strays: 0, duplicates: [] });
    // The longest value on nearly every machine, and worth knowing about.
    expect(summarize(environment).longest?.name).toBe('LS_COLORS');
    expect(summarize(environment).secrets).toEqual([]);
  });
});

/**
 * The file is 0400 where `/proc/<pid>/cmdline` is 0444, which is the whole
 * reason a credential goes in a variable rather than an argument — and still
 * worth pointing at, since it is on the page now.
 */
describe('parsePidEnviron — a build agent carrying credentials', () => {
  const environment = parsePidEnviron(fixture('with-secrets'));
  const secrets = secretsIn(environment.variables);
  const named = (name: string) => secrets.find((secret) => secret.name === name);

  it('finds a variable named for what its value is', () => {
    expect(named('GITHUB_TOKEN')?.reason).toBe('the value of GITHUB_TOKEN');
    expect(named('AWS_SECRET_ACCESS_KEY')).toBeDefined();
  });

  it('finds credentials written into a URL', () => {
    expect(named('DATABASE_URL')?.reason).toBe('a URL with a password in it');
  });

  /** Named for a secret and holding nothing, which discloses nothing. */
  it('says nothing about an empty value', () => {
    expect(named('REGISTRY_PASSWORD')).toBeUndefined();
  });

  /** A false accusation on this page is worse than a miss. */
  it('leaves alone a name that only sounds like one', () => {
    expect(named('SSH_AUTH_SOCK')).toBeUndefined();
    expect(named('AWS_DEFAULT_REGION')).toBeUndefined();
    expect(named('RUNNER_NAME')).toBeUndefined();
  });

  /**
   * `PWD` is the working directory in an environment; `--pwd` on a command
   * line is usually a password. Same spelling, different file.
   */
  it('does not take PWD for a password', () => {
    const shell = parsePidEnviron(fixture('login-shell'));

    expect(secretsIn(shell.variables)).toEqual([]);
    expect(secretsIn([{ name: 'PWD', value: '/home/develop', index: 0 }])).toEqual([]);
    expect(secretsIn([{ name: 'OLDPWD', value: '/tmp', index: 0 }])).toEqual([]);
    // The name still means what it means on a command line.
    expect(secretsIn([{ name: 'DB_PWD', value: 'hunter2', index: 0 }])).toHaveLength(1);
  });

  it('marks the rows that carry one', () => {
    const token = environment.variables.find((variable) => variable.name === 'GITHUB_TOKEN')!;
    const region = environment.variables.find((variable) => variable.name === 'AWS_DEFAULT_REGION')!;

    expect(isSecret(secrets, token)).toBe(true);
    expect(isSecret(secrets, region)).toBe(false);
    expect(summarize(environment).secrets).toHaveLength(3);
  });
});

describe('parsePidEnviron — what pid 1 was handed', () => {
  const environment = parsePidEnviron(fixture('systemd-init', '1'));

  it('reads the four variables an init gets and nothing a session adds', () => {
    expect(environment.variables.map((variable) => variable.name)).toEqual([
      'HOME',
      'init',
      'NOTIFY_SOCKET',
      'SYSTEMD_EXEC_PID',
    ]);
    expect(lookup(environment, 'HOME')).toBe('/');
  });
});

/** No `mm` to print from: a kernel thread, or a process already gone. */
describe('parsePidEnviron — nothing to print', () => {
  const environment = parsePidEnviron(fixture('kernel-thread', '1234'));

  it('reads an empty file as empty rather than as one empty entry', () => {
    expect(environment).toEqual({
      variables: [],
      strays: [],
      bytes: 0,
      terminated: false,
      padding: 0,
    });
    expect(isEmpty(environment)).toBe(true);
    expect(entryCount(environment)).toBe(0);
  });
});

describe('parsePidEnviron — the shapes a block can hold', () => {
  const environment = parsePidEnviron(fixture('odd-entries'));

  /** `execve` takes any strings; `getenv` can never return one without `=`. */
  it('keeps an entry with no equals sign apart from the variables', () => {
    expect(environment.strays).toEqual([{ index: 1, text: 'BROKEN_ENTRY_NO_EQUALS' }]);
    expect(environment.variables.some((variable) => variable.name.startsWith('BROKEN'))).toBe(false);
    expect(entryCount(environment)).toBe(environment.variables.length + 1);
  });

  /** `NAME=` is a variable with an empty value, which is not the same thing. */
  it('reads an empty value as a value', () => {
    expect(lookup(environment, 'EMPTY')).toBe('');
  });

  /** Nothing deduplicates the block, and getenv takes the first. */
  it('keeps a name written twice, and says which one counts', () => {
    const editors = environment.variables.filter((variable) => variable.name === 'EDITOR');

    expect(editors.map((variable) => variable.value)).toEqual(['vi', 'nano']);
    expect(lookup(environment, 'EDITOR')).toBe('vi');
    expect(duplicates(environment)).toEqual(['EDITOR']);
    expect(isShadowed(environment, editors[0]!)).toBe(false);
    expect(isShadowed(environment, editors[1]!)).toBe(true);
  });

  it('keeps a value written across two lines', () => {
    const motd = environment.variables.find((variable) => variable.name === 'MOTD')!;

    expect(isMultiline(motd)).toBe(true);
    expect(motd.value).toContain('\n');
  });

  /** Past the terminator, a run of NULs is space rather than empty entries. */
  it('reads trailing NULs as padding', () => {
    expect(environment.terminated).toBe(true);
    expect(environment.padding).toBe(3);
    expect(environment.variables.at(-1)!.name).toBe('TERM');
  });
});

describe('parsePidEnviron — what is not a block of this kind', () => {
  it('reads nothing out of an empty file', () => {
    expect(parsePidEnviron('')).toMatchObject({ variables: [], strays: [], bytes: 0 });
  });

  /** One entry and no separator at all, which is what a single variable is. */
  it('reads a block with no NUL in it', () => {
    const environment = parsePidEnviron('LANG=C');

    expect(environment.variables).toHaveLength(1);
    expect(environment.terminated).toBe(false);
    expect(environment.padding).toBe(0);
  });

  it('separates on NUL and on nothing else', () => {
    expect(SEPARATOR).toBe('\0');
    const environment = parsePidEnviron(`A=1 2 3${SEPARATOR}B=x\ty${SEPARATOR}`);

    expect(environment.variables.map((variable) => variable.value)).toEqual(['1 2 3', 'x\ty']);
  });
});

describe('formatBytes', () => {
  it('shows a block in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(940)).toBe('940 B');
    expect(formatBytes(3481)).toBe('3.4 KiB');
  });
});
