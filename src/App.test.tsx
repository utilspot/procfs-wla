import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readCpuInfoFixture as cpuinfo } from './test/fixtures';
import { App } from './App';

/**
 * Stands in for the backend serving /proc/cpuinfo. Which cpuinfo it returns is the
 * server's business — the test server picks one at random per run — so the
 * fixture is a parameter here rather than something the page can choose.
 */
function mockServer(options: { fixture?: string; failWith?: number } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/cpuinfo') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(cpuinfo(options.fixture ?? 'intel-x86_64'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('requests /proc/cpuinfo from its own path', async () => {
    render(<App />);

    await screen.findAllByRole('article');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/cpuinfo',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('offers no fixture control: the served file is the server\'s choice', async () => {
    render(<App />);

    await screen.findAllByRole('article');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/fixture/i)).not.toBeInTheDocument();
  });

  it('renders a card per CPU with its model and clock', async () => {
    render(<App />);

    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(4);
    expect(within(cards[0]!).getByText('CPU 0')).toBeInTheDocument();
    expect(
      within(cards[0]!).getByText('Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz'),
    ).toBeInTheDocument();
    expect(within(cards[3]!).getByText('4.01 GHz')).toBeInTheDocument();
  });

  it('shows a topology summary', async () => {
    render(<App />);

    expect(await screen.findByText('logical CPUs')).toBeInTheDocument();
    expect(screen.getByText('physical cores').previousSibling).toHaveTextContent('6');
    expect(screen.getByText('peak clock').previousSibling).toHaveTextContent('4.01 GHz');
  });

  it('collapses long flag lists until asked', async () => {
    const user = userEvent.setup();
    render(<App />);

    const card = (await screen.findAllByRole('article'))[0]!;
    expect(within(card).queryByText('arch_capabilities')).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: /show all \d+ flags/i }));
    expect(within(card).getByText('arch_capabilities')).toBeInTheDocument();
  });

  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByRole('article');

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    // The raw view shows the file byte-for-byte, tabs and all.
    expect(screen.getByTestId('raw-file')).toHaveTextContent(cpuinfo('intel-x86_64'), {
      normalizeWhitespace: false,
    });
  });

  it('links nowhere but back up its own path', async () => {
    render(<App />);

    await screen.findAllByRole('article');
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
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/cpuinfo (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — including the ones with no model name, clock or x86 fields.
describe.each([
  { fixture: 'intel-x86_64', cpus: 4, expected: 'Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz' },
  { fixture: 'amd-ryzen', cpus: 3, expected: 'AMD Ryzen 9 5950X 16-Core Processor' },
  { fixture: 'arm-rpi4', cpus: 4, expected: 'Raspberry Pi 4 Model B Rev 1.4' },
  { fixture: 'riscv', cpus: 4, expected: 'sifive,u74-mc' },
  { fixture: 'single-core', cpus: 1, expected: 'QEMU Virtual CPU version 2.5+' },
])('App with whatever the server serves: $fixture', ({ fixture, cpus, expected }) => {
  it(`renders ${cpus} CPU card(s) and identifies the machine`, async () => {
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<App />);

    expect(await screen.findAllByRole('article')).toHaveLength(cpus);
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
