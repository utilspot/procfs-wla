import { ProcPage } from './components/ProcPage';
import { StatView } from './components/StatView';
import { pageFor } from './pages';

const PAGE = pageFor('stat.html');

export function StatApp() {
  return <ProcPage page={PAGE}>{(content) => <StatView content={content} />}</ProcPage>;
}
