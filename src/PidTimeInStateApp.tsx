import { PidTimeInStateView } from './components/PidTimeInStateView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/time_in_state.html');

export function PidTimeInStateApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <PidTimeInStateView content={content} />}</ProcPage>
  );
}
