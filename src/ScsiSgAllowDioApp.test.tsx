import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSgAllowDioFixture as dio } from './test/fixtures';
import { ScsiSgAllowDioApp } from './ScsiSgAllowDioApp';

/** Stands in for the backend serving /proc/scsi/sg/allow_dio. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/scsi/sg/allow_dio') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? dio(options.fixture ?? 'off'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const fields = async (): Promise<ReturnType<typeof within>> =>
  within(await screen.findByRole('table', { name: 'The value and where it comes from' }));

const rowFor = async (label: string): Promise<HTMLElement> =>
  (await fields()).getByRole('rowheader', { name: label }).parentElement!;

beforeEach(() => {
  window.history.pushState({}, '', '/scsi/sg/allow_dio');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ScsiSgAllowDioApp', () => {
  it('requests /proc/scsi/sg/allow_dio from its own path', async () => {
    render(<ScsiSgAllowDioApp />);

    await fields();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/scsi/sg/allow_dio',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  /** The default, and the thing a reader most needs told: nothing fails. */
  it('says a refused request still runs, and is not told', async () => {
    render(<ScsiSgAllowDioApp />);

    const notice = await screen.findByTestId('state');
    expect(notice).toHaveClass('notice--warn');
    expect(notice).toHaveTextContent('Direct I/O is refused, and nothing is told so');
    expect(notice).toHaveTextContent('SG_FLAG_DIRECT_IO');
    expect(notice).toHaveTextContent('no error comes back');
  });

  /** And why the page beside this one never shows the prefix. */
  it('points at the debug file, where the answer would show', async () => {
    render(<ScsiSgAllowDioApp />);

    expect(await screen.findByTestId('state')).toHaveTextContent('/proc/scsi/sg/debug');
    expect(await screen.findByTestId('state')).toHaveTextContent('dio>>');
  });

  it('puts the value and every way it can be set in a table', async () => {
    render(<ScsiSgAllowDioApp />);

    expect(await rowFor('allow_dio')).toHaveTextContent('0');
    expect(await rowFor('allow_dio')).toHaveTextContent('refused');
    expect(await rowFor('compiled default')).toHaveTextContent('0');
    expect(await rowFor('module parameter')).toHaveTextContent('sg.allow_dio=');
    expect(await rowFor('this file')).toHaveTextContent('CAP_SYS_RAWIO');
    expect(await rowFor('per request')).toHaveTextContent('SG_FLAG_DIRECT_IO');
  });

  /** The only honest answer to "did it happen" is the one that comes back after. */
  it('lists the three answers the info field can hold', async () => {
    render(<ScsiSgAllowDioApp />);

    const answers = within(
      await screen.findByRole('region', { name: 'What the info field says afterwards' }),
    );

    expect(answers.getByText('SG_INFO_INDIRECT_IO')).toBeInTheDocument();
    expect(answers.getByText('SG_INFO_DIRECT_IO')).toBeInTheDocument();
    expect(answers.getByText('SG_INFO_MIXED_IO').parentElement).toHaveTextContent('0x4');
    expect(answers.getByText(/part direct|part of it went directly/)).toBeInTheDocument();
  });

  it('says nothing about an unexpected value where the number is one of the two', async () => {
    render(<ScsiSgAllowDioApp />);

    await fields();
    expect(screen.queryByTestId('unexpected')).not.toBeInTheDocument();
  });

  describe('permitted', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'on' }));
    });

    /** Permission alone moves nothing: the request has to ask as well. */
    it('says permission is only half of what a direct transfer needs', async () => {
      render(<ScsiSgAllowDioApp />);

      const notice = await screen.findByTestId('state');
      expect(notice).toHaveTextContent('only half of it');
      expect(notice).not.toHaveClass('notice--warn');
      expect(await rowFor('allow_dio')).toHaveTextContent('permitted');
    });
  });

  describe('a value the write path could not have stored', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'unexpected' }));
    });

    it('says where a 2 must have come from, and reads it as permitted', async () => {
      render(<ScsiSgAllowDioApp />);

      const notice = await screen.findByTestId('unexpected');
      expect(notice).toHaveTextContent('not a number the write path could have stored');
      expect(notice).toHaveTextContent('normalised');
      expect(await screen.findByTestId('state')).toHaveTextContent('permitted');
    });
  });

  describe('a file holding something else', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'odd' }));
    });

    it('says the file holds one number and this is not one', async () => {
      render(<ScsiSgAllowDioApp />);

      expect(await screen.findByText(/No number in this file/)).toHaveClass('notice--warn');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('a machine with no sg driver', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    });

    it('reports the 404 rather than an empty page', async () => {
      render(<ScsiSgAllowDioApp />);

      expect(await screen.findByRole('alert')).toHaveTextContent('/proc/scsi/sg/allow_dio');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('the raw view', () => {
    it('shows the one number as it came', async () => {
      render(<ScsiSgAllowDioApp />);

      await fields();
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file')).toHaveTextContent('0');
    });
  });
});
