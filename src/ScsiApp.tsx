import { ProcPage } from './components/ProcPage';
import { ScsiView } from './components/ScsiView';
import { pageFor } from './pages';

const PAGE = pageFor('scsi/scsi.html');

export function ScsiApp() {
  return <ProcPage page={PAGE}>{(content) => <ScsiView content={content} />}</ProcPage>;
}
