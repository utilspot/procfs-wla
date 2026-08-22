import { CgroupsView } from './components/CgroupsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('cgroups.html');

export function CgroupsApp() {
  return <ProcPage page={PAGE}>{(content) => <CgroupsView content={content} />}</ProcPage>;
}
