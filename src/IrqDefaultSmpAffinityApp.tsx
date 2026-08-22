import { ProcPage } from './components/ProcPage';
import { IrqDefaultSmpAffinityView } from './components/IrqDefaultSmpAffinityView';
import { pageFor } from './pages';

const PAGE = pageFor('irq/default_smp_affinity.html');

export function IrqDefaultSmpAffinityApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <IrqDefaultSmpAffinityView content={content} />}</ProcPage>
  );
}
