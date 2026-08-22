import { DiskstatsView } from './components/DiskstatsView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('diskstats.html');

export function DiskstatsApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <DiskstatsView content={content} />}</ProcPage>
  );
}
