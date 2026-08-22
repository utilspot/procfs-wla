import { ProcPage } from './components/ProcPage';
import { UidIoStatsView } from './components/UidIoStatsView';
import { pageFor } from './pages';

const PAGE = pageFor('uid_io/stats.html');

export function UidIoStatsApp() {
  return <ProcPage page={PAGE}>{(content) => <UidIoStatsView content={content} />}</ProcPage>;
}
