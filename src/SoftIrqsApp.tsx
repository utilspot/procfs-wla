import { ProcPage } from './components/ProcPage';
import { SoftIrqsView } from './components/SoftIrqsView';
import { pageFor } from './pages';

const PAGE = pageFor('softirqs.html');

export function SoftIrqsApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <SoftIrqsView content={content} />}</ProcPage>
  );
}
