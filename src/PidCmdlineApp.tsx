import { ProcPage } from './components/ProcPage';
import { PidCmdlineView } from './components/PidCmdlineView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/cmdline.html');

export function PidCmdlineApp() {
  return <ProcPage page={PAGE}>{(content) => <PidCmdlineView content={content} />}</ProcPage>;
}
