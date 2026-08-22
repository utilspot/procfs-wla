import { IomemView } from './components/IomemView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('iomem.html');

export function IomemApp() {
  return <ProcPage page={PAGE}>{(content) => <IomemView content={content} />}</ProcPage>;
}
