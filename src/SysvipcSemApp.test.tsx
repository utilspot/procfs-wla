import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSysvipcSemFixture as sem } from './test/fixtures';
import { SysvipcSemApp } from './SysvipcSemApp';

/** Stands in for the backend serving /proc/sysvipc/sem. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/sysvipc/sem') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? sem(options.fixture ?? 'desktop'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Semaphore sets' });

/** The data rows, in the order the file listed them. */
const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row for a set, matched on the id in its second cell. */
const rowFor = async (semid: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelectorAll('td')[1]?.textContent === semid)!;

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/sysvipc/sem');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('SysvipcSemApp', () => {
  it('requests /proc/sysvipc/sem from its own path', async () => {
    render(<SysvipcSemApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/sysvipc/sem',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per set and none for the header', async () => {
    render(<SysvipcSemApp />);

    expect(await rows()).toHaveLength(4);
  });

  it('summarizes the sets and the semaphores in them', async () => {
    render(<SysvipcSemApp />);

    await table();
    expect(stat('sets')).toHaveTextContent('4');
    expect(stat('semaphores')).toHaveTextContent('15');
    expect(stat('largest set')).toHaveTextContent('8');
    expect(stat('of one')).toHaveTextContent('1');
  });

  /** `perms` is octal here too, but a set has no flags above its mode. */
  it('shows perms as the kernel printed it', async () => {
    render(<SysvipcSemApp />);

    const row = await rowFor('0');
    expect(within(row).getByTitle('600 — rw-------')).toHaveTextContent('600');
  });

  /**
   * The column that matters, since there is no attach count: a set nothing has
   * ever operated on is what a process that died early leaves behind.
   */
  it('calls out the sets nothing has ever operated on', async () => {
    render(<SysvipcSemApp />);

    expect(await screen.findByText(/1 set has never been operated on/)).toHaveTextContent(
      '4 semaphores',
    );
    const row = await rowFor('32769');
    expect(row).toHaveClass('sem__row--unused');
    expect(
      within(row).getByTitle(
        'No semop has ever run on this set — it was created and never operated on',
      ),
    ).toHaveTextContent('never used');
    expect(await rowFor('0')).not.toHaveClass('sem__row--unused');
  });

  /** SETVAL and SETALL move ctime, so a change can be newer than the last op. */
  it('marks a set whose values were written after its last operation', async () => {
    render(<SysvipcSemApp />);

    expect(within(await rowFor('98307')).getByText('set since')).toBeInTheDocument();
    expect(within(await rowFor('0')).queryByText('set since')).toBeNull();
  });

  it('shows nsems as the size of the set', async () => {
    render(<SysvipcSemApp />);

    const mutex = await rowFor('0');
    expect(
      within(mutex).getByTitle('One semaphore: a mutex, which is the commonest set there is'),
    ).toHaveTextContent('1');
    expect(
      within(await rowFor('98307')).getByTitle(
        '8 semaphores in the set — their values are not in this file',
      ),
    ).toHaveTextContent('8');
  });

  it('shows a key of 0 as no key at all', async () => {
    render(<SysvipcSemApp />);

    const row = await rowFor('98307');
    expect(within(row).getByText('private')).toHaveAttribute(
      'title',
      expect.stringContaining('IPC_PRIVATE'),
    );
    expect(within(await rowFor('0')).getByTitle('Printed as 1330400761')).toHaveTextContent(
      '0x4f4c4df9',
    );
  });

  /** The id is a sequence number above a slot, not a position in a list. */
  it('reads the id as the slot and the sequence in it', async () => {
    render(<SysvipcSemApp />);

    expect(within(await rowFor('98307')).getByTitle('Slot 3, sequence 3')).toBeInTheDocument();
    expect(within(await rowFor('0')).getByTitle('Slot 0, sequence 0')).toBeInTheDocument();
  });

  it('names the owner, and says when it is no longer the creator', async () => {
    render(<SysvipcSemApp />);

    const row = await rowFor('2');
    expect(row).toHaveTextContent('1000:44');
    expect(within(row).getByText('given away')).toBeInTheDocument();
    expect(within(await rowFor('0')).queryByText('given away')).toBeNull();
  });

  it('writes a time as the moment it is', async () => {
    render(<SysvipcSemApp />);

    expect(await rowFor('0')).toHaveTextContent('2026-08-14 09:41:08 UTC');
  });

  describe('a database host', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'database-server' }));
    });

    it('renders a set per line, sizes and keys included', async () => {
      render(<SysvipcSemApp />);

      expect(await rows()).toHaveLength(6);
      expect(stat('semaphores')).toHaveTextContent('335');
      expect(stat('largest set')).toHaveTextContent('250');
    });

    it('reads a key whose top bit is set back as its bits', async () => {
      render(<SysvipcSemApp />);

      const row = await rowFor('163845');
      expect(within(row).getByTitle(/Printed as -1910767614/)).toHaveTextContent('0x8e1c0002');
    });

    it('says nothing about unused sets when every one has been used', async () => {
      render(<SysvipcSemApp />);

      await table();
      expect(screen.queryByText(/never been operated on/)).not.toBeInTheDocument();
    });
  });

  describe('sets nothing has used', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'never-used' }));
    });

    it('counts every one of them, and the semaphores they hold', async () => {
      render(<SysvipcSemApp />);

      expect(await screen.findByText(/3 sets have never been operated on/)).toHaveTextContent(
        '18 semaphores',
      );
      expect((await rows()).every((row) => row.className.includes('sem__row--unused'))).toBe(true);
    });
  });

  describe('an IPC namespace of its own', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'ipc-namespace' }));
    });

    it('marks an owner with no mapping in this user namespace', async () => {
      render(<SysvipcSemApp />);

      const row = await rowFor('98307');
      expect(row).toHaveTextContent('65534:65534');
      expect(within(row).getByText('unmapped')).toBeInTheDocument();
      expect(within(await rowFor('0')).queryByText('unmapped')).toBeNull();
    });
  });

  describe('the ends of nsems', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'semmsl-limit' }));
    });

    /** 32,000 is the per-set ceiling, which is worth saying rather than just showing. */
    it('says which set is at the per-set ceiling', async () => {
      render(<SysvipcSemApp />);

      const largest = await rowFor('0');
      expect(largest).toHaveTextContent('32,000');
      expect(within(largest).getByText('at SEMMSL')).toBeInTheDocument();
      expect(within(await rowFor('32769')).queryByText('at SEMMSL')).toBeNull();
    });
  });

  /**
   * No semaphore sets is the ordinary answer on most machines, not an error and
   * not an empty table.
   */
  it('explains a machine with no sets at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-sets' }));
    render(<SysvipcSemApp />);

    expect(
      await screen.findByText(/No System V semaphore sets on this machine/),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<SysvipcSemApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(sem('desktop'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<SysvipcSemApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<SysvipcSemApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/sysvipc/sem (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine with no sets at all.
describe.each([
  { fixture: 'desktop', sets: '4' },
  { fixture: 'database-server', sets: '6' },
  { fixture: 'never-used', sets: '3' },
  { fixture: 'ipc-namespace', sets: '3' },
  { fixture: 'semmsl-limit', sets: '2' },
])('SysvipcSemApp with whatever the server serves: $fixture', ({ fixture, sets }) => {
  beforeEach(() => {
    window.history.pushState({}, '', '/sysvipc/sem');
    vi.stubGlobal('fetch', mockServer({ fixture }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it(`renders ${sets} sets`, async () => {
    render(<SysvipcSemApp />);

    await table();
    expect(stat('sets')).toHaveTextContent(sets);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
