import { FilesystemsView } from './components/FilesystemsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('filesystems.html');

export function FilesystemsApp() {
  return (
    <ProcPage page={PAGE}>
      {(content) => <FilesystemsView content={content} />}
    </ProcPage>
  );
}
