import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readMdstatFixture as mdstat } from './test/fixtures';
import { MdstatApp } from './MdstatApp';

/** Stands in for the backend serving /proc/mdstat. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/mdstat') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? mdstat(options.fixture ?? 'raid1-healthy'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** A summary tile's value, scoped to the summary. */
const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

/** The card for one array, found by its heading. */
const card = async (name: string): Promise<HTMLElement> =>
  (await screen.findByRole('heading', { name: new RegExp(`^${name}`) })).closest(
    '.md',
  ) as HTMLElement;

const cards = async (): Promise<HTMLElement[]> => {
  await screen.findAllByRole('heading');
  return [...document.querySelectorAll('.md')] as HTMLElement[];
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MdstatApp', () => {
  it('requests /proc/mdstat from its own path', async () => {
    render(<MdstatApp />);

    await cards();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/mdstat',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  // A record here is several lines, so each array gets a card of its own.
  it('renders a card per array', async () => {
    render(<MdstatApp />);

    expect(await cards()).toHaveLength(2);
    expect(await card('md1')).toHaveTextContent('raid1');
  });

  it('summarizes the arrays and what they hold', async () => {
    render(<MdstatApp />);

    expect(await screen.findByText('arrays')).toBeInTheDocument();
    expect(stat('arrays')).toHaveTextContent('2');
    expect(stat('active')).toHaveTextContent('2');
    expect(stat('capacity')).toHaveTextContent('932 GiB');
  });

  it('lists each member with its position in the array', async () => {
    render(<MdstatApp />);

    const members = within(await card('md0')).getAllByRole('listitem');
    expect(members.map((member) => member.textContent)).toEqual(['sdb1', 'sda1']);
    expect(members[0]).toHaveAttribute('title', 'position 1');
  });

  it('names the levels this kernel can drive', async () => {
    render(<MdstatApp />);

    await cards();
    const chips = screen.getByTestId('personalities').querySelectorAll('.chip');
    expect([...chips].map((chip) => chip.textContent)).toContain('raid10');
  });

  /**
   * `[UUU_]` is the quickest read of an array's health, so it is kept as the
   * kernel wrote it with each position explained.
   */
  it('marks the hole in the status field', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raid5-degraded' }));
    render(<MdstatApp />);

    const array = await card('md127');
    expect(
      within(array).getByTitle('position 3: no working member here'),
    ).toHaveTextContent('_');
    expect(within(array).getByTitle('position 0: up')).toHaveTextContent('U');
    expect(array).toHaveTextContent('3 of 4 working');
  });

  it('calls out an array running degraded', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raid5-degraded' }));
    render(<MdstatApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /md127 is running degraded — short of a member/,
    );
    expect(await card('md127')).toHaveClass('md--degraded');
  });

  // A failed member stays listed, marked, until something removes it.
  it('marks the failed member and keeps it listed', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'raid5-degraded' }));
    render(<MdstatApp />);

    const array = await card('md127');
    expect(within(array).getAllByRole('listitem')).toHaveLength(4);
    expect(within(array).getByTitle(/faulty/)).toHaveTextContent('F');
  });

  /**
   * Which word the progress line uses matters: recovery is rebuilding a
   * missing member, where a check only reads and compares.
   */
  it('shows a rebuild with the kernel’s estimate', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'recovering' }));
    render(<MdstatApp />);

    const array = await card('md0');
    expect(within(array).getByTitle(/Rebuilding a replacement member/)).toHaveTextContent(
      'recovery',
    );
    expect(array).toHaveTextContent('12.7%');
    expect(array).toHaveTextContent('2.4 hours left');
    expect(stat('rebuilding')).toHaveTextContent('1');
  });

  it('shows a scrub as the reading-only job it is', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'checking' }));
    render(<MdstatApp />);

    const array = await card('md0');
    expect(within(array).getByTitle(/without changing any data/)).toHaveTextContent('check');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The kernel runs one at a time, so another array's work waits.
  it('shows work queued behind another array’s', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'checking' }));
    render(<MdstatApp />);

    const array = await card('md1');
    expect(
      within(array).getByTitle("Queued behind another array's work rather than running"),
    ).toHaveTextContent('delayed');
    // Nothing is running on it, so it is not counted as rebuilding.
    expect(stat('rebuilding')).toHaveTextContent('1');
  });

  it('shows the states an array was started in', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'inactive-and-spare' }));
    render(<MdstatApp />);

    expect(await card('md0')).toHaveTextContent('(auto-read-only)');
    expect(await card('md127')).toHaveTextContent('inactive');
  });

  // An inactive array has no counts, so nothing is claimed about its health.
  it('claims nothing about an inactive array', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'inactive-and-spare' }));
    render(<MdstatApp />);

    const array = await card('md127');
    expect(array).not.toHaveClass('md--degraded');
    expect(within(array).queryByText('degraded')).not.toBeInTheDocument();
    expect(within(array).getByTitle(/spare/)).toHaveTextContent('S');
  });

  /**
   * The md driver being loaded with nothing assembled is ordinary, not an
   * error and not an empty page.
   */
  it('explains a machine with no arrays', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'no-arrays' }));
    render(<MdstatApp />);

    expect(await screen.findByText(/no arrays are assembled/i)).toBeInTheDocument();
    expect(screen.getByText(/no RAID levels are registered/)).toBeInTheDocument();
    expect(document.querySelectorAll('.md')).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<MdstatApp />);
    await cards();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(document.querySelectorAll('.md')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(mdstat('raid1-healthy'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<MdstatApp />);

    await cards();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<MdstatApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/mdstat (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the machine with nothing assembled.
describe.each([
  { fixture: 'raid1-healthy', arrays: '2' },
  { fixture: 'raid5-degraded', arrays: '1' },
  { fixture: 'recovering', arrays: '1' },
  { fixture: 'checking', arrays: '2' },
  { fixture: 'inactive-and-spare', arrays: '2' },
])('MdstatApp with whatever the server serves: $fixture', ({ fixture, arrays }) => {
  it(`renders ${arrays} arrays`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<MdstatApp />);

    await cards();
    expect(stat('arrays')).toHaveTextContent(arrays);
  });
});
