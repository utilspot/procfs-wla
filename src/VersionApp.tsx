import { ProcPage } from './components/ProcPage';
import { VersionView } from './components/VersionView';
import { pageFor } from './pages';

const PAGE = pageFor('version.html');

export function VersionApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <VersionView content={content} />}</ProcPage>
  );
}
