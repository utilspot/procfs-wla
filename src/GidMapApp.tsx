import { GidMapView } from './components/GidMapView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/gid_map.html');

export function GidMapApp() {
  return <ProcPage page={PAGE}>{(content) => <GidMapView content={content} />}</ProcPage>;
}
