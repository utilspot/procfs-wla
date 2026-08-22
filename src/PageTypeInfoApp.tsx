import { PageTypeInfoView } from './components/PageTypeInfoView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pagetypeinfo.html');

export function PageTypeInfoApp() {
  return (
    <ProcPage page={PAGE}>
      {(content) => <PageTypeInfoView content={content} />}
    </ProcPage>
  );
}
