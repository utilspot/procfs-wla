import { ProcPage } from './components/ProcPage';
import { SysvipcSemView } from './components/SysvipcSemView';
import { pageFor } from './pages';

const PAGE = pageFor('sysvipc/sem.html');

export function SysvipcSemApp() {
  return <ProcPage page={PAGE}>{(content) => <SysvipcSemView content={content} />}</ProcPage>;
}
