import { GpuLoadView } from './components/GpuLoadView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('gpu_load.html');

export function GpuLoadApp() {
  return <ProcPage page={PAGE}>{(content) => <GpuLoadView content={content} />}</ProcPage>;
}
