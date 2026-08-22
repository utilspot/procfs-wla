import { ProcPage } from './components/ProcPage';
import { DriverRtcView } from './components/DriverRtcView';
import { pageFor } from './pages';

const PAGE = pageFor('driver/rtc.html');

export function DriverRtcApp() {
  return <ProcPage page={PAGE}>{(content) => <DriverRtcView content={content} />}</ProcPage>;
}
