import { ProcPage } from './components/ProcPage';
import { ScsiSgDeviceHdrView } from './components/ScsiSgDeviceHdrView';
import { pageFor } from './pages';

const PAGE = pageFor('scsi/sg/device_hdr.html');

export function ScsiSgDeviceHdrApp() {
  return <ProcPage page={PAGE}>{(content) => <ScsiSgDeviceHdrView content={content} />}</ProcPage>;
}
