import { ProcPage } from './components/ProcPage';
import { PidStatView } from './components/PidStatView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/stat.html');

export function PidStatApp() {
  return <ProcPage page={PAGE}>{(content) => <PidStatView content={content} />}</ProcPage>;
}
