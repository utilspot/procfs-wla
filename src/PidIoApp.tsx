import { PidIoView } from './components/PidIoView';
import { ProcPage } from './components/ProcPage';
import { pageFor } from './pages';

const PAGE = pageFor('pid/io.html');

export function PidIoApp() {
  return <ProcPage page={PAGE}>{(content) => <PidIoView content={content} />}</ProcPage>;
}
