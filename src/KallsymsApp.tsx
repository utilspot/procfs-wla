import { KallsymsView } from './components/KallsymsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('kallsyms.html');

export function KallsymsApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <KallsymsView content={content} />}</ProcPage>
  );
}
