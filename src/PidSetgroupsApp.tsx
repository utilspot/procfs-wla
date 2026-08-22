import { PidSetgroupsView } from './components/PidSetgroupsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/setgroups.html');

export function PidSetgroupsApp() {
  return <ProcPage page={PAGE}>{(content) => <PidSetgroupsView content={content} />}</ProcPage>;
}
