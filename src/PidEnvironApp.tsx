import { PidEnvironView } from './components/PidEnvironView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/environ.html');

export function PidEnvironApp() {
  return <ProcPage page={PAGE}>{(content) => <PidEnvironView content={content} />}</ProcPage>;
}
