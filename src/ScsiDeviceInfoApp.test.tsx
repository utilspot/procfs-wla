import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readScsiDeviceInfoFixture as devinfo } from './test/fixtures';
import { ScsiDeviceInfoApp } from './ScsiDeviceInfoApp';

/** Stands in for the backend serving /proc/scsi/device_info. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/scsi/device_info') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? devinfo(options.fixture ?? 'quirks'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const table = () => screen.findByRole('table', { name: 'Device quirks' });

const rows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** The row for an entry, matched on the model in its second cell. */
const rowFor = async (model: string): Promise<HTMLElement> =>
  (await rows()).find((row) => row.querySelectorAll('td')[1]?.textContent?.startsWith(model))!;

const stat = (label: string): HTMLElement =>
  within(screen.getByTestId('summary')).getByText(label).previousSibling as HTMLElement;

const legend = () => screen.getByRole('region', { name: 'What these flags do' });

beforeEach(() => {
  window.history.pushState({}, '', '/scsi/device_info');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ScsiDeviceInfoApp', () => {
  it('requests /proc/scsi/device_info from its own path', async () => {
    render(<ScsiDeviceInfoApp />);

    await table();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/scsi/device_info',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('renders a row per entry, with the mask it carries', async () => {
    render(<ScsiDeviceInfoApp />);

    expect(await rows()).toHaveLength(8);
    expect(stat('entries')).toHaveTextContent('8');
    expect(await rowFor('PERCRAID')).toHaveTextContent('0x100000');
  });

  /** The mask is bits, and a bit is a name — which is the whole page. */
  it('names every flag a mask sets', async () => {
    render(<ScsiDeviceInfoApp />);

    const row = await rowFor('ARRAY CONTROLLE');
    expect(within(row).getByText('SPARSELUN')).toBeInTheDocument();
    expect(within(row).getByText('LARGELUN')).toBeInTheDocument();
    expect(within(row).getByText('REPORTLUN2')).toBeInTheDocument();
    expect(within(row).getByText('MAX_512')).toBeInTheDocument();
  });

  /** And the flag that explains a device with no node on the page beside this. */
  it('says what a flag does, in the tooltip the row carries', async () => {
    render(<ScsiDeviceInfoApp />);

    expect(within(await rowFor('PERCRAID')).getByText('NO_ULD_ATTACH')).toHaveAttribute(
      'title',
      expect.stringContaining('no upper-level driver binds it'),
    );
  });

  /** An empty model is a prefix of every model, so one line takes a vendor. */
  it('marks the entry that covers a whole vendor', async () => {
    render(<ScsiDeviceInfoApp />);

    const row = (await rows()).find((line) => line.textContent?.startsWith('Promise'))!;
    expect(within(row).getByText('any model')).toHaveAttribute(
      'title',
      expect.stringContaining('prefix of every model'),
    );
    expect(stat('whole vendors')).toHaveTextContent('1');
  });

  /** The quotes are the file's way of showing a field that is not there. */
  it('keeps the quotes on a field whose emptiness they are what shows', async () => {
    render(<ScsiDeviceInfoApp />);

    const row = await rowFor('Scanner');
    expect(within(row).getByTitle(/No vendor at all/)).toHaveTextContent("''");
  });

  /** A mask past 32 bits, which needs more than a JavaScript bitwise operator. */
  it('reads a flag above bit 31', async () => {
    render(<ScsiDeviceInfoApp />);

    const row = await rowFor('ZIP');
    expect(row).toHaveTextContent('0x400000021');
    expect(within(row).getByText('SKIP_IO_HINTS')).toBeInTheDocument();
  });

  /** Said once for the page, beside the set of flags this list actually uses. */
  it('explains each flag once, in the legend under the table', async () => {
    render(<ScsiDeviceInfoApp />);

    await table();
    expect(within(legend()).getByText('NO_ULD_ATTACH')).toBeInTheDocument();
    expect(within(legend()).getByText(/bit 20/)).toBeInTheDocument();
    expect(within(legend()).getByText(/RAID controller/)).toBeInTheDocument();
  });

  describe('the whole compiled-in list', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'stock' }));
    });

    it('shows the list a stock kernel carries', async () => {
      render(<ScsiDeviceInfoApp />);

      expect(await rows()).toHaveLength(182);
      expect(stat('entries')).toHaveTextContent('182');
    });

    /** The largest group in the file, and the least interesting. */
    it('folds away the plain NOLUN entries when asked', async () => {
      render(<ScsiDeviceInfoApp />);
      await table();

      await userEvent.click(screen.getByRole('checkbox'));
      expect(await rows()).toHaveLength(132);
      expect(stat('entries')).toHaveTextContent('182');
    });
  });

  describe('a bit with no flag behind it', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'retired-bit' }));
    });

    it('says which bit, rather than guessing at a meaning', async () => {
      render(<ScsiDeviceInfoApp />);

      expect(await screen.findByTestId('unnamed')).toHaveTextContent('3 entries set');
      expect(within(await rowFor('RETIRED')).getByText('bit 14')).toHaveAttribute(
        'title',
        expect.stringContaining('does not use'),
      );
      expect(within(await rowFor('FUTURE')).getByText('bit 40')).toHaveAttribute(
        'title',
        expect.stringContaining('past the last flag'),
      );
    });

    it('keeps the named flags of a mask that also holds one', async () => {
      render(<ScsiDeviceInfoApp />);

      const row = await rowFor('BOTH');
      expect(within(row).getByText('NOLUN')).toBeInTheDocument();
      expect(within(row).getAllByText(/^bit /)).toHaveLength(2);
    });
  });

  describe('a line that is not an entry', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'unread' }));
    });

    it('shows what it could not read rather than dropping it', async () => {
      render(<ScsiDeviceInfoApp />);

      const notice = await screen.findByTestId('unread');
      expect(notice).toHaveTextContent('A line here is not an entry');
      expect(notice).toHaveTextContent('this line is not an entry');
      expect(await rows()).toHaveLength(3);
    });
  });

  describe('a file with nothing in it', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ body: '' }));
    });

    /** The list is the kernel's own, so an empty one is a failed read. */
    it('reads an empty list as the read failing, since the table is compiled in', async () => {
      render(<ScsiDeviceInfoApp />);

      expect(await screen.findByText(/compiled into the kernel rather than gathered/)).toHaveClass(
        'notice--warn',
      );
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('a machine with no such file', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    });

    it('reports the 404 rather than an empty table', async () => {
      render(<ScsiDeviceInfoApp />);

      expect(await screen.findByRole('alert')).toHaveTextContent('/proc/scsi/device_info');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('the raw view', () => {
    it('shows the file as it came, quotes and all', async () => {
      render(<ScsiDeviceInfoApp />);

      await table();
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file').textContent).toContain("'DELL' 'PERCRAID' 0x100000");
    });
  });
});
