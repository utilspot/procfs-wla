import { ProcPage } from './components/ProcPage';
import { ScsiDeviceInfoView } from './components/ScsiDeviceInfoView';
import { pageFor } from './pages';

const PAGE = pageFor('scsi/device_info.html');

export function ScsiDeviceInfoApp() {
  return <ProcPage page={PAGE}>{(content) => <ScsiDeviceInfoView content={content} />}</ProcPage>;
}
