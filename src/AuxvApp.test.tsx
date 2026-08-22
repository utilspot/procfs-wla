import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readAuxvFixture as auxv } from './test/fixtures';
import { AuxvApp } from './AuxvApp';

/**
 * Stands in for the backend serving /proc/<pid>/auxv — as **bytes**, which is
 * the whole point of this page: a Response built from a string would have
 * mangled the pointers before the page ever saw them.
 */
function mockServer(
  options: { fixture?: string; failWith?: number; body?: Uint8Array } = {},
) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const match = /^\/0\/api\/file\/([^/]+)\/auxv$/.exec(url.pathname);

    if (match === null) return new Response('not found', { status: 404 });
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }

    let bytes: Uint8Array;
    if (options.body !== undefined) {
      bytes = options.body;
    } else {
      try {
        bytes = auxv(options.fixture ?? 'desktop', match[1]!);
      } catch {
        return new Response('no such file', { status: 404, statusText: 'Not Found' });
      }
    }

    return new Response(bodyOf(bytes), {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  });
}

/**
 * These exact bytes as a body. A typed array is a *view*, which is not what a
 * Response takes, so the region it covers is copied out — the bytes reaching
 * the page are then the fixture's own and nothing else's.
 */
function bodyOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

const summary = () => screen.findByTestId('summary');
const table = () => screen.findByRole('table', { name: 'Auxiliary vector' });

/** The row for an AT_* name, matched on the name cell's own text node. */
const rowFor = async (name: string): Promise<HTMLElement> => {
  const rows = within(await table()).getAllByRole('row');
  return rows.find((row) => row.querySelectorAll('td')[2]?.childNodes[0]?.textContent === name)!;
};

const statFor = async (label: string): Promise<HTMLElement> => {
  const tiles = within(await summary()).getAllByText(label);
  return tiles[0]!.parentElement!;
};

const openFor = (pid: string) => window.history.pushState({}, '', `/${pid}/auxv`);

beforeEach(() => {
  openFor('self');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('AuxvApp', () => {
  /** Bytes, not text — the request says so and the read has to match. */
  it('asks the backend for bytes from its own path', async () => {
    openFor('12282');
    render(<AuxvApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/12282/auxv',
      expect.objectContaining({ headers: { Accept: 'application/octet-stream' } }),
    );
  });

  it('works the layout out from the bytes', async () => {
    render(<AuxvApp />);

    expect(await statFor('layout')).toHaveTextContent('64-bit, little-endian');
    expect(await statFor('entries')).toHaveTextContent('20');
    expect(await statFor('page size')).toHaveTextContent('4096');
  });

  /**
   * The reason this page reads bytes at all: every one of these has a byte
   * above 0x7f in it, and text decoding would have replaced them.
   */
  it('shows a pointer whole', async () => {
    render(<AuxvApp />);

    expect(await rowFor('AT_SYSINFO_EHDR')).toHaveTextContent('0x7ffd8d3f9000');
    expect(await rowFor('AT_RANDOM')).toHaveTextContent('0x7ffd8d3d4f39');
  });

  it('names each entry and says what it is for', async () => {
    render(<AuxvApp />);

    const vdso = await rowFor('AT_SYSINFO_EHDR');
    expect(vdso).toHaveTextContent('33');
    expect(vdso).toHaveTextContent(/vDSO/);
    expect(await rowFor('AT_PAGESZ')).toHaveTextContent(/getpagesize/);
  });

  it('shows a value the way that value is worth reading', async () => {
    render(<AuxvApp />);

    // Counts in decimal, pointers in hex, and a flag as a word.
    expect(await rowFor('AT_PAGESZ')).toHaveTextContent('4096');
    expect(await rowFor('AT_SECURE')).toHaveTextContent('no');
    expect(await rowFor('AT_PHENT')).toHaveTextContent('56');
  });

  it('keeps the kernel’s own order and says where each pair sits', async () => {
    render(<AuxvApp />);

    const rows = within(await table()).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('AT_SYSINFO_EHDR');
    expect(rows[0]!.querySelector('td')?.textContent).toBe('0');
    expect(rows[1]!.querySelector('td')?.textContent).toBe('16');
  });

  it('reads a 32-bit process as four-byte words', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'i386' }));
    render(<AuxvApp />);

    expect(await statFor('layout')).toHaveTextContent('32-bit, little-endian');
    // Half the size, so the second pair starts at 8 rather than 16.
    const rows = within(await table()).getAllByRole('row').slice(1);
    expect(rows[1]!.querySelector('td')?.textContent).toBe('8');
    expect(await rowFor('AT_SYSINFO')).toHaveTextContent('0xf7f2d0a0');
  });

  it('warns that a set-uid program will be treated as privileged', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'setuid' }));
    render(<AuxvApp />);

    const secure = await screen.findByTestId('secure');

    expect(secure).toHaveTextContent('this program gained privilege as it was exec’d');
    expect(secure).toHaveTextContent('LD_PRELOAD');
    expect(secure).toHaveTextContent('its real uid is 1000 and its effective one 0');
  });

  it('says nothing about privilege for a program that gained none', async () => {
    render(<AuxvApp />);

    await summary();
    expect(screen.queryByTestId('secure')).not.toBeInTheDocument();
  });

  it('reads a static binary by the loader it does not have', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'static' }));
    render(<AuxvApp />);

    const isStatic = await screen.findByTestId('static');

    expect(isStatic).toHaveTextContent('linked statically');
    expect(isStatic).toHaveTextContent('ld.so');
    expect(await rowFor('AT_BASE')).toHaveTextContent('0x0');
  });

  it('reads an ARM64 vector', async () => {
    vi.stubGlobal('fetch', mockServer({ fixture: 'arm64' }));
    render(<AuxvApp />);

    expect(await rowFor('AT_MINSIGSTKSZ')).toHaveTextContent('5312');
    expect(await rowFor('AT_RSEQ_ALIGN')).toHaveTextContent('32');
    expect(await statFor('layout')).toHaveTextContent('64-bit, little-endian');
  });

  /** A kernel thread has no mm, so there is no vector to copy out. */
  it('explains an empty file rather than calling it broken', async () => {
    openFor('74');
    render(<AuxvApp />);

    const empty = await screen.findByTestId('empty');

    expect(empty).toHaveTextContent('This process has no auxiliary vector');
    expect(empty).toHaveTextContent('kernel thread never went through execve');
    expect(empty).toHaveTextContent('EPERM, not emptiness');
  });

  it('says so when the bytes are not a vector any way round', async () => {
    vi.stubGlobal('fetch', mockServer({ body: new Uint8Array([1, 2, 3, 4, 5, 6, 7]) }));
    render(<AuxvApp />);

    expect(await screen.findByTestId('unreadable')).toHaveTextContent(
      'not an auxiliary vector in any layout',
    );
  });

  it('marks a type it has no name for', async () => {
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, 99n, true);
    view.setBigUint64(8, 0x1234n, true);
    vi.stubGlobal('fetch', mockServer({ body: bytes }));
    render(<AuxvApp />);

    const rows = within(await table()).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('not known here')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('Nothing here knows this number.');
  });

  /**
   * The same raw view every other page has: the file as text. The bytes are
   * decoded back into what `readFile` would have returned, which for this file
   * is what `cat` puts on a terminal.
   */
  it('switches to the raw file view', async () => {
    const user = userEvent.setup();
    render(<AuxvApp />);
    await summary();

    await user.click(screen.getByRole('button', { name: 'Raw' }));

    const raw = screen.getByTestId('raw-file');
    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    expect(raw.textContent).toBe(new TextDecoder().decode(auxv('desktop', 'self')));
    // Which is the first type byte, then the NULs padding the word out.
    expect(raw.textContent!.startsWith('!       ')).toBe(true);
  });

  it('links nowhere but back up its own path', async () => {
    render(<AuxvApp />);

    await summary();
    const footer = screen.getByRole('contentinfo');
    const links = screen.getAllByRole('link').filter((link) => !footer.contains(link));
    const path = screen.getByRole('heading', { level: 1 });

    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => path.contains(link))).toBe(true);
  });

  it('reports a process that is not there', async () => {
    openFor('4242');
    render(<AuxvApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to read /proc/4242/auxv (HTTP 404 Not Found)',
    );
  });
});

// Any of these can turn up on a given server run, so the page has to render
// them all — from a 64-bit desktop program to a 32-bit one to no vector at all.
describe.each([
  { fixture: 'desktop', pid: 'self', entries: 20, layout: '64-bit, little-endian' },
  { fixture: 'static', pid: 'self', entries: 19, layout: '64-bit, little-endian' },
  { fixture: 'setuid', pid: 'self', entries: 20, layout: '64-bit, little-endian' },
  { fixture: 'arm64', pid: 'self', entries: 21, layout: '64-bit, little-endian' },
  { fixture: 'i386', pid: 'self', entries: 20, layout: '32-bit, little-endian' },
])('AuxvApp with whatever the server serves: $fixture', ({ fixture, pid, entries, layout }) => {
  it(`renders ${entries} entries, read as ${layout}`, async () => {
    openFor(pid);
    vi.stubGlobal('fetch', mockServer({ fixture }));
    render(<AuxvApp />);

    expect(await statFor('entries')).toHaveTextContent(String(entries));
    expect(await statFor('layout')).toHaveTextContent(layout);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
