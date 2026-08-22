import { ProcPage } from './components/ProcPage';
import { UptimeView } from './components/UptimeView';
import { pageFor } from './pages';

const PAGE = pageFor('uptime.html');

export function UptimeApp() {
  return <ProcPage page={PAGE}>{(content) => <UptimeView content={content} />}</ProcPage>;
}
