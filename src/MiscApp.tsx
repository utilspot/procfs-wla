import { MiscView } from './components/MiscView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('misc.html');

export function MiscApp() {
  return <ProcPage page={PAGE}>{(content) => <MiscView content={content} />}</ProcPage>;
}
