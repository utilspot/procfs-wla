import { ProcPage } from './components/ProcPage';
import { ScsiSgDebugView } from './components/ScsiSgDebugView';
import { pageFor } from './pages';

const PAGE = pageFor('scsi/sg/debug.html');

export function ScsiSgDebugApp() {
  return <ProcPage page={PAGE}>{(content) => <ScsiSgDebugView content={content} />}</ProcPage>;
}
