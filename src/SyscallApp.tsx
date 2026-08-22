import { ProcPage } from './components/ProcPage';
import { SyscallView } from './components/SyscallView';
import { pageFor } from './pages';

const PAGE = pageFor('pid/syscall.html');

export function SyscallApp() {
  return <ProcPage page={PAGE}>{(content) => <SyscallView content={content} />}</ProcPage>;
}
