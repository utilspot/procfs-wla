import { describe, expect, it } from 'vitest';
import { readPidCmdlineFixture as fixture } from '../test/fixtures';
import {
  formatBytes,
  formatCommand,
  isEmpty,
  isLoginShell,
  isTitle,
  parsePidCmdline,
  program,
  quoteArgument,
  secretsIn,
  summarize,
} from './pid-cmdline';

describe('parsePidCmdline — an ordinary command', () => {
  const command = parsePidCmdline(fixture('desktop', 'self'));

  /** The NULs are the whole format, and the reason `cat` looks broken. */
  it('splits the vector on the NUL between arguments', () => {
    expect(command.args).toEqual(['grep', '--color=auto', '-rn', 'TODO', 'src']);
    expect(command.separated).toBe(true);
  });

  it('counts the bytes the file held, separators included', () => {
    expect(command.bytes).toBe(31);
  });

  /** The kernel writes one after the last argument; it is not an argument. */
  it('does not read the closing NUL as an empty argument', () => {
    expect(command.terminated).toBe(true);
    expect(command.args).toHaveLength(5);
    expect(command.padding).toBe(0);
  });

  it('takes argv[0] as what is running, without its path', () => {
    expect(program(command)).toBe('grep');
  });
});

describe('parsePidCmdline — the shapes a file can take', () => {
  /** A kernel thread never had a vector; a zombie no longer has one. */
  it('reads an empty file as no argument vector at all', () => {
    const command = parsePidCmdline(fixture('kernel-thread', '142'));

    expect(command).toEqual({
      args: [],
      bytes: 0,
      terminated: false,
      separated: false,
      padding: 0,
    });
    expect(isEmpty(command)).toBe(true);
    expect(program(command)).toBeNull();
  });

  it('keeps an empty argument in the middle, which is a real one', () => {
    const command = parsePidCmdline(fixture('desktop', '3117'));

    expect(command.args).toEqual([
      '/bin/sh',
      '-c',
      'exec /usr/local/bin/backup.sh "$@"',
      '',
      '--dry-run',
      '/srv/data',
    ]);
    expect(command.padding).toBe(0);
  });

  /**
   * A process that rewrote its argv leaves the space it no longer uses as
   * NULs. Byte for byte that is the same as that many empty arguments at the
   * end, and this reads it as padding — with the count, so the reading shows.
   */
  it('reads the NULs past the terminator as padding rather than arguments', () => {
    const command = parsePidCmdline(fixture('rewritten-title', 'self'));

    expect(command.args).toEqual(['postgres: 16/main: checkpointer']);
    expect(command.bytes).toBe(118);
    expect(command.terminated).toBe(true);
    expect(command.padding).toBe(86);
  });

  it('reads a title with no NUL in it at all', () => {
    const command = parsePidCmdline(fixture('rewritten-title', '901'));

    expect(command.args).toEqual(['nginx: worker process']);
    expect(command.separated).toBe(false);
    expect(command.terminated).toBe(false);
    expect(command.padding).toBe(0);
  });

  it('reads a vector of one', () => {
    const command = parsePidCmdline(fixture('login-shell', 'self'));

    expect(command.args).toEqual(['-bash']);
    expect(command.terminated).toBe(true);
  });

  it('reads a long vector of flags', () => {
    const command = parsePidCmdline(fixture('desktop', '12282'));

    expect(command.args).toHaveLength(14);
    expect(command.args[0]).toBe('/usr/lib/chromium/chromium');
    // A flag whose value ends in a comma, and one carrying no value at all.
    expect(command.args).toContain('--enable-crash-reporter=,');
    expect(command.args).toContain('--variations-seed-version');
  });

  it('counts bytes rather than JavaScript’s UTF-16 units', () => {
    // Three arguments of one character each, two of which are three bytes.
    expect(parsePidCmdline('ä\0€\0a\0').bytes).toBe(9);
  });
});

describe('isTitle', () => {
  it('is true where a process wrote a status line over its own argv', () => {
    expect(isTitle(parsePidCmdline(fixture('rewritten-title', 'self')))).toBe(true);
    expect(isTitle(parsePidCmdline(fixture('rewritten-title', '901')))).toBe(true);
  });

  it('is false for a vector, however short', () => {
    expect(isTitle(parsePidCmdline(fixture('login-shell', 'self')))).toBe(false);
    expect(isTitle(parsePidCmdline(fixture('desktop', 'self')))).toBe(false);
    expect(isTitle(parsePidCmdline(''))).toBe(false);
  });

  /** One argument with a space in it, properly terminated, is just that. */
  it('is false for a single argument that merely holds a space', () => {
    expect(isTitle(parsePidCmdline('sleep infinity now\0'))).toBe(false);
  });
});

describe('isLoginShell and program', () => {
  it('reads the leading dash on argv[0] as the login marker it is', () => {
    const command = parsePidCmdline(fixture('login-shell', 'self'));

    expect(isLoginShell(command)).toBe(true);
    // And not as part of the name.
    expect(program(command)).toBe('bash');
  });

  it('leaves an ordinary argv[0] alone', () => {
    expect(isLoginShell(parsePidCmdline(fixture('desktop', 'self')))).toBe(false);
    expect(program(parsePidCmdline(fixture('desktop', '12282')))).toBe('chromium');
  });

  it('has nothing to say about a vector that is not there', () => {
    expect(isLoginShell(parsePidCmdline(''))).toBe(false);
    expect(program(parsePidCmdline('\0'))).toBeNull();
  });

  /**
   * A status line holds no program name to take — and `postgres: 16/main:
   * checkpointer` has a slash in it, so anything reading it as a path comes
   * away with `main: checkpointer`.
   */
  it('takes no program name out of a rewritten title', () => {
    expect(program(parsePidCmdline(fixture('rewritten-title', 'self')))).toBeNull();
    expect(program(parsePidCmdline(fixture('rewritten-title', '901')))).toBeNull();
  });
});

describe('quoteArgument and formatCommand', () => {
  it('leaves an argument a shell would not touch alone', () => {
    expect(quoteArgument('grep')).toBe('grep');
    expect(quoteArgument('--color=auto')).toBe('--color=auto');
    expect(quoteArgument('/usr/lib/chromium/chromium')).toBe('/usr/lib/chromium/chromium');
  });

  it('quotes what a shell would otherwise take apart', () => {
    expect(quoteArgument('two words')).toBe("'two words'");
    expect(quoteArgument('')).toBe("''");
    expect(quoteArgument('$HOME')).toBe("'$HOME'");
    // The POSIX way out of single quotes and back in again.
    expect(quoteArgument("it's")).toBe("'it'\\''s'");
  });

  it('rebuilds a command line a shell would take back', () => {
    expect(formatCommand(parsePidCmdline(fixture('desktop', 'self')))).toBe(
      'grep --color=auto -rn TODO src',
    );
  });

  it('keeps an empty argument visible in the rebuilt line', () => {
    expect(formatCommand(parsePidCmdline(fixture('desktop', '3117')))).toContain(
      `'exec /usr/local/bin/backup.sh "$@"' '' --dry-run`,
    );
  });
});

/**
 * This file is world-readable where `/proc/<pid>/environ` is not, so anything
 * here has already been shown to every user on the machine.
 */
describe('secretsIn', () => {
  it('finds a password given as an option value', () => {
    const command = parsePidCmdline(fixture('secrets', 'self'));
    const secrets = secretsIn(command.args);

    expect(secrets).toHaveLength(1);
    expect(command.args[secrets[0]!.index]).toBe('--password=hunter2');
    expect(secrets[0]!.reason).toBe('the value of --password');
  });

  it('finds credentials written into a URL', () => {
    const command = parsePidCmdline(fixture('secrets', '2044'));
    const secrets = secretsIn(command.args);

    expect(secrets).toHaveLength(1);
    expect(command.args[secrets[0]!.index]).toContain('deploy:s3cr3t@');
    expect(secrets[0]!.reason).toBe('a URL with a password in it');
  });

  /** `--token hunter2` puts the secret in the *next* argument, not this one. */
  it('points at the value where the flag and the value are separate', () => {
    expect(secretsIn(['curl', '--token', 'abc123', 'https://api'])).toEqual([
      { index: 2, reason: 'the value of --token' },
    ]);
    expect(secretsIn(['app', '--api-key', 'k'])).toEqual([
      { index: 2, reason: 'the value of --api-key' },
    ]);
  });

  it('says nothing where the option carries no value', () => {
    expect(secretsIn(['app', '--password='])).toEqual([]);
    expect(secretsIn(['app', '--password', '--verbose'])).toEqual([]);
    expect(secretsIn(['app', '--password'])).toEqual([]);
  });

  /**
   * A miss beats a false accusation: `-p` is a port here, a password there and
   * "parents" in mkdir, and nothing in the argument says which.
   */
  it('does not guess at a short flag with a value glued to it', () => {
    expect(secretsIn(['mysql', '-phunter2'])).toEqual([]);
    expect(secretsIn(['mkdir', '-p', '/srv/data'])).toEqual([]);
    expect(secretsIn(['ssh', '-p', '2222', 'host'])).toEqual([]);
  });

  it('leaves an ordinary command line alone', () => {
    expect(secretsIn(parsePidCmdline(fixture('desktop', 'self')).args)).toEqual([]);
    expect(secretsIn(parsePidCmdline(fixture('desktop', '12282')).args)).toEqual([]);
    expect(secretsIn(['git', 'push', 'https://github.com/user/repo.git'])).toEqual([]);
  });
});

describe('summarize', () => {
  it('summarizes an ordinary command', () => {
    expect(summarize(parsePidCmdline(fixture('desktop', 'self')))).toMatchObject({
      count: 5,
      bytes: 31,
      program: 'grep',
      empty: false,
      title: false,
      loginShell: false,
      padding: 0,
      terminated: true,
      quoted: [],
      blanks: [],
      secrets: [],
    });
  });

  it('points at the arguments the rebuilt line has to quote', () => {
    const summary = summarize(parsePidCmdline(fixture('desktop', '3117')));

    expect(summary.quoted).toEqual([2]);
    expect(summary.blanks).toEqual([3]);
    expect(summary.longest).toBe('exec /usr/local/bin/backup.sh "$@"'.length);
  });

  it('summarizes a process with no vector at all', () => {
    expect(summarize(parsePidCmdline(''))).toMatchObject({
      count: 0,
      bytes: 0,
      program: null,
      empty: true,
      title: false,
      longest: 0,
    });
  });

  it('summarizes a rewritten title', () => {
    expect(summarize(parsePidCmdline(fixture('rewritten-title', 'self')))).toMatchObject({
      count: 1,
      title: true,
      padding: 86,
      quoted: [0],
      program: null,
    });
  });
});

describe('formatBytes', () => {
  it('groups and gets the singular right', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(447)).toBe('447 bytes');
    expect(formatBytes(131072)).toBe('131,072 bytes');
  });
});
