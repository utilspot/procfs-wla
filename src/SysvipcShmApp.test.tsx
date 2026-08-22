import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSysvipcShmFixture as shm } from './test/fixtures';
import { SysvipcShmApp } from './SysvipcShmApp';

/** Stands in for the backend serving /proc/sysvipc/shm. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/sysvipc/shm') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? shm(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Shared memory segments' });

/** The data rows, in the order the file listed them. */
const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row for a segment, matched on the id in its second cell. */
const rowFor = async (shmid: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelectorAll('td')[1]?.textContent === shmid)!;

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/sysvipc/shm');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('SysvipcShmApp', () => {
  it('requests /proc/sysvipc/shm from its own path', async () => {
    render(<SysvipcShmApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/sysvipc/shm',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per segment and none for the header', async () => {
    render(<SysvipcShmApp />);

    expect(await rows()).toHaveLength(5);
  });

  it('summarizes what was asked for against what exists', async () => {
    render(<SysvipcShmApp />);

    await table();
    expect(stat('segments')).toHaveTextContent('5');
    expect(stat('asked for')).toHaveTextContent('79 MiB');
    expect(stat('resident')).toHaveTextContent('75 MiB');
    expect(stat('attachments')).toHaveTextContent('7');
  });

  /** `perms` is octal, and the bits above the mode are SHM_* flags. */
  it('shows perms as the kernel printed it, with the flag above it named', async () => {
    render(<SysvipcShmApp />);

    const row = await rowFor('0');
    expect(within(row).getByTitle('600 — rw-------')).toHaveTextContent('1600');
    expect(within(row).getByText('dest')).toHaveAttribute(
      'title',
      expect.stringContaining('shmctl(IPC_RMID)'),
    );
  });

  /**
   * The reason to read this file: a segment nothing is attached to is memory
   * held for nobody, and nothing will reclaim it.
   */
  it('calls out the segments nothing is attached to, and what they hold', async () => {
    render(<SysvipcShmApp />);

    expect(
      await screen.findByText(/2 segments have nothing attached to them/),
    ).toHaveTextContent('holding 64 MiB');
    expect(await rowFor('98307')).toHaveClass('shm__row--orphaned');
    expect(await rowFor('0')).not.toHaveClass('shm__row--orphaned');
  });

  /** One that is on its way out is not one of those, and is said separately. */
  it('tells a segment waiting on its last detach from one nothing will remove', async () => {
    render(<SysvipcShmApp />);

    expect(
      await screen.findByText(/2 segments are marked for destruction/),
    ).toBeInTheDocument();
  });

  it('shows a key of 0 as no key at all', async () => {
    render(<SysvipcShmApp />);

    const row = await rowFor('0');
    expect(within(row).getByText('private')).toHaveAttribute(
      'title',
      expect.stringContaining('IPC_PRIVATE'),
    );
  });

  it('shows a key as the bits it is', async () => {
    render(<SysvipcShmApp />);

    const row = await rowFor('2');
    expect(within(row).getByTitle('Printed as 5432')).toHaveTextContent('0x00001538');
  });

  /** The id is a sequence number above a slot, not a position in a list. */
  it('reads the id as the slot and the sequence in it', async () => {
    render(<SysvipcShmApp />);

    expect(within(await rowFor('98307')).getByTitle('Slot 3, sequence 3')).toBeInTheDocument();
    expect(within(await rowFor('0')).getByTitle('Slot 0, sequence 0')).toBeInTheDocument();
  });

  /** Nothing has attached it, which is not the same as a pid it cannot show. */
  it('says never where nothing has ever attached the segment', async () => {
    render(<SysvipcShmApp />);

    const row = await rowFor('2');
    expect(
      within(row).getByTitle('Nothing has ever attached or detached it'),
    ).toHaveTextContent('never');
    expect(within(row).getByText('never attached')).toBeInTheDocument();
  });

  it('names the owner, and says when it is no longer the creator', async () => {
    render(<SysvipcShmApp />);

    const row = await rowFor('131076');
    expect(row).toHaveTextContent('1000:44');
    expect(within(row).getByText('given away')).toBeInTheDocument();
    expect(within(await rowFor('0')).queryByText('given away')).toBeNull();
  });

  it('shows a size that has not been touched as the nothing it is', async () => {
    render(<SysvipcShmApp />);

    const row = await rowFor('2');
    expect(
      within(row).getByTitle('Not a page of it exists: shared memory is allocated on first touch'),
    ).toHaveTextContent('0');
  });

  describe('a database host', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'database-server' }));
    });

    it('reads a key whose top bit is set back as its bits', async () => {
      render(<SysvipcShmApp />);

      const row = await rowFor('32769');
      expect(within(row).getByTitle(/Printed as -1910767615/)).toHaveTextContent('0x8e1c0001');
    });

    it('names the huge-page and locked flags', async () => {
      render(<SysvipcShmApp />);

      expect(within(await rowFor('32769')).getByText('hugetlb')).toBeInTheDocument();
      expect(within(await rowFor('65538')).getByText('locked')).toBeInTheDocument();
    });

    /** 56 bytes cost a page, so resident is above size rather than wrong. */
    it('shows a resident size larger than the size asked for', async () => {
      render(<SysvipcShmApp />);

      const row = await rowFor('0');
      expect(within(row).getByTitle('56 bytes asked for')).toHaveTextContent('56 B');
      expect(within(row).getByTitle('4,096 bytes')).toHaveTextContent('4.0 KiB');
    });

    it('shows the 32 GiB one whole', async () => {
      render(<SysvipcShmApp />);

      expect(await rowFor('32769')).toHaveTextContent('32 GiB');
    });
  });

  describe('a machine short of memory', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'swapped-out' }));
    });

    it('shows what went to swap', async () => {
      render(<SysvipcShmApp />);

      await table();
      expect(stat('swapped')).toHaveTextContent('464 MiB');
      expect(await rowFor('65538')).toHaveTextContent('384 MiB');
    });

    it('marks a detached segment that costs swap and nothing else', async () => {
      render(<SysvipcShmApp />);

      const row = await rowFor('32769');
      expect(row).toHaveClass('shm__row--orphaned');
      expect(row).toHaveTextContent('64 MiB');
    });
  });

  describe('an IPC namespace of its own', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'ipc-namespace' }));
    });

    /** A pid of 0 is a process this namespace cannot see, not pid 0. */
    it('shows a pid it cannot resolve as hidden', async () => {
      render(<SysvipcShmApp />);

      const row = await rowFor('0');
      expect(
        within(row).getByTitle('The creator is not visible in this pid namespace'),
      ).toHaveTextContent('hidden');
      // And the one this namespace made itself keeps its pid.
      expect(await rowFor('32769')).toHaveTextContent('41');
    });

    it('marks an owner with no mapping in this user namespace', async () => {
      render(<SysvipcShmApp />);

      const row = await rowFor('98307');
      expect(row).toHaveTextContent('65534:65534');
      expect(within(row).getByText('unmapped')).toBeInTheDocument();
    });
  });

  describe('a kernel from before 3.2', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'legacy-32bit' }));
    });

    /**
     * Fourteen columns: `rss` and `swap` were not printed at all, which is not
     * the same as their being zero.
     */
    it('says the two columns are missing rather than showing them empty', async () => {
      render(<SysvipcShmApp />);

      expect(await screen.findByText(/fourteen columns rather than sixteen/)).toBeInTheDocument();
      const row = await rowFor('0');
      expect(
        within(row).getAllByTitle('This kernel does not print rss or swap — see below'),
      ).toHaveLength(2);
    });

    it('leaves out the totals it cannot give', async () => {
      render(<SysvipcShmApp />);

      await table();
      expect(stat('asked for')).toHaveTextContent('3.4 MiB');
      expect(within(screen.getByTestId('summary')).queryByText('resident')).toBeNull();
      expect(within(screen.getByTestId('summary')).queryByText('swapped')).toBeNull();
    });

    /** Nothing else about the file changes, narrower columns included. */
    it('still reads every other field', async () => {
      render(<SysvipcShmApp />);

      const row = await rowFor('2');
      expect(row).toHaveTextContent('0x0000004e');
      expect(row).toHaveTextContent('0:0');
      expect(within(row).getByTitle('666 — rw-rw-rw-')).toHaveTextContent('666');
    });
  });

  /**
   * No shared memory is the ordinary answer on most machines, not an error and
   * not an empty table.
   */
  it('explains a machine with no segments at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-segments' }));
    render(<SysvipcShmApp />);

    expect(await screen.findByText(/No System V shared memory on this machine/)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<SysvipcShmApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(shm('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<SysvipcShmApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<SysvipcShmApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/sysvipc/shm (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine with no segments at all.
describe.each([
  { fixture: 'desktop', segments: '5' },
  { fixture: 'database-server', segments: '5' },
  { fixture: 'swapped-out', segments: '5' },
  { fixture: 'ipc-namespace', segments: '4' },
  { fixture: 'legacy-32bit', segments: '4' },
])('SysvipcShmApp with whatever the server serves: $fixture', ({ fixture, segments }) => {
  beforeEach(() => {
    window.history.pushState({}, '', '/sysvipc/shm');
    vi.stubGlobal('fetch', mockServer({ fixture }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it(`renders ${segments} segments`, async () => {
    render(<SysvipcShmApp />);

    await table();
    expect(stat('segments')).toHaveTextContent(segments);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
