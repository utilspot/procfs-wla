import { ProcPage } from './components/ProcPage';
import { AsoundTimersView } from './components/AsoundTimersView';
import { pageFor } from './pages';

const PAGE = pageFor('asound/timers.html');

export function AsoundTimersApp() {
  return <ProcPage page={PAGE}>{(content) => <AsoundTimersView content={content} />}</ProcPage>;
}
