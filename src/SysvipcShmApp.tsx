import { ProcPage } from './components/ProcPage';
import { SysvipcShmView } from './components/SysvipcShmView';
import { pageFor } from './pages';

const PAGE = pageFor('sysvipc/shm.html');

export function SysvipcShmApp() {
  return <ProcPage page={PAGE}>{(content) => <SysvipcShmView content={content} />}</ProcPage>;
}
