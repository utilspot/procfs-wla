import { CpuInfoView } from './components/CpuInfoView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('cpuinfo.html');

export function App() {
  return (
    <ProcPage page={PAGE}>
      {(content) => <CpuInfoView content={content} />}
    </ProcPage>
  );
}
