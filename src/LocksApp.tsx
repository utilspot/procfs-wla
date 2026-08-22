import { LocksView } from './components/LocksView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('locks.html');

export function LocksApp() {
  return <ProcPage page={PAGE}>{(content) => <LocksView content={content} />}</ProcPage>;
}
