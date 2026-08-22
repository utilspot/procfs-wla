// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseDebug, resolveDebug, stripDebugFlag } from './debug';

describe('parseDebug', () => {
  it('reads the affirmative spellings', () => {
    for (const value of ['true', '1', 'yes', 'on', 'TRUE']) {
      expect(parseDebug(value)).toBe(true);
    }
  });

  it('reads the negative spellings', () => {
    for (const value of ['false', '0', 'no', 'off']) {
      expect(parseDebug(value)).toBe(false);
    }
  });

  it('says nothing for absent, empty or unrecognized values', () => {
    expect(parseDebug(undefined)).toBeUndefined();
    expect(parseDebug('')).toBeUndefined();
    expect(parseDebug('maybe')).toBeUndefined();
  });
});

describe('resolveDebug', () => {
  it('defaults to on while developing and off for a build', () => {
    expect(resolveDebug('serve', [], {})).toBe(true);
    expect(resolveDebug('build', [], {})).toBe(false);
  });

  it('turns a build into a debug build with --debug', () => {
    expect(resolveDebug('build', ['build', '--debug'], {})).toBe(true);
    expect(resolveDebug('build', ['build', '--debug=true'], {})).toBe(true);
    expect(resolveDebug('build', ['build', '--debug', 'true'], {})).toBe(true);
  });

  it('turns dev debugging off with --debug=false', () => {
    expect(resolveDebug('serve', ['--debug=false'], {})).toBe(false);
    expect(resolveDebug('serve', ['--debug', 'off'], {})).toBe(false);
  });

  it('reads npm run build --debug and APP_DEBUG', () => {
    expect(resolveDebug('build', [], { npm_config_debug: 'true' })).toBe(true);
    expect(resolveDebug('build', [], { APP_DEBUG: '1' })).toBe(true);
    expect(resolveDebug('serve', [], { APP_DEBUG: '0' })).toBe(false);
  });

  // npm turns `--debug=false` and `--no-debug` into an empty value rather than
  // "false", so an empty npm_config_debug has to mean off.
  it('reads npm run dev --debug=false, which npm passes as an empty value', () => {
    expect(resolveDebug('serve', [], { npm_config_debug: '' })).toBe(false);
  });

  it('treats an empty APP_DEBUG as unset', () => {
    expect(resolveDebug('serve', [], { APP_DEBUG: '' })).toBe(true);
    expect(resolveDebug('build', [], { APP_DEBUG: '' })).toBe(false);
  });

  it('prefers the CLI flag over the environment', () => {
    expect(resolveDebug('build', ['--debug'], { APP_DEBUG: '0' })).toBe(true);
    expect(resolveDebug('build', ['--debug=false'], { npm_config_debug: 'true' })).toBe(false);
  });
});

describe('stripDebugFlag', () => {
  it('removes the flag in each spelling, keeping everything else', () => {
    expect(stripDebugFlag(['build', '--debug', '--minify'])).toEqual(['build', '--minify']);
    expect(stripDebugFlag(['build', '--debug=false'])).toEqual(['build']);
    expect(stripDebugFlag(['build', '--debug', 'false', '--minify'])).toEqual([
      'build',
      '--minify',
    ]);
  });

  it('does not swallow the next flag after a bare --debug', () => {
    expect(stripDebugFlag(['--debug', '--port', '4300'])).toEqual(['--port', '4300']);
  });

  it('is a no-op without the flag', () => {
    expect(stripDebugFlag(['preview', '--port', '4173'])).toEqual(['preview', '--port', '4173']);
  });
});
