import { PidStatmView } from './components/PidStatmView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/statm.html');

export function PidStatmApp() {
  return <ProcPage page={PAGE}>{(content) => <PidStatmView content={content} />}</ProcPage>;
}
