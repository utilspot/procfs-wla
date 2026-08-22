import { ProcPage } from './components/ProcPage';
import { LimitsView } from './components/LimitsView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/limits.html');

export function LimitsApp() {
  return <ProcPage page={PAGE}>{(content) => <LimitsView content={content} />}</ProcPage>;
}
