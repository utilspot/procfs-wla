import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SiteFooter } from './SiteFooter';

/**
 * The footer every page carries. What is worth pinning down is that the link
 * really is the URL package.json names — `__REPO_URL__` is substituted at build
 * time, and a footer linking the literal string `undefined` would look fine
 * until someone clicked it.
 */
describe('SiteFooter', () => {
  it('links the source at the URL package.json names', () => {
    render(<SiteFooter />);

    const link = within(screen.getByRole('contentinfo')).getByRole('link', { name: 'GitHub' });

    expect(link).toHaveAttribute('href', __REPO_URL__);
    expect(link.getAttribute('href')).toMatch(/^https:\/\/\S+$/);
  });

  it('says whose it is, and under what', () => {
    render(<SiteFooter />);

    expect(screen.getByRole('contentinfo')).toHaveTextContent('Copyright © 2026 · MIT · GitHub');
  });

  it('carries what the page has of its own beside it', () => {
    render(<SiteFooter>Last read at 12:00:00</SiteFooter>);

    expect(screen.getByRole('contentinfo')).toHaveTextContent('Last read at 12:00:00');
  });
});
