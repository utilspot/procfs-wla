import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AdminPath, ProcPath } from './ProcPath';

/** The path at the top of a page, which is also the way back up it. */
const steps = () => within(screen.getByRole('heading', { level: 1 }));
const links = () =>
  screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]);

describe('ProcPath', () => {
  it('still reads as the path it names', () => {
    render(<ProcPath path="/proc/sys/debug/exception-trace" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '/proc/sys/debug/exception-trace',
    );
  });

  /**
   * A separator is part of neither step it sits between, so a link is a
   * directory's name and nothing else.
   */
  it('links every directory above the file, by name and without a separator', () => {
    render(<ProcPath path="/proc/sys/debug/exception-trace" />);

    expect(links()).toEqual([
      ['proc', '/'],
      ['sys', '/sys/'],
      ['debug', '/sys/debug/'],
    ]);
    for (const [name] of links()) expect(name).not.toContain('/');
  });

  it('draws the separators between the steps, the leading one included', () => {
    render(<ProcPath path="/proc/tty/drivers" />);

    const path = screen.getByRole('heading', { level: 1 }).querySelector('code')!;
    expect([...path.children].map((child) => child.textContent)).toEqual([
      '/',
      'proc',
      '/',
      'tty',
      '/',
      'drivers',
    ]);
    expect(path.textContent).toBe('/proc/tty/drivers');
  });

  /** Where the reader is standing, so there is nowhere for it to go. */
  it('leaves the last step unlinked', () => {
    render(<ProcPath path="/proc/tty/drivers" />);

    const here = steps().getByText('drivers');
    expect(here).toHaveAttribute('aria-current', 'page');
    expect(here.tagName).not.toBe('A');
    expect(steps().queryByRole('link', { name: 'drivers' })).not.toBeInTheDocument();
  });

  it('says where a step goes', () => {
    render(<ProcPath path="/proc/sys/debug/exception-trace" />);

    expect(steps().getByRole('link', { name: 'proc' })).toHaveAttribute('title', 'List /proc');
    expect(steps().getByRole('link', { name: 'sys' })).toHaveAttribute('title', 'List /proc/sys');
    expect(steps().getByRole('link', { name: 'debug' })).toHaveAttribute(
      'title',
      'List /proc/sys/debug',
    );
  });

  it('leads a top-level file back to the listing of /proc', () => {
    render(<ProcPath path="/proc/cpuinfo" />);

    expect(links()).toEqual([['proc', '/']]);
    expect(steps().getByText('cpuinfo')).toHaveAttribute('aria-current', 'page');
  });

  it('leads a process’s file back through the process', () => {
    render(<ProcPath path="/proc/12282/status" />);

    expect(links()).toEqual([
      ['proc', '/'],
      ['12282', '/12282/'],
    ]);
  });

  it('offers nowhere to go from /proc itself', () => {
    render(<ProcPath path="/proc" />);

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(steps().getByText('proc')).toHaveAttribute('aria-current', 'page');
  });

  it('offers no trail out of a path this app would not read', () => {
    render(<ProcPath path="/etc/passwd" />);

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/etc/passwd');
  });

  /**
   * The app is at the top of its server here, so its base is the server's home
   * and the `proc` crumb already goes there.
   */
  it('offers no way above itself when it is served at the root', () => {
    render(<ProcPath path="/proc/12282/status" />);

    expect(screen.queryByRole('link', { name: 'home' })).not.toBeInTheDocument();
  });
});

/**
 * The admin page is the one here whose URL names no host path: it lives in the
 * app's own directory, so only the first step of its trail is a place.
 */
describe('AdminPath', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads as the path the page is served at', () => {
    render(<AdminPath />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('/proc/0/admin');
  });

  /** Which is the whole point of it: the way back to what this app is about. */
  it('leads back to the listing of /proc, as every other page does', () => {
    render(<AdminPath />);

    expect(screen.getByRole('link', { name: 'proc' })).toHaveAttribute('href', '/');
  });

  it('follows the base the app is served under', () => {
    vi.stubEnv('BASE_URL', '/procfs/');
    render(<AdminPath />);

    expect(screen.getByRole('link', { name: 'proc' })).toHaveAttribute('href', '/procfs/');
  });

  /**
   * `0` is a directory of this build rather than of `/proc` — the one segment
   * `/proc` can never hold — so nothing lists it and it goes nowhere.
   */
  it('leaves the app own directory unlinked, since nothing lists it', () => {
    render(<AdminPath />);

    expect(screen.queryByRole('link', { name: '0' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'admin' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

/**
 * Served under a prefix, the app is one of several on the server and nothing in
 * a path under `/proc` leads back out to it — so the one step the trail cannot
 * have is offered ahead of the path.
 */
describe('ProcPath, served below the root', () => {
  afterEach(() => vi.unstubAllEnvs());

  const home = () => screen.getByRole('link', { name: 'home' });

  it('offers the top of the server ahead of the path', () => {
    vi.stubEnv('BASE_URL', '/proc/');
    render(<ProcPath path="/proc/1033/autogroup" />);

    expect(home()).toHaveAttribute('href', '/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('home/proc/1033/autogroup');
  });

  /** It goes above the app, where every step of the trail stays inside it. */
  it('leaves the trail itself under the base', () => {
    vi.stubEnv('BASE_URL', '/proc/');
    render(<ProcPath path="/proc/1033/autogroup" />);

    expect(links()).toEqual([
      ['home', '/'],
      ['proc', '/proc/'],
      ['1033', '/proc/1033/'],
    ]);
  });

  /**
   * It is not a segment of the path, so it sits outside the `code` that holds
   * one — which still reads as the path, separators and all.
   */
  it('keeps it out of the path it leads', () => {
    vi.stubEnv('BASE_URL', '/proc/');
    render(<ProcPath path="/proc/1033/autogroup" />);

    const path = screen.getByRole('heading', { level: 1 }).querySelector('code')!;
    expect(path.textContent).toBe('/proc/1033/autogroup');
    expect(within(path).queryByRole('link', { name: 'home' })).not.toBeInTheDocument();
  });

  it('is there on the listing of /proc itself, which is the app’s own base', () => {
    vi.stubEnv('BASE_URL', '/proc/');
    render(<ProcPath path="/proc" />);

    expect(home()).toHaveAttribute('href', '/');
    expect(screen.getByText('proc')).toHaveAttribute('aria-current', 'page');
  });

  /** An absolute base says where the assets come from, not where the pages are. */
  it('reads an absolute base as the path it puts the pages under', () => {
    vi.stubEnv('BASE_URL', 'https://cdn.example.com/procfs/');
    render(<ProcPath path="/proc/cpuinfo" />);

    expect(home()).toHaveAttribute('href', '/');
  });
});
