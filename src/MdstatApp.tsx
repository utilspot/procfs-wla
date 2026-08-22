import { MdstatView } from './components/MdstatView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('mdstat.html');

export function MdstatApp() {
  return <ProcPage page={PAGE}>{(content) => <MdstatView content={content} />}</ProcPage>;
}
