import { ProcPage } from './components/ProcPage';
import { VmallocInfoView } from './components/VmallocInfoView';
import { pageFor } from './pages';

const PAGE = pageFor('vmallocinfo.html');

export function VmallocInfoApp() {
  return (
    <ProcPage page={PAGE}>
      {(content) => <VmallocInfoView content={content} />}
    </ProcPage>
  );
}
