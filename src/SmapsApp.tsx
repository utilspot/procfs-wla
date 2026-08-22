import { ProcPage } from './components/ProcPage';
import { SmapsView } from './components/SmapsView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/smaps.html');

export function SmapsApp() {
  return <ProcPage page={PAGE}>{(content) => <SmapsView content={content} />}</ProcPage>;
}
