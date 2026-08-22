import { PidSchedStatView } from './components/PidSchedStatView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/schedstat.html');

export function PidSchedStatApp() {
  return <ProcPage page={PAGE}>{(content) => <PidSchedStatView content={content} />}</ProcPage>;
}
