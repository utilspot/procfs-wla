import { ProcPage } from './components/ProcPage';
import { StatusView } from './components/StatusView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/status.html');

export function StatusApp() {
  return <ProcPage page={PAGE}>{(content) => <StatusView content={content} />}</ProcPage>;
}
