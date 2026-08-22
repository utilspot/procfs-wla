import { ProcPage } from './components/ProcPage';
import { VmstatView } from './components/VmstatView';
import { pageFor } from './pages';

const PAGE = pageFor('vmstat.html');

export function VmstatApp() {
  return <ProcPage page={PAGE}>{(content) => <VmstatView content={content} />}</ProcPage>;
}
