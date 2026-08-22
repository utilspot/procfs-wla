// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readHomepage, repoUrl } from './repo';

describe('readHomepage', () => {
  it('reads the homepage field', () => {
    expect(readHomepage('{"homepage": "https://example.com/proc"}')).toBe(
      'https://example.com/proc',
    );
  });

  it('trims it, since it becomes an href', () => {
    expect(readHomepage('{"homepage": "  https://example.com/proc  "}')).toBe(
      'https://example.com/proc',
    );
  });

  it('refuses a package.json that does not say', () => {
    // The footer is on every page, so a missing homepage is a build that would
    // ship the same broken link everywhere. Better to stop at the config.
    expect(() => readHomepage('{}')).toThrow(/homepage/);
    expect(() => readHomepage('{"homepage": ""}')).toThrow(/homepage/);
    expect(() => readHomepage('{"homepage": 42}')).toThrow(/homepage/);
    expect(() => readHomepage('null')).toThrow(/homepage/);
  });
});

describe('repoUrl', () => {
  it('is this project’s own homepage', () => {
    // Not the URL itself: package.json is where that is written down, and this
    // asserting a copy of it would defeat the point of reading it from there.
    expect(repoUrl()).toMatch(/^https:\/\/\S+$/);
  });
});
