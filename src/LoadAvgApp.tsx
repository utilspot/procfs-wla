import { LoadAvgView } from './components/LoadAvgView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('loadavg.html');

export function LoadAvgApp() {
  return <ProcPage page={PAGE}>{(content) => <LoadAvgView content={content} />}</ProcPage>;
}
