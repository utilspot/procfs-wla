import { DirectoryPage } from './components/DirectoryPage';
import { HOST_ROOT } from './api/paths';

/**
 * The listing of `/proc` itself, and the way in to everything else here.
 *
 * Every other page is about one file. This one is about the directory they all
 * come out of: what is in it, and which of it this app has a page for. It is
 * what the base path lands on, so the viewer opens on the folder rather than on
 * whichever file happened to be built first.
 *
 * It reads `<base-url>/0/api/dir/`, which is where the backend lists a directory
 * — beside the bytes at `/0/api/file`. What comes back is a JSON object keyed by
 * entry name; `src/lib/directory.ts` reads it.
 *
 * `/proc` is the one directory this page ever lists: it is the page the *base*
 * is served, the one URL that names no path. Every directory below it is named
 * by its own URL and lands on {@link DirApp} instead.
 */
export function IndexApp() {
  return <DirectoryPage path={HOST_ROOT} />;
}
