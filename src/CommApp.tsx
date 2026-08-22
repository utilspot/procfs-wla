import { ProcPage } from './components/ProcPage';
import { CommView } from './components/CommView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/comm.html');

export function CommApp() {
  return <ProcPage page={PAGE}>{(content) => <CommView content={content} />}</ProcPage>;
}
