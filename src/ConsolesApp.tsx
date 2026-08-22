import { ConsolesView } from './components/ConsolesView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('consoles.html');

export function ConsolesApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <ConsolesView content={content} />}</ProcPage>
  );
}
