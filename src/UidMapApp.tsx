import { ProcPage } from './components/ProcPage';
import { UidMapView } from './components/UidMapView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/uid_map.html');

export function UidMapApp() {
  return <ProcPage page={PAGE}>{(content) => <UidMapView content={content} />}</ProcPage>;
}
