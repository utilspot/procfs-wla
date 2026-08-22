import { ProcPage } from './components/ProcPage';
import { SlabInfoView } from './components/SlabInfoView';
import { pageFor } from './pages';

const PAGE = pageFor('slabinfo.html');

export function SlabInfoApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <SlabInfoView content={content} />}</ProcPage>
  );
}
