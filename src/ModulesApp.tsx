import { ModulesView } from './components/ModulesView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('modules.html');

export function ModulesApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <ModulesView content={content} />}</ProcPage>
  );
}
