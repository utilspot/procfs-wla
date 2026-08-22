// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Plugin, ViteDevServer } from 'vite';
import { ADMIN_URL } from './document';
import { adminLine, adminUrl, announceAdmin } from './banner';

/** The escape a colour code starts with, spelled once here as it is there. */
const ESCAPE = '\u001b[';

/**
 * Stands in for the dev server: the two things this plugin touches — the URLs
 * Vite resolved, and the logger its banner goes through — and a `printUrls`
 * that prints the banner Vite would.
 */
function fakeServer(options: { local?: string[]; banner?: string[] } = {}) {
  const printed: string[] = [];
  const logger = { info: (message: string) => printed.push(message) };
  // Vite 7's banner, copied from what it prints: the label is bold and **the
  // colon is outside the bold**, which is why the line is read with its colours
  // taken off rather than matched as it arrives.
  const banner = options.banner ?? [
    '',
    `  ${ESCAPE}1mVITE v7.3.6${ESCAPE}22m  ${ESCAPE}2mready in 270 ms${ESCAPE}22m`,
    '',
    `  ${ESCAPE}32m➜${ESCAPE}39m  ${ESCAPE}1mLocal${ESCAPE}22m:   ${ESCAPE}36mhttp://localhost:${ESCAPE}1m5173${ESCAPE}22m/${ESCAPE}39m`,
    `${ESCAPE}2m  ${ESCAPE}32m➜${ESCAPE}39m  ${ESCAPE}1mNetwork${ESCAPE}22m${ESCAPE}2m: use ${ESCAPE}22m${ESCAPE}1m--host${ESCAPE}22m${ESCAPE}2m to expose${ESCAPE}22m`,
  ];

  const server = {
    resolvedUrls: { local: options.local ?? ['http://localhost:5173/'], network: [] },
    config: { logger },
    printUrls: () => {
      for (const line of banner) logger.info(line);
    },
  };

  return { server: server as unknown as ViteDevServer, printed, logger };
}

/**
 * A line as it reads without its colours, which is how these look for a label:
 * coloured, `Local` and its colon have an escape between them.
 */
const plain = (message: string) => message.replace(/\u001b\[[0-9;]*m/g, '');

/** Whether a printed line carries this label, however Vite painted it. */
const labelled = (label: string) => (line: string) => plain(line).includes(label);

/** Runs the plugin's `configureServer` hook, which is where it wraps printUrls. */
function configure(plugin: Plugin, server: ViteDevServer): void {
  (plugin.configureServer as (server: ViteDevServer) => void)(server);
}

describe('adminUrl', () => {
  it('joins the admin page onto the URL Vite prints for the app', () => {
    expect(adminUrl('http://localhost:5173/')).toBe('http://localhost:5173/0/admin');
  });

  /** Vite's URL carries the base, so a sub-path needs nothing said about it. */
  it('keeps the base the app is served under', () => {
    expect(adminUrl('http://localhost:5173/procfs/')).toBe('http://localhost:5173/procfs/0/admin');
  });

  it('adds the slash a URL without one is missing', () => {
    expect(adminUrl('http://localhost:5173')).toBe('http://localhost:5173/0/admin');
  });

  /** The app publishes every page without its extension, this one included. */
  it('publishes the page without its .html', () => {
    expect(ADMIN_URL).toBe('0/admin.html');
    expect(adminUrl('http://localhost:5173/')).not.toContain('.html');
  });
});

describe('adminLine', () => {
  it('lines the label up under Vite’s own', () => {
    expect(adminLine('http://localhost:5173/0/admin', false)).toBe(
      '  ➜  Admin:   http://localhost:5173/0/admin',
    );
    // `Local:` and `Admin:` are the same width, so the two URLs start together.
    expect('  ➜  Local:   '.length).toBe('  ➜  Admin:   '.length);
  });

  it('colours the arrow, the label and the URL where colour is wanted', () => {
    const line = adminLine('http://localhost:5173/0/admin', true);

    expect(line).toContain(`${ESCAPE}32m➜`);
    // The label bold and the colon outside it, as Vite writes its own.
    expect(line).toContain(`${ESCAPE}1mAdmin${ESCAPE}22m:`);
    expect(line).toContain(`${ESCAPE}36m`);
    // The port in bold inside the cyan, as Vite does its own.
    expect(line).toContain(`:${ESCAPE}1m5173${ESCAPE}22m/`);
  });

  it('leaves the codes out where it is not', () => {
    expect(adminLine('http://localhost:5173/0/admin', false)).not.toContain(ESCAPE);
  });
});

describe('announceAdmin', () => {
  it('prints the admin URL directly under Local', () => {
    const { server, printed } = fakeServer();
    configure(announceAdmin(true), server);

    server.printUrls();

    const local = printed.findIndex(labelled('Local:'));
    expect(plain(printed[local + 1]!)).toContain('Admin:');
    // The port is bolded inside the URL, so it is the tail that reads whole.
    expect(printed[local + 1]).toContain('/0/admin');
    // And above Network, which is where Vite's banner goes on.
    expect(plain(printed[local + 2]!)).toContain('Network:');
  });

  /** The admin page is debug mode's, and so is saying where it is. */
  it('says nothing with debug off', () => {
    const { server, printed } = fakeServer();
    const before = server.printUrls;
    configure(announceAdmin(false), server);

    expect(server.printUrls).toBe(before);
    server.printUrls();
    expect(printed.some(labelled('Admin:'))).toBe(false);
  });

  /**
   * Vite has already decided whether this output takes colour, so the line is
   * coloured exactly when the line above it is.
   */
  it('takes its colours from the line Vite just printed', () => {
    const { server, printed } = fakeServer();
    configure(announceAdmin(true), server);
    server.printUrls();
    expect(printed.find(labelled('Admin:'))).toContain(ESCAPE);

    const uncoloured = fakeServer({
      banner: ['  ➜  Local:   http://localhost:5173/', '  ➜  Network: use --host to expose'],
    });
    configure(announceAdmin(true), uncoloured.server);
    uncoloured.server.printUrls();
    expect(uncoloured.printed.find(labelled('Admin:'))).not.toContain(ESCAPE);
  });

  /** A banner this plugin no longer recognises still gets the URL. */
  it('prints the URL after the banner where there is no Local line', () => {
    const { server, printed } = fakeServer({ banner: ['  something else entirely'] });
    configure(announceAdmin(true), server);

    server.printUrls();

    expect(printed).toHaveLength(2);
    expect(printed[1]).toBe('  ➜  Admin:   http://localhost:5173/0/admin');
  });

  it('leaves the banner alone where Vite resolved no URL to build one from', () => {
    const { server, printed } = fakeServer({ local: [] });
    configure(announceAdmin(true), server);

    server.printUrls();

    expect(printed.some(labelled('Admin:'))).toBe(false);
    expect(printed.some(labelled('Local:'))).toBe(true);
  });

  /** The logger is Vite's, so it is handed back the way it was found. */
  it('puts the logger back once the banner is printed', () => {
    const { server, logger } = fakeServer();
    const before = logger.info;
    configure(announceAdmin(true), server);

    server.printUrls();

    expect(logger.info).toBe(before);
  });

  it('prints one line however many times the banner is', () => {
    const { server, printed } = fakeServer();
    configure(announceAdmin(true), server);

    server.printUrls();
    server.printUrls();

    expect(printed.filter(labelled('Admin:'))).toHaveLength(2);
  });
});
