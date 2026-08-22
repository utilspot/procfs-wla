import { GpuMemoryView } from './components/GpuMemoryView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('gpu_memory.html');

export function GpuMemoryApp() {
  return <ProcPage page={PAGE}>{(content) => <GpuMemoryView content={content} />}</ProcPage>;
}
