import { MeminfoView } from './components/MeminfoView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('meminfo.html');

export function MeminfoApp() {
  return <ProcPage page={PAGE}>{(content) => <MeminfoView content={content} />}</ProcPage>;
}
