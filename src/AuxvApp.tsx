import { ProcBinaryPage } from './components/ProcPage';
import { AuxvView } from './components/AuxvView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/auxv.html');

/**
 * The one page here that reads its file as bytes rather than as text — see
 * {@link ProcBinaryPage}, and `src/lib/auxv.ts` for why it has to.
 */
export function AuxvApp() {
  return <ProcBinaryPage page={PAGE}>{(bytes) => <AuxvView bytes={bytes} />}</ProcBinaryPage>;
}
