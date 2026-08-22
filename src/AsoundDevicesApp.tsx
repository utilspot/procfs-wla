import { ProcPage } from './components/ProcPage';
import { AsoundDevicesView } from './components/AsoundDevicesView';
import { pageFor } from './pages';

const PAGE = pageFor('asound/devices.html');

export function AsoundDevicesApp() {
  return <ProcPage page={PAGE}>{(content) => <AsoundDevicesView content={content} />}</ProcPage>;
}
