import { DirectoryPage } from './components/DirectoryPage';
import { SysVmDirectoryView } from './components/SysVmDirectoryView';
import { directoryPageFor } from './pages';

const PAGE = directoryPageFor('sys/vm/index.html');

/**
 * The listing of `/proc/sys/vm`, the memory manager's control panel — the
 * second directory below `/proc` with a page of its own.
 *
 * It is what `<base-url>/sys/vm/` lands on: the servers hand a directory this
 * app has a page for to that page and every other directory to `dir.html` — see
 * `documentForPath` in `config/document.ts`.
 *
 * The directory it lists is **declared** rather than read from the URL, as
 * {@link SysUserIndexApp} and {@link IndexApp} declare theirs: this page is
 * about `/proc/sys/vm` in particular, and what it adds — which knob belongs to
 * which mechanism, and what each is set in — is true of nowhere else.
 */
export function SysVmIndexApp() {
  return (
    <DirectoryPage path={PAGE.path}>
      {(listing) => <SysVmDirectoryView listing={listing} path={PAGE.path} />}
    </DirectoryPage>
  );
}
