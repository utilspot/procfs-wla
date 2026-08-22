import { MountsView } from './components/MountsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('mounts.html');

export function MountsApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <MountsView content={content} />}</ProcPage>
  );
}
