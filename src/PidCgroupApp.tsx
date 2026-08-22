import { ProcPage } from './components/ProcPage';
import { PidCgroupView } from './components/PidCgroupView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/cgroup.html');

export function PidCgroupApp() {
  return <ProcPage page={PAGE}>{(content) => <PidCgroupView content={content} />}</ProcPage>;
}
