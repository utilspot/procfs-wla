import { CmdlineView } from './components/CmdlineView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('cmdline.html');

export function CmdlineApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <CmdlineView content={content} />}</ProcPage>
  );
}
