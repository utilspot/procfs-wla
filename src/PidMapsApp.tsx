import { PidMapsView } from './components/PidMapsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/maps.html');

export function PidMapsApp() {
  return <ProcPage page={PAGE}>{(content) => <PidMapsView content={content} />}</ProcPage>;
}
