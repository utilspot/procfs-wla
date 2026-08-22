import { ProcPage } from './components/ProcPage';
import { ScsiSgDefReservedSizeView } from './components/ScsiSgDefReservedSizeView';
import { pageFor } from './pages';

const PAGE = pageFor('scsi/sg/def_reserved_size.html');

export function ScsiSgDefReservedSizeApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <ScsiSgDefReservedSizeView content={content} />}</ProcPage>
  );
}
