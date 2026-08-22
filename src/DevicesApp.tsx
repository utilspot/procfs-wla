import { DevicesView } from './components/DevicesView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('devices.html');

export function DevicesApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <DevicesView content={content} />}</ProcPage>
  );
}
