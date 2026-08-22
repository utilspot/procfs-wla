import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSgDefReservedSizeFixture as size } from './test/fixtures';
import { ScsiSgDefReservedSizeApp } from './ScsiSgDefReservedSizeApp';

/** Stands in for the backend serving /proc/scsi/sg/def_reserved_size. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/scsi/sg/def_reserved_size') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? size(options.fixture ?? 'default'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const summary = () => screen.findByTestId('summary');

const stat = async (label: string): Promise<HTMLElement> =>
  within(await summary()).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  window.history.pushState({}, '', '/scsi/sg/def_reserved_size');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ScsiSgDefReservedSizeApp', () => {
  it('requests /proc/scsi/sg/def_reserved_size from its own path', async () => {
    render(<ScsiSgDefReservedSizeApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/scsi/sg/def_reserved_size',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('shows the number in bytes and in the unit it is thought in', async () => {
    render(<ScsiSgDefReservedSizeApp />);

    expect(await stat('reserved size')).toHaveTextContent('32 KiB');
    expect(await stat('bytes')).toHaveTextContent('32768');
    expect(await stat('pages')).toHaveTextContent('8');
  });

  it('says it is the compiled default where nothing has moved it', async () => {
    render(<ScsiSgDefReservedSizeApp />);

    expect(await stat('against the default')).toHaveTextContent('unchanged');
  });

  /** The one thing about this file that is easy to get wrong. */
  it('says the value is a default rather than a state', async () => {
    render(<ScsiSgDefReservedSizeApp />);

    const notice = await screen.findByTestId('a-default');
    expect(notice).toHaveTextContent('This is a default, not a state');
    expect(notice).toHaveTextContent('SG_SET_RESERVED_SIZE');
    expect(notice).toHaveTextContent('SG_GET_RESERVED_SIZE');
  });

  /** Four of them, which is what the table under the tiles is for. */
  it('names every way the value can have got there', async () => {
    render(<ScsiSgDefReservedSizeApp />);

    await summary();
    expect(screen.getByText('Compiled default').parentElement).toHaveTextContent('8 * 4096');
    expect(screen.getByText('Module parameter').parentElement).toHaveTextContent(
      'sg.def_reserved_size=',
    );
    expect(screen.getByText('This file').parentElement).toHaveTextContent('CAP_SYS_RAWIO');
    expect(screen.getByText('One descriptor').parentElement).toHaveTextContent(
      'SG_SET_RESERVED_SIZE',
    );
  });

  it('says nothing about a ceiling or a zero where there is neither', async () => {
    render(<ScsiSgDefReservedSizeApp />);

    await summary();
    expect(screen.queryByTestId('above-ceiling')).not.toBeInTheDocument();
    expect(screen.queryByTestId('zero')).not.toBeInTheDocument();
  });

  describe('a machine that raised it', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'raised' }));
    });

    it('reads it against the default it was moved from', async () => {
      render(<ScsiSgDefReservedSizeApp />);

      expect(await stat('reserved size')).toHaveTextContent('512 KiB');
      expect(await stat('against the default')).toHaveTextContent('16×');
      expect(screen.queryByTestId('above-ceiling')).not.toBeInTheDocument();
    });
  });

  describe('no reserve at all', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'zero' }));
    });

    /** Allowed, and worth saying so rather than reading as a fault. */
    it('says a zero is a size rather than a fault', async () => {
      render(<ScsiSgDefReservedSizeApp />);

      const notice = await screen.findByTestId('zero');
      expect(notice).toHaveTextContent('No reserve at all');
      expect(notice).toHaveTextContent('is not a fault');
    });
  });

  describe('larger than the write path takes', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'ceiling' }));
    });

    /** The megabyte limits the write, not the value. */
    it('says the value cannot have come from this file', async () => {
      render(<ScsiSgDefReservedSizeApp />);

      const notice = await screen.findByTestId('above-ceiling');
      expect(notice).toHaveTextContent('did not come from this file');
      expect(notice).toHaveTextContent('sg.def_reserved_size=');
      expect(await stat('reserved size')).toHaveTextContent('4 MiB');
    });
  });

  describe('a file holding something else', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'odd' }));
    });

    it('says the file holds one number and this is not one', async () => {
      render(<ScsiSgDefReservedSizeApp />);

      expect(await screen.findByText(/No number in this file/)).toHaveClass('notice--warn');
      expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    });
  });

  describe('a machine with no sg driver', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    });

    it('reports the 404 rather than an empty page', async () => {
      render(<ScsiSgDefReservedSizeApp />);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        '/proc/scsi/sg/def_reserved_size',
      );
      expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    });
  });

  describe('the raw view', () => {
    it('shows the one number as it came', async () => {
      render(<ScsiSgDefReservedSizeApp />);

      await summary();
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file')).toHaveTextContent('32768');
    });
  });
});
