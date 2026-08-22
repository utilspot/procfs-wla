import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readSgVersionFixture as sg } from './test/fixtures';
import { ScsiSgVersionApp } from './ScsiSgVersionApp';

/** Stands in for the backend serving /proc/scsi/sg/version. */
function mockServer(options: { fixture?: string; failWith?: number; body?: string } = {}) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');

    if (url.pathname !== '/0/api/file/scsi/sg/version') {
      return new Response('not found', { status: 404 });
    }
    if (options.failWith !== undefined) {
      return new Response('nope', { status: options.failWith, statusText: 'Not Found' });
    }
    return new Response(options.body ?? sg(options.fixture ?? 'stock'), {
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

const summary = () => screen.findByTestId('summary');

const stat = async (label: string): Promise<HTMLElement> =>
  within(await summary()).getByText(label).previousSibling as HTMLElement;

beforeEach(() => {
  window.history.pushState({}, '', '/scsi/sg/version');
  vi.stubGlobal('fetch', mockServer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('ScsiSgVersionApp', () => {
  /** Two directories below /proc, and the page reads the path its URL spells. */
  it('requests /proc/scsi/sg/version from its own path', async () => {
    render(<ScsiSgVersionApp />);

    await summary();
    expect(fetch).toHaveBeenCalledWith(
      '/0/api/file/scsi/sg/version',
      expect.objectContaining({ headers: { Accept: 'text/plain' } }),
    );
  });

  it('shows the three fields the one line holds', async () => {
    render(<ScsiSgVersionApp />);

    expect(await stat('version')).toHaveTextContent('3.5.36');
    expect(await stat('number')).toHaveTextContent('30536');
    expect(await stat('driver dated')).toHaveTextContent('3 June 2014');
  });

  /** The number is the version packed two digits to a component. */
  it('reads the number back as the version it holds', async () => {
    render(<ScsiSgVersionApp />);

    expect(await stat('which reads')).toHaveTextContent('3.5.36');

    const notice = await screen.findByTestId('two-forms');
    expect(notice).toHaveTextContent('the same fact twice');
    expect(notice).toHaveTextContent('SG_GET_VERSION_NUM');
  });

  /** Which is what the file is for, and the reason it prints both. */
  it('says the number is the field a program reads', async () => {
    render(<ScsiSgVersionApp />);

    expect(await screen.findByTestId('two-forms')).toHaveTextContent('30530');
  });

  /** The date is hard-coded in sg.c, so it dates the driver and nothing else. */
  it('says whose date it is, which is not the kernel’s', async () => {
    render(<ScsiSgVersionApp />);

    const notice = await screen.findByTestId('driver-date');
    expect(notice).toHaveTextContent('The date is the driver’s, not the kernel’s');
    expect(notice).toHaveTextContent('3 June 2014');
  });

  it('says nothing about a disagreement where there is none', async () => {
    render(<ScsiSgVersionApp />);

    await summary();
    expect(screen.queryByTestId('disagrees')).not.toBeInTheDocument();
  });

  describe('an older driver', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'older' }));
    });

    it('reads whatever version the file holds, not the current one', async () => {
      render(<ScsiSgVersionApp />);

      expect(await stat('version')).toHaveTextContent('3.5.34');
      expect(await stat('which reads')).toHaveTextContent('3.5.34');
      expect(await stat('driver dated')).toHaveTextContent('27 October 2006');
    });
  });

  describe('a build that disagrees with itself', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'mismatch' }));
    });

    it('flags the disagreement and says which field to believe', async () => {
      render(<ScsiSgVersionApp />);

      const notice = await screen.findByTestId('disagrees');
      expect(notice).toHaveTextContent('The number and the string disagree');
      expect(notice).toHaveTextContent('3.5.37');
      expect(notice).toHaveTextContent('SG_GET_VERSION_NUM');
      expect(await stat('which reads')).toHaveTextContent('3.5.36');
    });
  });

  describe('a file holding something else', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ fixture: 'odd' }));
    });

    it('says the line is not the one this file has', async () => {
      render(<ScsiSgVersionApp />);

      expect(await screen.findByText(/No version line in this file/)).toHaveClass('notice--warn');
      expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    });

    it('still offers the raw view of what did arrive', async () => {
      render(<ScsiSgVersionApp />);

      await screen.findByText(/No version line in this file/);
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file')).toHaveTextContent('sg driver version unavailable');
    });
  });

  describe('a machine with no sg driver', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', mockServer({ failWith: 404 }));
    });

    /** The directory is the driver's own, so no driver is no directory. */
    it('reports the 404 rather than an empty page', async () => {
      render(<ScsiSgVersionApp />);

      expect(await screen.findByRole('alert')).toHaveTextContent('/proc/scsi/sg/version');
      expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
    });
  });

  describe('the raw view', () => {
    it('shows the line as it came, tab and brackets and all', async () => {
      render(<ScsiSgVersionApp />);

      await summary();
      await userEvent.click(screen.getByRole('button', { name: 'Raw' }));
      expect(screen.getByTestId('raw-file').textContent).toContain('30536\t3.5.36 [20140603]');
    });
  });
});
