import { ProcPage } from './components/ProcPage';
import { ScsiSgAllowDioView } from './components/ScsiSgAllowDioView';
import { pageFor } from './pages';

const PAGE = pageFor('scsi/sg/allow_dio.html');

export function ScsiSgAllowDioApp() {
  return <ProcPage page={PAGE}>{(content) => <ScsiSgAllowDioView content={content} />}</ProcPage>;
}
