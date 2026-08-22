import { ProcPage } from './components/ProcPage';
import { TtyDriversView } from './components/TtyDriversView';
import { pageFor } from './pages';

const PAGE = pageFor('tty/drivers.html');

export function TtyDriversApp() {
  return (
    <ProcPage page={PAGE}>{(content) => <TtyDriversView content={content} />}</ProcPage>
  );
}
