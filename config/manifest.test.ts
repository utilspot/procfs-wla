// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_DOCUMENT, DIRECTORY_DOCUMENT, DOCUMENT, FILE_DOCUMENT } from './document';
import {
  buildManifest,
  contentTypeFor,
  descriptionOf,
  entryFor,
  optionalPackageField,
  writeManifest,
  ICONS,
  MANIFEST_DESCRIPTION,
  MANIFEST_NAME,
  MANIFEST_TITLE,
  MANIFEST_VERSION,
  SCREENSHOTS,
  type Manifest,
} from './manifest';
import { LIMITS } from '../src/lib/sys-user-ucount';

describe('contentTypeFor', () => {
  it('maps the extensions a build emits', () => {
    expect(contentTypeFor('cpuinfo-CMwOulyt.js')).toBe('text/javascript');
    expect(contentTypeFor('cpuinfo-DBe5d3Po.css')).toBe('text/css');
    expect(contentTypeFor('cpuinfo.html')).toBe('text/html');
    expect(contentTypeFor('logo.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('font.woff2')).toBe('font/woff2');
  });

  it('is case-insensitive', () => {
    expect(contentTypeFor('IMAGE.PNG')).toBe('image/png');
  });

  it('falls back for unknown and extensionless files', () => {
    expect(contentTypeFor('data.bin')).toBe('application/octet-stream');
    expect(contentTypeFor('LICENSE')).toBe('application/octet-stream');
  });
});

describe('buildManifest', () => {
  const files = ['cpuinfo.html', 'cpuinfo-DBe5d3Po.css', 'cpuinfo-CMwOulyt.js'];

  /**
   * The identifier, where the entry's title is a display name: one build is one
   * project, so the name is the file's rather than an entry's field.
   */
  it('names the project at the root rather than inside an entry', () => {
    const manifest = buildManifest('/proc/', files);

    expect(manifest.name).toBe(MANIFEST_NAME);
    expect(manifest.entries[0]).not.toHaveProperty('name');
    expect(manifest.name).not.toBe(manifest.entries[0]!.title);
    // A name is the project's rather than the URL space's, so the base leaves
    // it alone the way it leaves the title alone.
    expect(buildManifest('/procfs/', files).name).toBe(manifest.name);
  });

  it('produces the documented shape', () => {
    expect(buildManifest('/proc/', files)).toEqual({
      name: MANIFEST_NAME,
      base: '/proc/',
      entries: [
        {
          title: MANIFEST_TITLE,
          version: MANIFEST_VERSION,
          description: MANIFEST_DESCRIPTION,
          main: '/proc/',
          // Neither image is in this build, so neither is advertised.
          icons: [],
          screenshots: [],
        },
      ],
      files: [
        {
          url: '/proc/0/cpuinfo-CMwOulyt.js',
          file: 'cpuinfo-CMwOulyt.js',
          type: 'text/javascript',
        },
        {
          url: '/proc/0/cpuinfo-DBe5d3Po.css',
          file: 'cpuinfo-DBe5d3Po.css',
          type: 'text/css',
        },
        {
          url: '/proc/cpuinfo',
          file: 'cpuinfo.html',
          type: 'text/html',
        },
      ],
    });
  });

  // A document is listed like anything else: what is servable as a page is the
  // reader's business, and the content type is what says so.
  it('lists a page alongside the files it loads', () => {
    const build = [...files, 'mounts.html'];

    expect(
      buildManifest('/proc/', build)
        .files.filter((entry) => entry.type === 'text/html')
        .map((entry) => entry.file),
    ).toEqual(['cpuinfo.html', 'mounts.html']);
  });

  it('lists the admin page too, which a debug build also emits', () => {
    const debugBuild = [...files, ADMIN_DOCUMENT];

    expect(
      buildManifest('/proc/', debugBuild)
        .files.filter((entry) => entry.type === 'text/html')
        .map((entry) => entry.file),
      // Sorted by filename, and the admin page is a file at the top of the
      // output like any other — only its URL sits apart.
    ).toEqual([ADMIN_DOCUMENT, 'cpuinfo.html']);
  });

  it('prefixes URLs with the base, including the root base', () => {
    expect(buildManifest('/', files).files.map((entry) => entry.url)).toEqual([
      '/0/cpuinfo-CMwOulyt.js',
      '/0/cpuinfo-DBe5d3Po.css',
      '/cpuinfo',
    ]);
  });

  /**
   * The viewer's paths read like the `/proc` entries they mirror, so a page is
   * served without its extension. The `file` field still names what is on disk.
   */
  it('drops .html from a page URL, keeping the file it names', () => {
    const build = [...files, 'pid/smaps.html'];
    const byFile = new Map(buildManifest('/proc/', build).files.map((e) => [e.file, e.url]));

    expect(byFile.get('cpuinfo.html')).toBe('/proc/cpuinfo');
    // Only the extension goes; a name that merely contains it is left alone.
    expect(byFile.get('cpuinfo-CMwOulyt.js')).toBe('/proc/0/cpuinfo-CMwOulyt.js');
  });

  /**
   * A page for a file belonging to a process reads the process its own URL
   * names, so one document answers for every process. That is what its URL
   * says: a pattern, with `{pid}` standing for one path segment.
   */
  it('publishes a process page at the pattern it answers', () => {
    const build = [...files, 'pid/smaps.html'];
    const byFile = new Map(buildManifest('/proc/', build).files.map((e) => [e.file, e.url]));

    expect(byFile.get('pid/smaps.html')).toBe('/proc/{pid}/smaps');
    // And a page that answers one URL is published at that one URL.
    expect(byFile.get('cpuinfo.html')).toBe('/proc/cpuinfo');
  });

  /**
   * The other page that answers more than one URL, and the one whose set is
   * known here: the twelve `ucount` limits are declared together by the kernel,
   * so the manifest says the twelve URLs rather than leaving a pattern for a
   * server to apply. A thirteenth name is nobody's here, and falls through to
   * what a server does with any other `/proc` path it has no entry for.
   */
  it('publishes the ucount page at each of the twelve URLs it answers', () => {
    const build = [...files, 'sys/user/limit.html'];
    const rows = buildManifest('/proc/', build).files.filter(
      (entry) => entry.file === 'sys/user/limit.html',
    );

    expect(rows).toHaveLength(LIMITS.length);
    expect(rows.map((entry) => entry.url)).toContain('/proc/sys/user/max_ipc_namespaces');
    expect(rows.map((entry) => entry.url)).toContain('/proc/sys/user/max_fanotify_marks');
    expect(rows.every((entry) => entry.type === 'text/html')).toBe(true);
    // No pattern is published for it, so nothing has a rule to implement.
    expect(rows.map((entry) => entry.url)).not.toContain('/proc/sys/user/{limit}');
  });

  /** The same arrangement for the memory manager's fifty. */
  it('publishes the vm page at each URL it answers', () => {
    const build = [...files, 'sys/vm/parameter.html'];
    const rows = buildManifest('/proc/', build).files.filter(
      (entry) => entry.file === 'sys/vm/parameter.html',
    );

    expect(rows.map((entry) => entry.url)).toContain('/proc/sys/vm/swappiness');
    expect(rows.map((entry) => entry.url)).toContain('/proc/sys/vm/dirty_ratio');
    expect(rows.map((entry) => entry.url)).not.toContain('/proc/sys/vm/{parameter}');
  });

  it('gives every URL of the twelve the same file', () => {
    const build = [...files, 'sys/user/limit.html'];
    const byUrl = new Map(buildManifest('/proc/', build).files.map((e) => [e.url, e.file]));

    for (const limit of LIMITS) {
      expect(byUrl.get(`/proc/sys/user/${limit.name}`), limit.name).toBe('sys/user/limit.html');
    }
  });

  /**
   * A page for a directory is published where the directory is, trailing slash
   * and all — the same URL a listing links a directory at, and what makes this
   * page's own relative links resolve inside it.
   */
  it('publishes a directory page at the directory, slash and all', () => {
    const build = [...files, 'sys/user/index.html', 'sys/vm/index.html'];
    const byFile = new Map(buildManifest('/proc/', build).files.map((e) => [e.file, e.url]));

    expect(byFile.get('sys/user/index.html')).toBe('/proc/sys/user/');
    expect(byFile.get('sys/vm/index.html')).toBe('/proc/sys/vm/');
  });

  /**
   * The listing is what a request naming no page lands on, and what it is a
   * listing *of* is the base. `/proc/index` would be a second URL for the same
   * file that nothing sends anybody to.
   */
  it('publishes the landing document at the base itself', () => {
    const build = [...files, DOCUMENT];
    const byFile = new Map(buildManifest('/proc/', build).files.map((e) => [e.file, e.url]));

    expect(byFile.get(DOCUMENT)).toBe('/proc/');
    expect(buildManifest('/', build).files.find((e) => e.file === DOCUMENT)?.url).toBe('/');
  });

  /**
   * The two fallback pages answer no URL of their own — one is the page for
   * any directory below the base, the other for any file with no parser here —
   * so there is no entry to make for either. What they load is listed like any
   * other file.
   */
  it('leaves the fallback pages out', () => {
    const build = [
      ...files,
      DIRECTORY_DOCUMENT,
      FILE_DOCUMENT,
      'dir-CMwOulyt.js',
      'file-BsW3lqPz.js',
    ];
    const listed = buildManifest('/proc/', build).files;

    expect(listed.map((entry) => entry.file)).not.toContain(DIRECTORY_DOCUMENT);
    expect(listed.map((entry) => entry.file)).not.toContain(FILE_DOCUMENT);
    // The assets they load keep their own entries, published under `0/` like
    // every other file a page pulls in.
    expect(listed.find((entry) => entry.file === 'dir-CMwOulyt.js')?.url).toBe(
      '/proc/0/dir-CMwOulyt.js',
    );
    expect(listed.find((entry) => entry.file === 'file-BsW3lqPz.js')?.url).toBe(
      '/proc/0/file-BsW3lqPz.js',
    );
  });

  /**
   * The admin page is entered directly rather than reached as one of the
   * mirrored `/proc` paths, so it is published under the app's own directory
   * and keeps the extension its links already use. The `file` is at the top of
   * the output; URL and file differ here as they do for every asset.
   */
  it('publishes the admin page under the app’s own directory, .html and all', () => {
    const [entry] = buildManifest('/proc/', [ADMIN_DOCUMENT]).files;

    expect(entry?.url).toBe('/proc/0/admin.html');
    expect(entry?.file).toBe(ADMIN_DOCUMENT);
    // Not beside the pages named for `/proc` entries, where it would claim one.
    expect(entry?.url).not.toBe('/proc/admin.html');
  });

  it('handles an absolute base', () => {
    const [first] = buildManifest('https://cdn.example.com/proc/', files).files;
    expect(first?.url).toBe('https://cdn.example.com/proc/0/cpuinfo-CMwOulyt.js');
  });

  it('sorts by filename', () => {
    expect(buildManifest('/proc/', files).files.map((entry) => entry.file)).toEqual([
      'cpuinfo-CMwOulyt.js',
      'cpuinfo-DBe5d3Po.css',
      'cpuinfo.html',
    ]);
  });
});

describe('optionalPackageField', () => {
  it('reads a field that is there', () => {
    expect(optionalPackageField({ description: 'What it does' }, 'description')).toBe(
      'What it does',
    );
    expect(optionalPackageField({ description: '  What it does  ' }, 'description')).toBe(
      'What it does',
    );
  });

  /** A field that says nothing is a field that is not there, for this purpose. */
  it('is undefined when the field says nothing', () => {
    expect(optionalPackageField({}, 'description')).toBeUndefined();
    expect(optionalPackageField({ description: '' }, 'description')).toBeUndefined();
    expect(optionalPackageField({ description: '   ' }, 'description')).toBeUndefined();
    expect(optionalPackageField({ description: null }, 'description')).toBeUndefined();
    expect(optionalPackageField({ description: 42 }, 'description')).toBeUndefined();
  });
});

describe('descriptionOf', () => {
  it('carries the description when there is one', () => {
    expect(descriptionOf('What it does')).toEqual({ description: 'What it does' });
  });

  /**
   * Not `{ description: undefined }`: the key itself is gone, so a host reading
   * the entry sees an app that gave no blurb rather than one whose blurb is
   * empty, and can fall back to whatever it shows for the former.
   */
  it('leaves the field out entirely when there is none', () => {
    expect(Object.keys(descriptionOf(undefined))).toEqual([]);
    expect('description' in descriptionOf(undefined)).toBe(false);
    expect(JSON.stringify({ title: 'x', ...descriptionOf(undefined) })).toBe('{"title":"x"}');
  });
});

describe('entryFor', () => {
  const build = ['index.html', ICONS.light, SCREENSHOTS.light, SCREENSHOTS.dark];

  it('names the app and opens it at the base', () => {
    const entry = entryFor('/proc/', build);

    // A name, not the path: the title sits in a list of other apps' names, and
    // it does not follow the base the way every URL here does.
    expect(entry.title).toBe('Inside /proc');
    expect(entryFor('/procfs/', build).title).toBe('Inside /proc');
    expect(entry.description).toBe(MANIFEST_DESCRIPTION);
    // The base is the listing of /proc, which is what the app opens on.
    expect(entry.main).toBe('/proc/');
    expect(entryFor('/', build).main).toBe('/');
  });

  /**
   * The title never moves — a host may key on it — so the version is what says
   * whether a build it has listed before is a new one.
   */
  it('carries the version this build is', () => {
    const entry = entryFor('/proc/', build);

    expect(entry.version).toBe(MANIFEST_VERSION);
    // A version is the project's rather than the URL space's, so the base
    // leaves it alone the way it leaves the title alone.
    expect(entryFor('/procfs/', build).version).toBe(entry.version);
  });

  /**
   * Both are read from the project rather than written down twice, so renaming
   * it there renames it here on the next build and nothing has to be told.
   */
  it('takes all three from the project’s own package.json', () => {
    const path = fileURLToPath(new URL('../package.json', import.meta.url));
    const { name, version, description } = JSON.parse(readFileSync(path, 'utf8')) as {
      name: string;
      version: string;
      description?: string;
    };

    expect(MANIFEST_NAME).toBe(name);
    expect(MANIFEST_VERSION).toBe(version);
    expect(MANIFEST_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    // Whatever package.json says, including saying nothing — which is the one
    // case where the field is left out rather than published empty.
    expect(MANIFEST_DESCRIPTION).toBe(description?.trim());
    expect(entryFor('/proc/', build).description).toBe(MANIFEST_DESCRIPTION);
  });

  /**
   * One image, offered for both: support for `prefers-color-scheme` inside an
   * SVG favicon depends on which browser is asking, so this one carries its own
   * background and reads the same either way.
   */
  it('offers the one icon under both colour schemes', () => {
    expect(entryFor('/proc/', build).icons).toEqual([
      { url: '/proc/0/favicon.svg', colorScheme: 'light' },
      { url: '/proc/0/favicon.svg', colorScheme: 'dark' },
    ]);
  });

  /** Here the two really are two files: a page follows the reader's setting. */
  it('offers a screenshot per colour scheme', () => {
    expect(entryFor('/proc/', build).screenshots).toEqual([
      { url: '/proc/0/screenshot-light.png', colorScheme: 'light' },
      { url: '/proc/0/screenshot-dark.png', colorScheme: 'dark' },
    ]);
  });

  /**
   * The URLs come out of the file list, so an entry cannot advertise a picture
   * this build did not produce — which would be a link to a 404.
   */
  it('advertises only the images the build emitted', () => {
    const entry = entryFor('/proc/', ['index.html', SCREENSHOTS.dark]);

    expect(entry.icons).toEqual([]);
    expect(entry.screenshots).toEqual([
      { url: '/proc/0/screenshot-dark.png', colorScheme: 'dark' },
    ]);
  });

  /** Every image URL is a URL the `files` list publishes, not a second guess. */
  it('points at the same URLs the file list does', () => {
    const manifest = buildManifest('/proc/', build);
    const published = new Set(manifest.files.map((file) => file.url));

    for (const image of [...manifest.entries[0]!.icons, ...manifest.entries[0]!.screenshots]) {
      expect(published).toContain(image.url);
    }
  });
});

describe('writeManifest', () => {
  it('describes what is actually in the directory', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'manifest-'));
    writeFileSync(join(outDir, 'cpuinfo.html'), '<!doctype html>');
    writeFileSync(join(outDir, 'cpuinfo-abc123.js'), 'console.log(1)');
    writeFileSync(join(outDir, 'cpuinfo-abc123.css'), 'body{}');

    const manifest = writeManifest(outDir, '/proc/');

    expect(manifest.files).toEqual([
      { url: '/proc/0/cpuinfo-abc123.css', file: 'cpuinfo-abc123.css', type: 'text/css' },
      { url: '/proc/0/cpuinfo-abc123.js', file: 'cpuinfo-abc123.js', type: 'text/javascript' },
      { url: '/proc/cpuinfo', file: 'cpuinfo.html', type: 'text/html' },
    ]);

    const onDisk = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
    expect(onDisk).toEqual(manifest);

    // The whole chain, in the file a build actually leaves behind: what the
    // project calls itself, at the root, and the version its entry is at — both
    // as `package.json` has them.
    const project = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { name: string; version: string };
    expect(onDisk.name).toBe(project.name);
    expect(onDisk.entries[0]).toMatchObject({ version: project.version });

    // The file is read by people as well as servers, so the order it is
    // written in is part of it: what this is the build of, what the URLs are
    // relative to, what this build is, then what it is made of.
    expect(Object.keys(onDisk)).toEqual(['name', 'base', 'entries', 'files']);

    rmSync(outDir, { recursive: true, force: true });
  });

  /**
   * A page for a file belonging to a process is nested — `pid/smaps.html` —
   * and a listing that stopped at the top level would leave it out of the
   * manifest entirely: built, served, and invisible to whatever reads this to
   * find it.
   */
  it('reaches a document in a sub-directory', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'manifest-'));
    writeFileSync(join(outDir, 'cpuinfo.html'), '<!doctype html>');
    mkdirSync(join(outDir, 'pid'));
    writeFileSync(join(outDir, 'pid', 'smaps.html'), '<!doctype html>');
    writeFileSync(join(outDir, 'pid', 'smaps-abc123.js'), 'console.log(1)');

    const manifest = writeManifest(outDir, '/proc/');

    expect(manifest.files.map((entry) => entry.file)).toEqual([
      'cpuinfo.html',
      'pid/smaps-abc123.js',
      'pid/smaps.html',
    ]);
    // The URL keeps the sub-directory, and posix separators with it.
    expect(manifest.files.map((entry) => entry.url)).toContain('/proc/{pid}/smaps');
    expect(manifest.files.map((entry) => entry.url)).toContain('/proc/0/pid/smaps-abc123.js');
    expect(manifest.files.find((entry) => entry.file === 'pid/smaps.html')?.type).toBe('text/html');

    rmSync(outDir, { recursive: true, force: true });
  });

  it('does not list itself, even on a rewrite', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'manifest-'));
    writeFileSync(join(outDir, 'mounts.html'), '<!doctype html>');

    writeManifest(outDir, '/');
    const second = writeManifest(outDir, '/');

    expect(second.files.map((entry) => entry.file)).toEqual(['mounts.html']);

    rmSync(outDir, { recursive: true, force: true });
  });
});
