import { ProcPage } from './components/ProcPage';
import { AsoundVersionView } from './components/AsoundVersionView';
import { pageFor } from './pages';

const PAGE = pageFor('asound/version.html');

export function AsoundVersionApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <AsoundVersionView content={content} />}</ProcPage>
  );
}
