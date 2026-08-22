import { DirectoryPage } from './components/DirectoryPage';
import { SysUserDirectoryView } from './components/SysUserDirectoryView';
import { directoryPageFor } from './pages';

const PAGE = directoryPageFor('sys/user/index.html');

/**
 * The listing of `/proc/sys/user`, the one directory below `/proc` with a page
 * of its own.
 *
 * It is what `<base-url>/sys/user/` lands on: the servers hand a directory this
 * app has a page for to that page and every other directory to `dir.html` — see
 * `documentForPath` in `config/document.ts` — so the URL a reader is at is the
 * directory this lists, as everywhere else here.
 *
 * The directory it lists is **declared** rather than read from the URL, unlike
 * {@link DirApp}, and that is the difference between a page for one directory
 * and the page for any of them: this one is about `/proc/sys/user` in
 * particular, and what it adds — the twelve limits and what each bounds — is
 * true of nowhere else. {@link IndexApp} is the same arrangement for `/proc`
 * itself.
 */
export function SysUserIndexApp() {
  return (
    <DirectoryPage path={PAGE.path}>
      {(listing) => <SysUserDirectoryView listing={listing} path={PAGE.path} />}
    </DirectoryPage>
  );
}
