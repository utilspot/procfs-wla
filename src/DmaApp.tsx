import { DmaView } from './components/DmaView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('dma.html');

export function DmaApp() {
  return <ProcPage page={PAGE}>{(content) => <DmaView content={content} />}</ProcPage>;
}
