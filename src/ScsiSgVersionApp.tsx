import { ProcPage } from './components/ProcPage';
import { ScsiSgVersionView } from './components/ScsiSgVersionView';
import { pageFor } from './pages';

const PAGE = pageFor('scsi/sg/version.html');

export function ScsiSgVersionApp() {
  return <ProcPage page={PAGE}>{(content) => <ScsiSgVersionView content={content} />}</ProcPage>;
}
