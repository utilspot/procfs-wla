import { ProcPage } from './components/ProcPage';
import { ZoneInfoView } from './components/ZoneInfoView';
import { pageFor } from './pages';

const PAGE = pageFor('zoneinfo.html');

export function ZoneInfoApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <ZoneInfoView content={content} />}</ProcPage>
  );
}
