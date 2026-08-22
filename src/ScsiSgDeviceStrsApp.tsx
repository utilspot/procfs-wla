import { ProcPage } from './components/ProcPage';
import { ScsiSgDeviceStrsView } from './components/ScsiSgDeviceStrsView';
import { pageFor } from './pages';

const PAGE = pageFor('scsi/sg/device_strs.html');

export function ScsiSgDeviceStrsApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <ScsiSgDeviceStrsView content={content} />}</ProcPage>
  );
}
