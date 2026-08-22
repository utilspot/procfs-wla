import { PartitionsView } from './components/PartitionsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('partitions.html');

export function PartitionsApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <PartitionsView content={content} />}</ProcPage>
  );
}
