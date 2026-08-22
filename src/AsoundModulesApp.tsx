import { ProcPage } from './components/ProcPage';
import { AsoundModulesView } from './components/AsoundModulesView';
import { pageFor } from './pages';

const PAGE = pageFor('asound/modules.html');

export function AsoundModulesApp() {
  return <ProcPage page={PAGE}>{(content) => <AsoundModulesView content={content} />}</ProcPage>;
}
