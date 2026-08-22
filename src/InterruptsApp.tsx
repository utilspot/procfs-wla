import { InterruptsView } from './components/InterruptsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('interrupts.html');

export function InterruptsApp() {
  return (
    <ProcPage page={PAGE}>
      {(content) => <InterruptsView content={content} />}
    </ProcPage>
  );
}
