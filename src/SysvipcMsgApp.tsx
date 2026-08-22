import { ProcPage } from './components/ProcPage';
import { SysvipcMsgView } from './components/SysvipcMsgView';
import { pageFor } from './pages';

const PAGE = pageFor('sysvipc/msg.html');

export function SysvipcMsgApp() {
  return <ProcPage page={PAGE}>{(content) => <SysvipcMsgView content={content} />}</ProcPage>;
}
