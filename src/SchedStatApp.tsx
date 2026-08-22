import { ProcPage } from './components/ProcPage';
import { SchedStatView } from './components/SchedStatView';
import { pageFor } from './pages';

const PAGE = pageFor('schedstat.html');

export function SchedStatApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <SchedStatView content={content} />}</ProcPage>
  );
}
