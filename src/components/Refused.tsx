import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';

/**
 * The shell around a page that has nothing to read: its URL named a path this
 * app will not ask for, so there is no file, no listing, and no view to switch
 * between. What was refused and why is the whole of the page.
 */
export function Refused({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div className="app">
      <header className="app__header">
        <h1>
          <code>{path}</code>
        </h1>
      </header>
      <main>
        <p className="notice notice--error" role="alert">
          {children}
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
