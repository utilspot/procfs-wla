import { ProcPage } from './components/ProcPage';
import { AutogroupView } from './components/AutogroupView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/autogroup.html');

export function AutogroupApp() {
  return <ProcPage page={PAGE}>{(content) => <AutogroupView content={content} />}</ProcPage>;
}
