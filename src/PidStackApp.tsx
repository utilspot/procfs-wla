import { PidStackView } from './components/PidStackView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/stack.html');

export function PidStackApp() {
  return <ProcPage page={PAGE}>{(content) => <PidStackView content={content} />}</ProcPage>;
}
