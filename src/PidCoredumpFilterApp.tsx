import { PidCoredumpFilterView } from './components/PidCoredumpFilterView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/coredump_filter.html');

export function PidCoredumpFilterApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <PidCoredumpFilterView content={content} />}</ProcPage>
  );
}
