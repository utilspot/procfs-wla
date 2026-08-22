import { KeysView } from './components/KeysView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('keys.html');

export function KeysApp() {
  return <ProcPage page={PAGE}>{(content) => <KeysView content={content} />}</ProcPage>;
}
