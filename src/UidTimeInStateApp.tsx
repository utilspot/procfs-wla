import { ProcPage } from './components/ProcPage';
import { UidTimeInStateView } from './components/UidTimeInStateView';
import { pageFor } from './pages';

const PAGE = pageFor('uid_time_in_state.html');

export function UidTimeInStateApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <UidTimeInStateView content={content} />}</ProcPage>
  );
}
