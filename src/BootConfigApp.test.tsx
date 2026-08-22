import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readBootConfigFixture as bootconfig } from './test/fixtures';
import { BootConfigApp } from './BootConfigApp';

/** Stands in for the backend serving /proc/bootconfig. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/bootconfig') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? bootconfig(options.fixture ?? 'kernel-and-init'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

/** One table per section, named after it. */
const sectionTable = (name: string) => screen.findByRole('table', { name: `${name} keys` });

/**
 * The heading of a section. Matched on its `<code>` rather than by text, since
 * `init` is both a section name and the destination label on another section.
 */
const headingFor = (name: string): HTMLElement =>
  screen
    .getAllByRole('heading', { level: 3 })
    .find((heading) => heading.querySelector('code')?.textContent === name)!;

/**
 * The row for a key inside a section, matched on the whole path in its first
 * cell — `current_tracer` alone appears under two different ftrace instances.
 */
const rowFor = async (section: string, path: string): Promise<HTMLElement> => {
  const rows = within(await sectionTable(section)).getAllByRole('row');
  return rows.find((row) => row.querySelector('td')?.textContent === path)!;
};

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BootConfigApp', () => {
  it('requests /proc/bootconfig from its own path', async () => {
    render(<BootConfigApp />);

    await sectionTable('kernel');
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/bootconfig',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('summarizes the configuration', async () => {
    render(<BootConfigApp />);

    expect(await screen.findByText('keys')).toBeInTheDocument();
    expect(screen.getByText('keys').previousSibling).toHaveTextContent('8');
    expect(screen.getByText('values').previousSibling).toHaveTextContent('8');
    expect(screen.getByText('sections').previousSibling).toHaveTextContent('2');
  });

  it('renders a table per top-level section', async () => {
    render(<BootConfigApp />);

    expect(within(await sectionTable('kernel')).getAllByRole('row')).toHaveLength(6 + 1);
    expect(within(await sectionTable('init')).getAllByRole('row')).toHaveLength(2 + 1);
  });

  // This is the point of the file, so the page states it per section.
  it('says where each section is sent', async () => {
    render(<BootConfigApp />);

    await sectionTable('kernel');
    expect(headingFor('kernel')).toHaveTextContent('kernel command line');
    expect(headingFor('init')).toHaveTextContent('init');
    expect(screen.getByText('to the kernel command line').parentElement).toHaveTextContent('6');
    expect(screen.getByText('to init').parentElement).toHaveTextContent('2');
  });

  it('shows a key with no value as a flag', async () => {
    render(<BootConfigApp />);

    const row = within(await sectionTable('kernel')).getByText('rootwait').closest('tr')!;
    expect(within(row).getByTitle('A key with no value')).toHaveTextContent('flag');
  });

  it('keeps a value that contains a comma', async () => {
    render(<BootConfigApp />);

    const row = within(await sectionTable('kernel')).getByText('console').closest('tr')!;
    expect(within(row).getByText('ttyS0,115200n8')).toBeInTheDocument();
  });

  it('shows each element of an array as its own value', async () => {
    render(<BootConfigApp />);

    const row = within(await sectionTable('init')).getByText('arg').closest('tr')!;
    expect(within(row).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '--system',
      '--unit=multi-user.target',
    ]);
  });

  it('shows the path below the section, dots and all', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'ftrace-boot' }));
    render(<BootConfigApp />);

    // `ftrace.instance.boot.current_tracer` minus its section name — and the
    // syscalls instance has a `current_tracer` of its own.
    const row = await rowFor('ftrace', 'instance.boot.current_tracer');

    expect(within(row).getByText('function_graph')).toBeInTheDocument();
    expect(await rowFor('ftrace', 'instance.syscalls.current_tracer')).toBeDefined();
    expect(screen.getByText('deepest key').previousSibling).toHaveTextContent('5 levels');
  });

  it('gives each module its own section, read by nobody in particular', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'module-params' }));
    render(<BootConfigApp />);

    await sectionTable('i915');
    expect(screen.getByText('sections').previousSibling).toHaveTextContent('6');
    expect(headingFor('i915')).toHaveTextContent('whoever reads it');
  });

  it('keeps commas and spaces inside a quoted value', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'quoted-values' }));
    render(<BootConfigApp />);

    const table = await sectionTable('systemd');
    expect(within(table).getByText('GREETING=hello, there')).toBeInTheDocument();
    expect(
      within(await sectionTable('init')).getByText('echo hello, world > /dev/kmsg'),
    ).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<BootConfigApp />);
    await sectionTable('kernel');

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getByTestId('raw-file')).toHaveTextContent(bootconfig('kernel-and-init'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<BootConfigApp />);

    await sectionTable('kernel');
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    // Every link on the page is a step of the path at the top of it — bar
    // the one in the footer, which leads to the source and is on every page.
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  /**
   * Most machines boot without one, so the file exists and is empty. That is
   * the normal case, not a failure — no alert, and nothing that reads as
   * broken. The `not-configured` fixture is a genuinely zero-byte file, so this
   * covers what the server actually serves rather than a hand-made body.
   */
  it('explains an empty file as the usual case', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'not-configured' }));
    render(<BootConfigApp />);

    expect(await screen.findByText(/booted without a boot config/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    // Not an error, and no empty summary tiles either.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('keys')).not.toBeInTheDocument();
    expect(screen.queryByText('sections')).not.toBeInTheDocument();
  });

  it('still offers the raw view for an empty file', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', mockServer({ fixture: 'not-configured' }));
    render(<BootConfigApp />);

    await screen.findByText(/booted without a boot config/i);
    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByTestId('raw-file')).toBeInTheDocument();
    expect(screen.getByTestId('raw-file')).toBeEmptyDOMElement();
  });

  it('treats a file of only whitespace the same way', async () => {
    vi.stubGlobal('fetch', mockServer({ body: '\n  \n' }));
    render(<BootConfigApp />);

    expect(await screen.findByText(/booted without a boot config/i)).toBeInTheDocument();
  });

  it('reports a failed read', async () => {
    vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    render(<BootConfigApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/bootconfig (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from two keys to a five-level ftrace tree.
describe.each([
  { fixture: 'kernel-and-init', keys: 8, sections: 2, first: 'kernel' },
  { fixture: 'ftrace-boot', keys: 13, sections: 2, first: 'ftrace' },
  { fixture: 'module-params', keys: 7, sections: 6, first: 'kernel' },
  { fixture: 'quoted-values', keys: 6, sections: 4, first: 'kernel' },
  { fixture: 'minimal', keys: 2, sections: 2, first: 'kernel' },
])('BootConfigApp with whatever the server serves: $fixture', ({ fixture, keys, sections, first }) => {
  it(`renders ${keys} keys across ${sections} sections`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<BootConfigApp />);

    await sectionTable(first);
    expect(screen.getByText('keys').previousSibling).toHaveTextContent(String(keys));
    expect(screen.getByText('sections').previousSibling).toHaveTextContent(String(sections));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
