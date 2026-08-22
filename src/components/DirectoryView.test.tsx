import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DirectoryView } from './DirectoryView';
import { DT_DIR, DT_REG, type Listing } from '../lib/directory';

/** A listing with more processes in it than a first screen holds. */
function withProcesses(count: number): Listing {
  return {
    cpuinfo: DT_REG,
    sys: DT_DIR,
    ...Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), DT_DIR])),
  };
}

const processes = () => screen.getByRole('region', { name: 'Processes' });

describe('DirectoryView', () => {
  /**
   * However many there are. Their own section is what keeps them out of the
   * way of the files, so there is nothing left for a control to do — and
   * scrolling past them costs less than a click to see them.
   */
  it('lays out every process there is', () => {
    render(<DirectoryView listing={withProcesses(200)} />);

    expect(within(processes()).getAllByRole('listitem')).toHaveLength(200);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /**
   * A pid is four or five characters, so a square tile around one is mostly
   * empty space — and there are hundreds. The processes alone are laid out as
   * rows, icon beside the name.
   */
  it('lays the processes out as rows and the rest as squares', () => {
    render(<DirectoryView listing={withProcesses(3)} />);

    const list = (name: string) =>
      within(screen.getByRole('region', { name })).getByRole('list');

    expect(list('Processes').className).toContain('explorer__grid--compact');
    expect(list('Files').className).not.toContain('explorer__grid--compact');
    expect(list('Directories').className).not.toContain('explorer__grid--compact');
  });

  /**
   * Every entry in that section is a process, so the heading has said what
   * they are and an icon on each would only repeat it — hundreds of times.
   */
  it('leaves the icon off the processes', () => {
    render(<DirectoryView listing={withProcesses(3)} />);

    expect(processes().querySelectorAll('.tile__icon')).toHaveLength(0);
    expect(
      screen.getByRole('region', { name: 'Files' }).querySelectorAll('.tile__icon'),
    ).toHaveLength(1);
  });

  /** The order the entries sort in, so the page reads the way the listing does. */
  it('puts the directories first, then the files, then the processes', () => {
    render(<DirectoryView listing={withProcesses(3)} />);

    expect(
      screen.getAllByRole('region').map((region) => within(region).getByRole('heading').textContent),
    ).toEqual(['Directories1', 'Files1', 'Processes3']);
  });

  /** A section with nothing in it is not a section. */
  it('leaves out a section it has no entries for', () => {
    render(<DirectoryView listing={{ cpuinfo: DT_REG }} />);

    expect(screen.getByRole('region', { name: 'Files' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Processes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Directories' })).not.toBeInTheDocument();
  });

  /**
   * Only `/proc` holds processes. Below it a number is an interrupt line, a
   * thread, a bus — so the listing of one has the two sections and no third.
   */
  it('has only directories and files below /proc', () => {
    render(<DirectoryView listing={withProcesses(3)} path="/proc/irq" />);

    expect(
      screen.getAllByRole('region').map((region) => within(region).getByRole('heading').textContent),
    ).toEqual(['Directories4', 'Files1']);
    expect(screen.queryByRole('region', { name: 'Processes' })).not.toBeInTheDocument();
  });

  /** They are directories there, so they are laid out as directories are. */
  it('lays a number below /proc out with the other directories', () => {
    render(<DirectoryView listing={withProcesses(3)} path="/proc/12282/task" />);

    const directories = screen.getByRole('region', { name: 'Directories' });

    expect(within(directories).getAllByRole('listitem')).toHaveLength(4);
    expect(within(directories).getByRole('list').className).not.toContain(
      'explorer__grid--compact',
    );
    expect(within(directories).getByRole('link', { name: '1' })).toHaveAttribute('href', '1/');
  });

  /** The page the base lands on is the one that lists `/proc` itself. */
  it('keeps the processes for the listing of /proc', () => {
    render(<DirectoryView listing={withProcesses(3)} path="/proc" />);

    expect(within(processes()).getAllByRole('listitem')).toHaveLength(3);
  });

  /** Which is not the same as the directory not being there. */
  it('says so when the listing is empty', () => {
    render(<DirectoryView listing={{}} path="/proc/net" />);

    expect(screen.getByTestId('empty')).toHaveTextContent('/proc/net');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('lists a directory other than /proc', () => {
    render(<DirectoryView listing={{ osrelease: DT_REG }} path="/proc/sys/kernel" />);

    expect(screen.getByText('osrelease')).toHaveAttribute('title', '/proc/sys/kernel/osrelease');
    // The link is the name and only the name, so it resolves inside whichever
    // directory is being listed rather than against the base.
    expect(screen.getByRole('link')).toHaveAttribute('href', 'osrelease');
  });

  /**
   * A page with something of its own to say about some of the entries shows
   * them itself and leaves them out here — `sys/user/index.html` does, for the
   * twelve `ucount` limits. Everything else is listed exactly as ever.
   */
  it('leaves out the entries the page is showing elsewhere', () => {
    render(
      <DirectoryView
        listing={{ max_ipc_namespaces: DT_REG, kmsg: DT_REG, sys: DT_DIR }}
        omit={(entry) => entry.name.startsWith('max_')}
      />,
    );

    expect(screen.queryByText('max_ipc_namespaces')).toBeNull();
    expect(screen.getByText('kmsg')).toBeVisible();
    expect(screen.getByText('sys')).toBeVisible();
  });

  /**
   * Omitting every entry is not the same as there being none: the notice is
   * about the directory being empty, and one whose entries the page has already
   * shown is not.
   */
  it('says nothing at all when the page showed every entry itself', () => {
    render(
      <DirectoryView listing={{ max_ipc_namespaces: DT_REG }} omit={() => true} />,
    );

    expect(screen.queryByTestId('empty')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  /** A name that is not a URL segment as it stands is encoded to be one. */
  it('encodes a name that needs it', () => {
    render(<DirectoryView listing={{ 'a b': DT_REG, 'c#d': DT_DIR }} />);

    expect(screen.getByText('a b').closest('a')).toHaveAttribute('href', 'a%20b');
    expect(screen.getByText('c#d').closest('a')).toHaveAttribute('href', 'c%23d/');
  });
});
