import { ProcPage } from './components/ProcPage';
import { ScsiSgDevicesView } from './components/ScsiSgDevicesView';
import { pageFor } from './pages';

const PAGE = pageFor('scsi/sg/devices.html');

export function ScsiSgDevicesApp() {
  return <ProcPage page={PAGE}>{(content) => <ScsiSgDevicesView content={content} />}</ProcPage>;
}
