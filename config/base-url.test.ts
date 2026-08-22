// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeBase, resolveBase, stripBaseUrlFlag } from './base-url';

describe('normalizeBase', () => {
  it('adds the leading and trailing slash Vite expects', () => {
    expect(normalizeBase('/proc')).toBe('/proc/');
    expect(normalizeBase('proc')).toBe('/proc/');
    expect(normalizeBase('/proc/')).toBe('/proc/');
    expect(normalizeBase('proc/nested')).toBe('/proc/nested/');
  });

  it('keeps the root as-is', () => {
    expect(normalizeBase('/')).toBe('/');
    expect(normalizeBase('')).toBe('/');
    expect(normalizeBase('  ')).toBe('/');
  });

  it('leaves absolute URLs alone apart from the trailing slash', () => {
    expect(normalizeBase('https://cdn.example.com/proc')).toBe('https://cdn.example.com/proc/');
    expect(normalizeBase('http://cdn.example.com/')).toBe('http://cdn.example.com/');
  });
});

describe('resolveBase', () => {
  it('is undefined when nothing is configured', () => {
    expect(resolveBase([], {})).toBeUndefined();
    expect(resolveBase([], { npm_config_base_url: '' })).toBeUndefined();
  });

  it('reads npm run build --base-url=/proc', () => {
    expect(resolveBase([], { npm_config_base_url: '/proc' })).toBe('/proc/');
  });

  it('reads APP_BASE_URL', () => {
    expect(resolveBase([], { APP_BASE_URL: 'proc' })).toBe('/proc/');
  });

  it('reads the CLI flag in both spellings', () => {
    expect(resolveBase(['build', '--base-url=/proc'], {})).toBe('/proc/');
    expect(resolveBase(['build', '--base-url', '/proc'], {})).toBe('/proc/');
  });

  it('prefers the CLI flag over the environment', () => {
    const env = { npm_config_base_url: '/from-npm', APP_BASE_URL: '/from-env' };
    expect(resolveBase(['--base-url=/from-cli'], env)).toBe('/from-cli/');
    expect(resolveBase([], env)).toBe('/from-npm/');
  });
});

describe('stripBaseUrlFlag', () => {
  it('removes the flag and its value, keeping everything else', () => {
    expect(stripBaseUrlFlag(['build', '--base-url=/proc', '--mode=staging'])).toEqual([
      'build',
      '--mode=staging',
    ]);
    expect(stripBaseUrlFlag(['build', '--base-url', '/proc', '--minify'])).toEqual([
      'build',
      '--minify',
    ]);
  });

  it('is a no-op without the flag', () => {
    expect(stripBaseUrlFlag(['preview', '--port', '4173'])).toEqual(['preview', '--port', '4173']);
  });
});
