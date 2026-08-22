import { FbView } from './components/FbView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('fb.html');

export function FbApp() {
  return <ProcPage page={PAGE}>{(content) => <FbView content={content} />}</ProcPage>;
}
