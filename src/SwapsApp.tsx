import { ProcPage } from './components/ProcPage';
import { SwapsView } from './components/SwapsView';
import { pageFor } from './pages';

const PAGE = pageFor('swaps.html');

export function SwapsApp() {
  return <ProcPage page={PAGE}>{(content) => <SwapsView content={content} />}</ProcPage>;
}
