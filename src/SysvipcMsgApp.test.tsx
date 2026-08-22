import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSysvipcMsgFixture as msg } from './test/fixtures';
import { SysvipcMsgApp } from './SysvipcMsgApp';

/** Stands in for the backend serving /proc/sysvipc/msg. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/sysvipc/msg') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? msg(options.fixture ?? 'legacy-app'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Message queues' });

/** The data rows, in the order the file listed them. */
const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row for a queue, matched on the id in its second cell. */
const rowFor = async (msqid: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelectorAll('td')[1]?.textContent === msqid)!;

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  // The page reads the file its own URL names, and jsdom opens it at `/`.
  window.history.pushState({}, '', '/sysvipc/msg');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('SysvipcMsgApp', () => {
  it('requests /proc/sysvipc/msg from its own path', async () => {
    render(<SysvipcMsgApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/sysvipc/msg',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per queue and none for the header', async () => {
    render(<SysvipcMsgApp />);

    expect(await rows()).toHaveLength(3);
  });

  it('summarizes what is waiting across the queues', async () => {
    render(<SysvipcMsgApp />);

    await table();
    expect(stat('queues')).toHaveTextContent('3');
    expect(stat('messages')).toHaveTextContent('2');
    expect(stat('waiting')).toHaveTextContent('96 B');
    expect(stat('not empty')).toHaveTextContent('1');
  });

  /** An empty queue with recent traffic is working, not idle. */
  it('reads an empty queue as emptied rather than unused', async () => {
    render(<SysvipcMsgApp />);

    const row = await rowFor('0');
    expect(
      within(row).getByTitle('Empty: everything sent has been received'),
    ).toHaveTextContent('0');
    expect(row).toHaveTextContent('2026-08-14 11:20:30 UTC');
  });

  it('says what is waiting, and what each message averages', async () => {
    render(<SysvipcMsgApp />);

    const row = await rowFor('2');
    expect(
      within(row).getByTitle('2 messages waiting, averaging 48 B of text each'),
    ).toHaveTextContent('2');
    expect(within(row).getByTitle(/96 bytes of message text — 1% of the 16 KiB/)).toHaveTextContent(
      '96 B',
    );
  });

  it('shows perms as the kernel printed it', async () => {
    render(<SysvipcMsgApp />);

    expect(within(await rowFor('0')).getByTitle('660 — rw-rw----')).toHaveTextContent('660');
  });

  it('shows a key of 0 as no key at all', async () => {
    render(<SysvipcMsgApp />);

    expect(within(await rowFor('2')).getByText('private')).toHaveAttribute(
      'title',
      expect.stringContaining('IPC_PRIVATE'),
    );
    expect(within(await rowFor('0')).getByTitle('Printed as 1094795585')).toHaveTextContent(
      '0x41414141',
    );
  });

  /** The id is a sequence number above a slot, not a position in a list. */
  it('reads the id as the slot and the sequence in it', async () => {
    render(<SysvipcMsgApp />);

    expect(within(await rowFor('32769')).getByTitle('Slot 1, sequence 1')).toBeInTheDocument();
    expect(within(await rowFor('0')).getByTitle('Slot 0, sequence 0')).toBeInTheDocument();
  });

  it('says nothing about backlogs when every queue is being read', async () => {
    render(<SysvipcMsgApp />);

    await table();
    expect(screen.queryByText(/never read from/)).not.toBeInTheDocument();
    expect(screen.queryByText(/as much as/)).not.toBeInTheDocument();
  });

  describe('a legacy middleware host', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'middleware' }));
    });

    it('renders a row per queue, with what each holds', async () => {
      render(<SysvipcMsgApp />);

      expect(await rows()).toHaveLength(5);
      expect(stat('messages')).toHaveTextContent('614');
      expect(stat('waiting')).toHaveTextContent('76.5 KiB');
    });

    /** 12 KiB of the 16 KiB default: filling up, but not yet blocking. */
    it('shows how full a queue is against the default limit', async () => {
      render(<SysvipcMsgApp />);

      const row = await rowFor('98307');
      expect(
        within(row).getByTitle(/12,288 bytes of message text — 75% of the 16 KiB/),
      ).toHaveTextContent('12 KiB');
      expect(within(row).queryByText('at msgmnb')).toBeNull();
    });

    /** Past the default is a queue whose own limit was raised, not an overflow. */
    it('marks a queue holding more than the default allows', async () => {
      render(<SysvipcMsgApp />);

      const row = await rowFor('131076');
      expect(within(row).getByText('limit raised')).toHaveAttribute(
        'title',
        expect.stringContaining('raised q_qbytes'),
      );
      expect(within(row).queryByText('at msgmnb')).toBeNull();
      expect(within(row).getByTitle(/Printed as -1910767613/)).toHaveTextContent('0x8e1c0003');
    });
  });

  describe('a queue that has filled up', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'backlog' }));
    });

    it('says a sender is blocked on it', async () => {
      render(<SysvipcMsgApp />);

      expect(await screen.findByText(/1 queue holds/)).toHaveTextContent('16 KiB');
      const row = await rowFor('0');
      expect(within(row).getByText('at msgmnb')).toBeInTheDocument();
    });

    it('leaves one nearly there unmarked', async () => {
      render(<SysvipcMsgApp />);

      const row = await rowFor('32769');
      expect(within(row).queryByText('at msgmnb')).toBeNull();
      expect(row).toHaveTextContent('15.5 KiB');
    });
  });

  describe('sent to and never read from', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'never-received' }));
    });

    it('calls out the queue no receiver has ever touched', async () => {
      render(<SysvipcMsgApp />);

      expect(
        await screen.findByText(/1 queue has been sent to and never read from/),
      ).toBeInTheDocument();
      const row = await rowFor('0');
      expect(row).toHaveClass('msg__row--stalled');
      expect(
        within(row).getByTitle(
          'No msgrcv has ever run on this queue, though something has sent to it',
        ),
      ).toHaveTextContent('never received');
    });

    /** Nothing at either end is a different state, and reads as never. */
    it('reads a queue nothing has ever used as never rather than hidden', async () => {
      render(<SysvipcMsgApp />);

      const row = await rowFor('32769');
      expect(row).not.toHaveClass('msg__row--stalled');
      expect(within(row).getByTitle('Nothing has ever sent to this queue')).toHaveTextContent(
        'never',
      );
      expect(within(row).getByTitle('Empty, and nothing has ever sent to it')).toHaveTextContent(
        '0',
      );
    });
  });

  describe('an IPC namespace of its own', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'ipc-namespace' }));
    });

    /**
     * A pid of 0 beside a time that is set is a process this namespace cannot
     * see — which the page has to say differently from "never".
     */
    it('tells a pid it cannot resolve from an end nothing has used', async () => {
      render(<SysvipcMsgApp />);

      const row = await rowFor('0');
      expect(
        within(row).getByTitle('The last process to send is not visible in this pid namespace'),
      ).toHaveTextContent('hidden');
      expect(await rowFor('32769')).toHaveTextContent('41');
    });

    it('marks an owner with no mapping in this user namespace', async () => {
      render(<SysvipcMsgApp />);

      const row = await rowFor('65538');
      expect(row).toHaveTextContent('65534:65534');
      expect(within(row).getByText('unmapped')).toBeInTheDocument();
    });
  });

  /**
   * No queues is what nearly every machine says — the desktop capture here
   * included — not an error and not an empty table.
   */
  it('explains a machine with no queues at all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-queues' }));
    render(<SysvipcMsgApp />);

    expect(
      await screen.findByText(/No System V message queues on this machine/),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<SysvipcMsgApp />);
    await table();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(msg('legacy-app'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<SysvipcMsgApp />);

    await table();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<SysvipcMsgApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/sysvipc/msg (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine with no queues at all.
describe.each([
  { fixture: 'legacy-app', queues: '3' },
  { fixture: 'middleware', queues: '5' },
  { fixture: 'backlog', queues: '3' },
  { fixture: 'never-received', queues: '2' },
  { fixture: 'ipc-namespace', queues: '3' },
])('SysvipcMsgApp with whatever the server serves: $fixture', ({ fixture, queues }) => {
  beforeEach(() => {
    window.history.pushState({}, '', '/sysvipc/msg');
    vi.stubGlobal('fetch', mockServer({ fixture }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it(`renders ${queues} queues`, async () => {
    render(<SysvipcMsgApp />);

    await table();
    expect(stat('queues')).toHaveTextContent(queues);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
